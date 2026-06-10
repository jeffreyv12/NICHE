// Phase 5.4 — Promotion evaluation job (5.4.2–5.4.3).
//
// Cron: Sun 04:00 NL. For each niche in `building` or `mature` state, gather
// 90-day metrics from the DB, then call the Promotion Agent (Opus 4.7) to
// evaluate the 7-criterion promotion gate.
//
// NEVER auto-promotes. Writes a `promotion_evaluations` row; the operator
// acts on a "Ready to promote" card in the admin UI (CLAUDE.md #1 + #10).
//
// Domain availability checks are injectable via CandidateDomainAdapter so the
// job is unit-testable without live registrar credentials.

import { promotionAgent } from "@nichefinder/agent-sdk";
import type { RunAgentRuntime } from "@nichefinder/agent-sdk";
import {
  type ServiceDb,
  gscMetrics,
  nicheMonthlyMetrics,
  niches,
  promotionEvaluations,
} from "@nichefinder/db";
import { toRevenueSeries } from "@nichefinder/shared";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CandidateDomainAdapter {
  /** Return up to 5 candidate domains for a niche. */
  getCandidates(nicheSlug: string): Promise<promotionAgent.PromotionInput["candidate_domains"]>;
}

export interface RunPromotionJobOptions {
  db: ServiceDb;
  runtime: RunAgentRuntime;
  /** Override the domain lookup for tests. Defaults to stub adapter. */
  domainAdapter?: CandidateDomainAdapter;
  /** ISO timestamp for "now". Default: real now. */
  asOf?: string;
  /** Evaluate only this niche (operator on-demand). */
  nicheId?: string;
  /** Max niches per run. Default 5 (Opus is expensive). */
  limit?: number;
  /** Skip niches evaluated within this many days. Default 7. */
  cooldownDays?: number;
}

export interface PromotionJobNicheResult {
  nicheId: string;
  topicSlug: string;
  result: promotionAgent.PromotionResult;
  resultAmended: boolean;
  agentRunId: string;
  costEur: number;
  evaluationId: string;
}

