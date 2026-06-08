// Phase 2.2 — Discovery job.
//
// Runs nightly (Sun 02:00 NL) via apps/scrapers/src/bin/discovery-once.ts.
//
// Flow: gather signals → call discovery agent (Haiku) → kill-list pre-filter
// (inside runDiscoveryAgent) → EUIPO trademark screen → write survivors to
// niche_candidates table.
//
// CLAUDE.md non-negotiable #2: kill-list candidates are DROPPED — they are
// counted in the result for telemetry but never written to the DB.

import { type RunAgentRuntime, discoveryAgent } from "@nichefinder/agent-sdk";
import { type ServiceDb, nicheCandidates, niches } from "@nichefinder/db";
import { gte } from "drizzle-orm";

// DiscoverySignal shape derived from the agent SDK's public types.
export type DiscoverySignal = discoveryAgent.DiscoveryInput["signals"][number];

export type SignalGatherer = () => Promise<DiscoverySignal[]>;

export interface EuipoAdapter {
  hasActiveMatch(term: string): Promise<{ hit: boolean; total: number }>;
}

export interface RunDiscoveryJobOptions {
  db: ServiceDb;
  runtime: RunAgentRuntime;
  /** Signal gatherers run in parallel; individual failures are skipped. */
  gatherers: SignalGatherer[];
  /** Optional EUIPO trademark screen on kill-list survivors. */
  euipo?: EuipoAdapter;
  /** Hard cap passed to agent (schema max 200). Default 150. */
  maxSignals?: number;
  /** How many days back to scan for existing slugs to exclude. Default 30. */
  excludeLookbackDays?: number;
}

export interface RunDiscoveryJobResult {
  signalsGathered: number;
  candidatesFromAgent: number;
  killedByKillList: number;
  killedByTrademark: number;
  written: number;
  totalCostEur: number;
  agentRunId: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function loadExcludeSlugs(db: ServiceDb, lookbackDays: number): Promise<string[]> {
  const since = new Date(Date.now() - lookbackDays * 86_400_000);

  const [recentCandidates, allNiches] = await Promise.all([
    db
      .select({ topicSlug: nicheCandidates.topicSlug })
      .from(nicheCandidates)
      .where(gte(nicheCandidates.createdAt, since)),
    db.select({ topicSlug: niches.topicSlug }).from(niches),
  ]);

  const slugs = new Set<string>();
  for (const r of recentCandidates) slugs.add(r.topicSlug);
  for (const r of allNiches) slugs.add(r.topicSlug);
  return [...slugs];
}

// ---------------------------------------------------------------------------
// Main job
// ---------------------------------------------------------------------------

export async function runDiscoveryJob(
  opts: RunDiscoveryJobOptions,
): Promise<RunDiscoveryJobResult> {
  const maxSignals = opts.maxSignals ?? 150;
  const excludeLookbackDays = opts.excludeLookbackDays ?? 30;
  const gatheredAt = new Date().toISOString();

  // 1. Gather signals from all sources in parallel — individual source failures
  //    are tolerated so one broken API doesn't silence the whole run.
  const settled = await Promise.allSettled(opts.gatherers.map((g) => g()));
  const allSignals: DiscoverySignal[] = settled
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .slice(0, maxSignals);

  if (allSignals.length === 0) {
    return {
      signalsGathered: 0,
      candidatesFromAgent: 0,
      killedByKillList: 0,
      killedByTrademark: 0,
      written: 0,
      totalCostEur: 0,
      agentRunId: "",
    };
  }

  // 2. Load slugs already in the pipeline to suppress re-surfacing.
  const excludeSlugs = await loadExcludeSlugs(opts.db, excludeLookbackDays);

  // 3. Agent call + host-side kill-list filter (applyKillList is called inside).
  const agentResult = await discoveryAgent.runDiscoveryAgent(opts.runtime, {
    gatheredAt,
    signals: allSignals,
    excludeSlugs,
  });

  const candidatesFromAgent = agentResult.candidates.length + agentResult.killed.length;

  // 4. EUIPO trademark screen on surviving candidates.
  let killedByTrademark = 0;
  let written = 0;

  for (const candidate of agentResult.candidates) {
    let trademarkCheckState = "pending";
    let trademarkConflicts: { total: number; term: string } | null = null;

    if (opts.euipo) {
      try {
        const tm = await opts.euipo.hasActiveMatch(candidate.topic);
        if (tm.hit) {
          killedByTrademark++;
          trademarkCheckState = "conflict";
          trademarkConflicts = { total: tm.total, term: candidate.topic };
        }
      } catch {
        // Non-fatal — proceed as pending so the operator can re-check later.
      }
    }

    await opts.db.insert(nicheCandidates).values({
      source: candidate.evidence.source,
      raw: candidate.evidence.raw_signal,
      topic: candidate.topic,
      topicSlug: candidate.topic_slug,
      relatedKeywords: candidate.related_keywords,
      trademarkCheckState,
      trademarkConflicts: trademarkConflicts ?? undefined,
    });

    if (trademarkCheckState === "pending") written++;
  }

  // Kill-list killed candidates are NOT written to the DB (CLAUDE.md #2).
  // They are counted for telemetry only.

  return {
    signalsGathered: allSignals.length,
    candidatesFromAgent,
    killedByKillList: agentResult.killed.length,
    killedByTrademark,
    written,
    totalCostEur: agentResult.costEur,
    agentRunId: agentResult.agentRunId,
  };
}
