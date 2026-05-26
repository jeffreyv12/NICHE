// Scoring job (Phase 2.3.4 + 2.3.6).
//
// Selects unscored niche_candidates from a recent window, prefetches the
// signal bundle, runs the scoring agent with the Haiku→Sonnet escalation
// flow, and writes one niche_scores row per candidate. Designed to run on
// Hetzner under cron — see `apps/scrapers/src/bin/scoring-once.ts`.
//
// The job is intentionally written around injected dependencies (db, runtime,
// prefetch) so tests can drive it without I/O.

import { scoringAgent } from "@nichefinder/agent-sdk";
import type { RunAgentRuntime } from "@nichefinder/agent-sdk";
import { type ServiceDb, nicheCandidates, nicheScores } from "@nichefinder/db";
import { RUBRIC_VERSION } from "@nichefinder/shared";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { ScoringPrefetch } from "./prefetch.js";

export interface RunScoringJobOptions {
  db: ServiceDb;
  runtime: RunAgentRuntime;
  prefetch: ScoringPrefetch;
  /** Max candidates to score in one run. Default 25. */
  limit?: number;
  /** Look-back window for unscored candidates. Default 24h. */
  withinHours?: number;
  /** ISO timestamp passed to prefetch; defaults to now. */
  asOf?: string;
}

export interface RunScoringJobResult {
  candidatesConsidered: number;
  scored: number;
  blockedByHost: number;
  escalated: number;
  failures: Array<{ candidateId: string; topicSlug: string; error: string }>;
  totalCostEur: number;
}

/**
 * Run one scoring batch. Idempotency: a candidate is "scored" if there is any
 * niche_scores row for it in the look-back window. Re-running the job within
 * the window won't double-score.
 */
export async function runScoringJob(opts: RunScoringJobOptions): Promise<RunScoringJobResult> {
  const limit = opts.limit ?? 25;
  const withinHours = opts.withinHours ?? 24;
  const asOf = opts.asOf ?? new Date().toISOString();
  const sinceCutoff = new Date(Date.now() - withinHours * 3_600_000);

  const candidates = await selectUnscored(opts.db, limit, sinceCutoff);

  const result: RunScoringJobResult = {
    candidatesConsidered: candidates.length,
    scored: 0,
    blockedByHost: 0,
    escalated: 0,
    failures: [],
    totalCostEur: 0,
  };

  for (const cand of candidates) {
    try {
      const signals = await opts.prefetch.fetchBundle({
        candidate: {
          topic: cand.topic,
          topic_slug: cand.topicSlug,
          language: inferLanguage(cand.topic),
          related_keywords: cand.relatedKeywords.length > 0 ? cand.relatedKeywords : [cand.topic],
        },
        asOf,
      });

      const run = await scoringAgent.runScoringWithEscalation(opts.runtime, {
        candidate: {
          topic: cand.topic,
          topic_slug: cand.topicSlug,
          language: inferLanguage(cand.topic),
          related_keywords: cand.relatedKeywords.length > 0 ? cand.relatedKeywords : [cand.topic],
        },
        signals,
        killedSlugs: [],
        activeSlugs: [],
      });

      result.totalCostEur += run.haiku.costEur + (run.sonnet?.costEur ?? 0);
      if (run.escalated) result.escalated += 1;
      if (run.final.output.block_reason !== null) result.blockedByHost += 1;

      await opts.db.insert(nicheScores).values({
        candidateId: cand.id,
        model: run.escalated ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001",
        totalScore: run.final.output.total_score,
        breakdown: run.final.output.breakdown,
        rubricVersion: RUBRIC_VERSION,
        agentRunId: run.final.agentRunId,
        notes: run.final.output.notes,
      });
      result.scored += 1;
    } catch (err) {
      result.failures.push({
        candidateId: cand.id,
        topicSlug: cand.topicSlug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Query: unscored candidates surfaced inside the look-back window. We use a
// NOT EXISTS-style join via a correlated subquery so the latest score (if
// any) counts; one score in the window is enough to skip.
// ---------------------------------------------------------------------------

interface UnscoredCandidate {
  id: string;
  topic: string;
  topicSlug: string;
  relatedKeywords: string[];
}

async function selectUnscored(
  db: ServiceDb,
  limit: number,
  since: Date,
): Promise<UnscoredCandidate[]> {
  const latestScore = db
    .select({
      candidateId: nicheScores.candidateId,
      lastScoredAt: sql<Date>`max(${nicheScores.scoredAt})`.as("last_scored_at"),
    })
    .from(nicheScores)
    .groupBy(nicheScores.candidateId)
    .as("latest_score");

  const rows: Array<{
    id: string;
    topic: string;
    topicSlug: string;
    relatedKeywords: string[] | null;
  }> = await db
    .select({
      id: nicheCandidates.id,
      topic: nicheCandidates.topic,
      topicSlug: nicheCandidates.topicSlug,
      relatedKeywords: nicheCandidates.relatedKeywords,
    })
    .from(nicheCandidates)
    .leftJoin(latestScore, eq(latestScore.candidateId, nicheCandidates.id))
    .where(
      and(
        gt(nicheCandidates.surfacedAt, since),
        // No prior score, OR the most recent score is older than the cutoff.
        sql`(${latestScore.lastScoredAt} is null or ${latestScore.lastScoredAt} < ${since})`,
      ),
    )
    .orderBy(desc(nicheCandidates.surfacedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    topicSlug: r.topicSlug,
    relatedKeywords: r.relatedKeywords ?? [],
  }));
}

/**
 * Cheap NL/EN inference from the topic itself. Discovery stores `language` on
 * the agent payload but not on the candidate row; we approximate it for the
 * scoring agent's candidate field. Defaults to "nl" — that's our market.
 */
function inferLanguage(topic: string): "nl" | "en" {
  const lower = topic.toLowerCase();
  // Cheap proxy: common English stopwords → likely EN.
  if (/\b(for|with|best|the|of|and)\b/.test(lower)) return "en";
  return "nl";
}