export interface RunPromotionJobResult {
  considered: number;
  evaluated: PromotionJobNicheResult[];
  skipped: number;
  totalCostEur: number;
  failures: Array<{ nicheId: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Stub domain adapter
// ---------------------------------------------------------------------------

/** Default adapter: generates a synthetic placeholder from the niche slug.
 *  Always available=false because we haven't checked the registrar.
 *  Replace with a real adapter once Cloudflare/TransIP creds are available. */
export function createStubDomainAdapter(): CandidateDomainAdapter {
  return {
    async getCandidates(nicheSlug) {
      return [
        {
          hostname: `${nicheSlug}.nl`,
          registrar: "transip" as const,
          cost_eur_year: 8,
          available: false,
          tmview_clear: true,
        },
        {
          hostname: `${nicheSlug}.com`,
          registrar: "cloudflare" as const,
          cost_eur_year: 12,
          available: false,
          tmview_clear: true,
        },
      ];
    },
  };
}

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

export async function runPromotionJob(
  opts: RunPromotionJobOptions,
): Promise<RunPromotionJobResult> {
  const asOf = new Date(opts.asOf ?? new Date().toISOString());
  const cooldownDays = opts.cooldownDays ?? 7;
  const limit = opts.limit ?? 5;
  const domainAdapter = opts.domainAdapter ?? createStubDomainAdapter();

  const targets = await selectEligibleNiches(opts.db, asOf, cooldownDays, limit, opts.nicheId);

  const result: RunPromotionJobResult = {
    considered: targets.length,
    evaluated: [],
    skipped: 0,
    totalCostEur: 0,
    failures: [],
  };

  for (const niche of targets) {
    try {
      const r = await evaluateOne(opts.db, opts.runtime, domainAdapter, niche, asOf);
      result.evaluated.push(r);
      result.totalCostEur += r.costEur;
    } catch (err) {
      result.failures.push({
        nicheId: niche.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

interface NicheRow {
  id: string;
  tenantId: string | null;
  topic: string;
  topicSlug: string;
  state: string;
  buildingStartedAt: Date | null;
  matureAt: Date | null;
}

async function selectEligibleNiches(
  db: ServiceDb,
  asOf: Date,
  cooldownDays: number,
  limit: number,
  onlyNicheId?: string,
): Promise<NicheRow[]> {
  const cutoff = new Date(asOf.getTime() - cooldownDays * 86_400_000).toISOString();

  // Find niches that were evaluated recently (within cooldown) to skip them.
  const recentlyEvaluated = await db
    .select({ nicheId: promotionEvaluations.nicheId })
    .from(promotionEvaluations)
    .where(gte(promotionEvaluations.evaluatedAt, new Date(cutoff)));

  const recentIds = new Set(recentlyEvaluated.map((r) => r.nicheId));

  const candidates = (await db
    .select({
      id: niches.id,
      tenantId: niches.tenantId,
      topic: niches.topic,
      topicSlug: niches.topicSlug,
      state: niches.state,
      buildingStartedAt: niches.buildingStartedAt,
      matureAt: niches.matureAt,
    })
    .from(niches)
    .where(
      onlyNicheId ? eq(niches.id, onlyNicheId) : inArray(niches.state, ["building", "mature"]),
    )) as NicheRow[];

  return candidates.filter((n) => n.tenantId && !recentIds.has(n.id)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Evaluate a single niche
// ---------------------------------------------------------------------------

async function evaluateOne(
  db: ServiceDb,
  runtime: RunAgentRuntime,
  domainAdapter: CandidateDomainAdapter,
  niche: NicheRow,
  asOf: Date,
): Promise<PromotionJobNicheResult> {
  if (!niche.tenantId) throw new Error(`niche ${niche.id} has no tenant_id`);

  const stateEnteredAt = niche.matureAt ?? niche.buildingStartedAt ?? asOf;
  const daysInState = Math.max(
    0,
    Math.floor((asOf.getTime() - stateEnteredAt.getTime()) / 86_400_000),
  );

  const [revSeries, clicksSeries, brandedClicksPerMonth, nonBrandLongTailShare, medianBotScore] =
    await Promise.all([
      fetchRevenueSeries(db, niche.id, asOf),
      fetchClicksSeries(db, niche.tenantId, asOf),
      fetchBrandedClicksPerMonth(db, niche.tenantId, asOf),
      fetchNonBrandLongTailShare(db, niche.tenantId, asOf),
      fetchMedianBotScore(db, niche.tenantId, asOf),
    ]);

  const candidateDomains = await domainAdapter.getCandidates(niche.topicSlug);

  const input: promotionAgent.PromotionInput = {
    niche: {
      topic: niche.topic,
      topic_slug: niche.topicSlug,
      current_state: niche.state,
      days_in_state: daysInState,
    },
    metrics_90d: {
      approved_revenue_per_month_eur: revSeries,
      organic_clicks_per_month: clicksSeries,
      non_brand_long_tail_share: nonBrandLongTailShare,
      affiliate_sources_share: {},
      single_product_share_max: 0,
      branded_queries_per_month: brandedClicksPerMonth,
      engagement: {
        // Time-on-page and scroll depth are not stored in the DB yet.
        // Defaults keep the gate conservative (lower = harder to pass).
        median_time_on_page_seconds: 0,
        median_scroll_depth: 0,
        median_bot_score: medianBotScore,
        bounce_rate: 0,
      },
    },
    algorithm_events_30d: [],
    gsc_manual_actions_30d: [],
    candidate_domains: candidateDomains,
  };

  const run = await promotionAgent.runPromotionAgent(runtime, input);

  const evalRow = await db
    .insert(promotionEvaluations)
    .values({
      nicheId: niche.id,
      result: run.output.result as
        | "ready"
        | "not_ready"
        | "blocked_by_update_window"
        | "blocked_by_single_source",
      criteria: run.output.criteria,
      recommendation: run.output.recommendation,
      agentRunId: run.agentRunId,
    })
    .returning({ id: promotionEvaluations.id });

  const evaluationId = evalRow[0]?.id ?? "";

  return {
    nicheId: niche.id,
    topicSlug: niche.topicSlug,
    result: run.output.result,
    resultAmended: run.resultAmended,
    agentRunId: run.agentRunId,
    costEur: run.costEur,
    evaluationId,
  };
}

// ---------------------------------------------------------------------------
// Metric helpers
// ---------------------------------------------------------------------------

function monthStart(asOf: Date, monthsBack: number): string {
  const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - monthsBack, 1));
  return d.toISOString().slice(0, 10);
}

function monthEnd(asOf: Date, monthsBack: number): string {
  const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - monthsBack + 1, 0));
  return d.toISOString().slice(0, 10);
}

// C1 revenue — PER-NICHE monthly close (migration 0009). Reads the immutable
// monthly rows persisted by the niche-monthly-metrics rollup job, NOT tenant-
// wide conversions, so a niche is judged on its OWN pages' revenue. (Before
// 0009 this summed conversions by tenant_id — wrong grain under the subfolder
// model.) Run `niche-monthly-metrics-once` before the promotion job so closes
// are fresh; a missing month is treated as €0 by toRevenueSeries.
async function fetchRevenueSeries(
  db: ServiceDb,
  nicheId: string,
  asOf: Date,
): Promise<[number, number, number]> {
  const rows = await db
    .select({
      month: nicheMonthlyMetrics.month,
      revenueEur: nicheMonthlyMetrics.revenueEur,
    })
    .from(nicheMonthlyMetrics)
    .where(eq(nicheMonthlyMetrics.nicheId, nicheId));

  return toRevenueSeries(
    rows.map((r) => ({ month: r.month, revenueEur: Number(r.revenueEur) })),
    asOf,
  );
}

async function fetchClicksSeries(
  db: ServiceDb,
  tenantId: string,
  asOf: Date,
): Promise<[number, number, number]> {
  const months = [2, 1, 0].map((back) => ({
    start: monthStart(asOf, back),
    end: monthEnd(asOf, back),
  }));

  const series = await Promise.all(
    months.map(async ({ start, end }) => {
      const rows = await db
        .select({ total: sql<string>`coalesce(sum(clicks),0)` })
        .from(gscMetrics)
        .where(
          and(
            eq(gscMetrics.tenantId, tenantId),
            gte(gscMetrics.date, start),
            sql`date <= ${end}::date`,
          ),
        );
      return Number(rows[0]?.total ?? 0);
    }),
  );

  return series as [number, number, number];
}

async function fetchBrandedClicksPerMonth(
  db: ServiceDb,
  tenantId: string,
  asOf: Date,
): Promise<number> {
  const start = monthStart(asOf, 0);
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(branded_clicks),0)` })
    .from(gscMetrics)
    .where(and(eq(gscMetrics.tenantId, tenantId), gte(gscMetrics.date, start)));
  return Number(rows[0]?.total ?? 0);
}

async function fetchNonBrandLongTailShare(
  db: ServiceDb,
  tenantId: string,
  asOf: Date,
): Promise<number> {
  const start = monthStart(asOf, 2);
  const rows = await db
    .select({
      totalClicks: sql<string>`coalesce(sum(clicks),0)`,
      nonBrand: sql<string>`coalesce(sum(non_brand_long_tail_clicks),0)`,
    })
    .from(gscMetrics)
    .where(and(eq(gscMetrics.tenantId, tenantId), gte(gscMetrics.date, start)));

  const total = Number(rows[0]?.totalClicks ?? 0);
  const nb = Number(rows[0]?.nonBrand ?? 0);
  return total > 0 ? nb / total : 0;
}

async function fetchMedianBotScore(db: ServiceDb, tenantId: string, asOf: Date): Promise<number> {
  const cutoff = new Date(asOf.getTime() - 30 * 86_400_000).toISOString();
  // Use percentile_cont for a true median; fall back to 0 if no rows.
  const rows = await db.execute(
    sql`select coalesce(percentile_cont(0.5) within group (order by bot_score),0) as median
        from clicks
        where tenant_id = ${tenantId}
          and is_bot = false
          and occurred_at >= ${cutoff}::timestamptz
          and bot_score is not null`,
  );
  return Number((rows[0] as { median?: string } | undefined)?.median ?? 0);
}
