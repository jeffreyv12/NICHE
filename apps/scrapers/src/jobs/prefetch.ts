// Pre-fetch routine for the Scoring agent (Phase 2.3.2).
//
// The Scoring agent never browses; it reasons over a pre-fetched bundle. This
// module defines the adapter the job calls before each scoring run and ships a
// default implementation that wires the public-source clients (Wikipedia,
// EUIPO). Affiliate-network signals require per-env OAuth and are injected by
// the caller — see `buildDefaultPrefetch({ adapters })`.
//
// Splitting prefetch behind an adapter keeps the job unit-testable: tests use
// a stub adapter and never hit the network.

import type { scoringAgent } from "@nichefinder/agent-sdk";
import { matchKillList } from "@nichefinder/shared";
import { EuipoClient } from "../sources/euipo/index.js";
import { WikipediaClient } from "../sources/wikipedia/index.js";

type SignalBundle = scoringAgent.ScoringSignalBundle;
type Candidate = scoringAgent.ScoringCandidate;

export interface PrefetchContext {
  candidate: Candidate;
  /** ISO date string for upper bound when querying time-series sources. */
  asOf: string;
}

/**
 * Pluggable adapter for one half of the bundle that varies by env. Affiliate-
 * network signals depend on OAuth tokens the runtime owns; the public-source
 * half is wired by the default implementation.
 */
export interface AffiliateSignalAdapter {
  fetch(ctx: PrefetchContext): Promise<SignalBundle["affiliate_availability"]>;
}

export interface KeywordSignalAdapter {
  fetch(ctx: PrefetchContext): Promise<{
    keywords: SignalBundle["dataforseo_keywords"];
    serp: SignalBundle["dataforseo_serp_top5"];
    trends?: SignalBundle["trends"];
  }>;
}

export interface ScoringPrefetch {
  fetchBundle(ctx: PrefetchContext): Promise<SignalBundle>;
}

export interface BuildDefaultPrefetchOptions {
  affiliate: AffiliateSignalAdapter;
  keyword: KeywordSignalAdapter;
  wikipedia?: WikipediaClient;
  euipo?: EuipoClient;
  /** Operator's a-priori interest score (0..100). Default 50. */
  operatorInterest?: number;
}

/**
 * Wire the default public-source clients (Wikipedia + EUIPO) and bolt on the
 * injected affiliate + keyword adapters. The host kill-list check is run
 * synchronously so the agent sees the same verdict the job will enforce after.
 */
export function buildDefaultPrefetch(opts: BuildDefaultPrefetchOptions): ScoringPrefetch {
  const wiki = opts.wikipedia ?? new WikipediaClient();
  const euipo = opts.euipo ?? new EuipoClient();
  const operatorInterest = opts.operatorInterest ?? 50;

  return {
    async fetchBundle(ctx) {
      const [affiliate, kw, wikiSlope, trademark] = await Promise.all([
        opts.affiliate.fetch(ctx),
        opts.keyword.fetch(ctx),
        fetchWikiSlope(wiki, ctx),
        fetchTrademark(euipo, ctx),
      ]);

      const killHit = matchKillList({
        topic: ctx.candidate.topic,
        topicSlug: ctx.candidate.topic_slug,
        relatedKeywords: ctx.candidate.related_keywords,
      });

      const bundle: SignalBundle = {
        affiliate_availability: affiliate,
        dataforseo_keywords: kw.keywords,
        dataforseo_serp_top5: kw.serp,
        wikipedia: wikiSlope ? { pageview_90d_slope: wikiSlope } : undefined,
        trends: kw.trends,
        trademark,
        kill_list_match: killHit ? killHit.category.id : null,
        ymyl_match: killHit?.category.id.startsWith("ymyl_") ?? false,
        operator_interest: operatorInterest,
      };

      return bundle;
    },
  };
}

// ---------------------------------------------------------------------------
// Public-source helpers — defensively swallow per-source failures so a flaky
// edge doesn't kill the whole scoring job. A missing signal degrades the
// candidate score; a thrown error would drop it entirely.
// ---------------------------------------------------------------------------

async function fetchWikiSlope(
  client: WikipediaClient,
  ctx: PrefetchContext,
): Promise<number | undefined> {
  try {
    // Use the candidate's topic as the article title best-guess. NL first, EN
    // fallback — Wikipedia's URL-encoded title API tolerates either project.
    const end = ctx.asOf.slice(0, 10).replace(/-/g, "");
    const start = shiftIsoDays(ctx.asOf, -90).replace(/-/g, "");
    const article = ctx.candidate.topic.replace(/\s+/g, "_");
    const project = ctx.candidate.language === "nl" ? "nl.wikipedia" : "en.wikipedia";
    const resp = await client.pageviews({
      project,
      article,
      granularity: "daily",
      start,
      end,
    });
    return relativeSlope(resp.items.map((i) => i.views));
  } catch {
    return undefined;
  }
}

async function fetchTrademark(
  client: EuipoClient,
  ctx: PrefetchContext,
): Promise<SignalBundle["trademark"]> {
  try {
    // Brand-candidate heuristic: the topic itself + the first related keyword.
    const queries = [ctx.candidate.topic, ctx.candidate.related_keywords[0]].filter(
      (q): q is string => typeof q === "string" && q.length > 1,
    );
    const matchedMarks: string[] = [];
    for (const q of queries) {
      const r = await client.searchTrademarks({ basicSearch: q, pageSize: 5 });
      for (const hit of r.tradeMarks) {
        if (hit.status === "Registered" && hit.markVerbalElement) {
          matchedMarks.push(hit.markVerbalElement);
        }
      }
    }
    return matchedMarks.length > 0
      ? { euipo_tmview: "match", matched_marks: matchedMarks }
      : { euipo_tmview: "clear" };
  } catch {
    return { euipo_tmview: "unknown" };
  }
}

/**
 * Compute simple relative slope across an evenly-spaced time series:
 *   (mean of last third − mean of first third) / mean of first third.
 * Returns undefined when there isn't enough data to be meaningful.
 */
function relativeSlope(series: readonly number[]): number | undefined {
  if (series.length < 9) return undefined;
  const third = Math.floor(series.length / 3);
  const first = series.slice(0, third);
  const last = series.slice(-third);
  const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const a = mean(first);
  const b = mean(last);
  if (a === 0) return undefined;
  return (b - a) / a;
}

function shiftIsoDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
