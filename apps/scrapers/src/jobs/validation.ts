// Phase 3.3 — Validation job.
//
// For each niche in `validating` (or one operator-named niche), aggregate the
// validation-window metrics, run the Validation Agent, and write ONE
// validation_evaluations row holding the GO/PIVOT/KILL *recommendation*.
//
// This job NEVER changes niches.state. The operator confirms a recommendation
// in the admin UI, and only that confirmation transitions state (CLAUDE.md
// non-negotiable #1 + #13). Mirrors scoring.ts's injected-deps shape so it is
// unit-testable without live DB or LLM calls.

import { validationAgent } from "@nichefinder/agent-sdk";
import type { RunAgentRuntime } from "@nichefinder/agent-sdk";
import { type ServiceDb, niches, validationEvaluations } from "@nichefinder/db";
import { eq } from "drizzle-orm";
import { type AnalyticsAdapter, buildValidationInput } from "./validationMetrics.js";

export interface RunValidationJobOptions {
  db: ServiceDb;
  runtime: RunAgentRuntime;
  /** Sessions/bounce/spend source. Defaults to the zero adapter. */
  analytics?: AnalyticsAdapter;
  /** Validate only this niche (operator on-demand). Default: all `validating`. */
  nicheId?: string;
  /** Max niches to validate in one run. Default 25. */
  limit?: number;
  /** Validation window in days. Default 14. */
  windowDays?: number;
  /** ISO timestamp the window is measured back from. Default now. */
  asOf?: string;
}

export interface ValidationJobOutcome {
  nicheId: string;
  topicSlug: string;
  decision: validationAgent.ValidationDecision;
  modelDecision: validationAgent.ValidationDecision;
  amended: boolean;
  evaluationId: string | null;
}

export interface RunValidationJobResult {
  nichesConsidered: number;
  evaluated: number;
  skippedNoData: number;
  outcomes: ValidationJobOutcome[];
  failures: Array<{ nicheId: string; topicSlug: string; error: string }>;
  totalCostEur: number;
}

export async function runValidationJob(
  opts: RunValidationJobOptions,
): Promise<RunValidationJobResult> {
  const limit = opts.limit ?? 25;
  const windowDays = opts.windowDays ?? 14;
  const asOf = opts.asOf ?? new Date().toISOString();

  const candidates = await selectNiches(opts.db, opts.nicheId, limit);

  const result: RunValidationJobResult = {
    nichesConsidered: candidates.length,
    evaluated: 0,
    skippedNoData: 0,
    outcomes: [],
    failures: [],
    totalCostEur: 0,
  };

  for (const niche of candidates) {
    try {
      const input = await buildValidationInput({
        db: opts.db,
        nicheId: niche.id,
        analytics: opts.analytics,
        windowDays,
        asOf,
      });

      if (input === null) {
        result.skippedNoData += 1;
        continue;
      }

      const run = await validationAgent.runValidationAgent(opts.runtime, input);
      result.totalCostEur += run.costEur;

      const inserted = await opts.db
        .insert(validationEvaluations)
        .values({
          nicheId: niche.id,
          windowDays,
          decision: run.output.decision,
          confidence: run.output.confidence,
          modelDecision: run.modelDecision,
          safeguardReason: run.safeguard.amendedReason,
          rationale: run.output.rationale,
          keyMetrics: run.output.key_metrics,
          nextActions: run.output.next_actions,
          metrics: input,
          agentRunId: run.agentRunId,
        })
        .returning({ id: validationEvaluations.id });

      result.evaluated += 1;
      result.outcomes.push({
        nicheId: niche.id,
        topicSlug: niche.topicSlug,
        decision: run.output.decision,
        modelDecision: run.modelDecision,
        amended: run.safeguard.amended,
        evaluationId: inserted[0]?.id ?? null,
      });
    } catch (err) {
      result.failures.push({
        nicheId: niche.id,
        topicSlug: niche.topicSlug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// -----------------------------------------------------------------------------
// Selection: one niche (operator) or all in `validating`.
// -----------------------------------------------------------------------------

interface NicheRow {
  id: string;
  topicSlug: string;
}

async function selectNiches(
  db: ServiceDb,
  nicheId: string | undefined,
  limit: number,
): Promise<NicheRow[]> {
  if (nicheId) {
    const rows = await db
      .select({ id: niches.id, topicSlug: niches.topicSlug })
      .from(niches)
      .where(eq(niches.id, nicheId))
      .limit(1);
    return rows;
  }

  return db
    .select({ id: niches.id, topicSlug: niches.topicSlug })
    .from(niches)
    .where(eq(niches.state, "validating"))
    .limit(limit);
}
