// scoring@1.0.0 — applies the 10-criterion rubric to a single niche candidate.
//
// Phase 2.3 deliverable per PHASE_PLAN.md:
//   2.3.1 Prompt wired (Haiku first pass + Sonnet escalation)
//   2.3.3 Output validated against rubric Zod schema (schema.ts)
//   2.3.5 Borderline escalation in runScoringWithEscalation()
//
// 2.3.2 (pre-fetch routine) and 2.3.4/2.3.6 (DB writes + cron) live in
// apps/scrapers — this module is the runtime-agnostic core.
//
// Trust model (CLAUDE.md non-negotiable: defense in depth):
//   - The model reports total_score and block_reason; the host
//     ALWAYS recomputes the weighted total from the breakdown and
//     ALWAYS re-checks host-known hard blocks (kill list, killed/active slug).
//   - On mismatch, host values win and the discrepancy is returned for logging.

import {
  CLAUDE_MODEL_STRINGS,
  type CriterionKey,
  type HardBlockReason,
  type KillListMatch,
  RUBRIC_VERSION,
  computeTotalScore,
  matchKillList as matchKillListShared,
  shouldEscalate,
} from "@nichefinder/shared";
import { type RunAgentRuntime, runAgent } from "../../runAgent";
import { SCORING_AGENT_VERSION, SCORING_SYSTEM_PROMPT } from "./prompt";
import {
  type ScoringCandidate,
  type ScoringInput,
  ScoringInputSchema,
  type ScoringOutput,
  ScoringOutputSchema,
  type ScoringSignalBundle,
} from "./schema";

export { SCORING_AGENT_VERSION, SCORING_SYSTEM_PROMPT, ScoringInputSchema, ScoringOutputSchema };
export type { ScoringCandidate, ScoringInput, ScoringOutput, ScoringSignalBundle };

// ---------------------------------------------------------------------------
// Host-side hard-block evaluator. Returns the strongest reason or null.
// Order matches the rubric's hard-block table priority.
// ---------------------------------------------------------------------------

export interface HostBlockResult {
  reason: HardBlockReason | null;
  killListMatch?: KillListMatch | null;
}

export function evaluateHostBlocks(input: ScoringInput): HostBlockResult {
  const { candidate, signals, killedSlugs, activeSlugs } = input;

  // Kill-list takes precedence over duplicates: it's the categorical reason.
  const klm = matchKillListShared({
    topic: candidate.topic,
    topicSlug: candidate.topic_slug,
    relatedKeywords: candidate.related_keywords,
  });
  if (klm) return { reason: "kill_list", killListMatch: klm };

  if (signals.ymyl_match) return { reason: "ymyl" };
  if (signals.trademark.euipo_tmview === "match") return { reason: "trademark" };
  if (killedSlugs.includes(candidate.topic_slug)) return { reason: "duplicate_killed" };
  if (activeSlugs.includes(candidate.topic_slug)) return { reason: "duplicate_active" };

  return { reason: null };
}

// ---------------------------------------------------------------------------
// Result reconciliation — what the model returned vs what the host enforces.
// ---------------------------------------------------------------------------

export interface ReconciledScore {
  /** Final output: model breakdown + host-recomputed total + host-enforced block. */
  output: ScoringOutput;
  /** True if host enforcement changed total or block_reason. */
  amended: boolean;
  /** What the model originally claimed (preserved for telemetry). */
  modelClaimed: { total: number; blockReason: ScoringOutput["block_reason"] };
  /** Whether the model's reported total disagreed with weighted recomputation. */
  totalDriftDelta: number;
}

/**
 * Apply the trust model: host recomputes weighted total and re-enforces blocks.
 * Pure — no I/O — so it's trivially testable.
 */
export function reconcileScore(
  modelOutput: ScoringOutput,
  hostBlock: HostBlockResult,
): ReconciledScore {
  // 1. Recompute weighted total from the breakdown (ignores any model arithmetic drift).
  const breakdownForTotal = Object.fromEntries(
    Object.entries(modelOutput.breakdown).filter(([k]) => k !== "haiku_first_pass"),
  ) as Record<CriterionKey, { score: number; evidence: unknown }>;
  const hostTotal = computeTotalScore(breakdownForTotal);
  const totalDriftDelta = modelOutput.total_score - hostTotal;

  // 2. Host block wins over the model's block_reason. Either side firing → 0.
  const finalBlockReason: ScoringOutput["block_reason"] =
    hostBlock.reason ?? modelOutput.block_reason ?? null;
  const finalTotal = finalBlockReason ? 0 : hostTotal;

  const amended =
    finalTotal !== modelOutput.total_score || finalBlockReason !== modelOutput.block_reason;

  return {
    output: {
      ...modelOutput,
      total_score: finalTotal,
      block_reason: finalBlockReason,
    },
    amended,
    modelClaimed: {
      total: modelOutput.total_score,
      blockReason: modelOutput.block_reason,
    },
    totalDriftDelta,
  };
}

// ---------------------------------------------------------------------------
// User-turn message — keep order stable for prompt-cache hit ratio.
// ---------------------------------------------------------------------------

function buildUserMessage(input: ScoringInput): string {
  const { candidate, signals } = input;
  const lines: string[] = [
    "Score this candidate.",
    "",
    "candidate:",
    `  topic: ${JSON.stringify(candidate.topic)}`,
    `  topic_slug: ${JSON.stringify(candidate.topic_slug)}`,
    `  language: ${JSON.stringify(candidate.language)}`,
    `  related_keywords: ${JSON.stringify(candidate.related_keywords)}`,
    "",
    "pre-fetched data:",
    `  affiliate_availability: ${JSON.stringify(signals.affiliate_availability)}`,
    `  dataforseo_keywords: ${JSON.stringify(signals.dataforseo_keywords)}`,
    `  dataforseo_serp_top5: ${JSON.stringify(signals.dataforseo_serp_top5)}`,
  ];
  if (signals.wikipedia) lines.push(`  wikipedia: ${JSON.stringify(signals.wikipedia)}`);
  if (signals.trends) lines.push(`  trends: ${JSON.stringify(signals.trends)}`);
  lines.push(`  trademark: ${JSON.stringify(signals.trademark)}`);
  lines.push(
    `  kill_list: ${signals.kill_list_match ? JSON.stringify(signals.kill_list_match) : "no match"}`,
  );
  lines.push(`  ymyl: ${signals.ymyl_match ? "match" : "no match"}`);
  lines.push(`  operator_interest: ${signals.operator_interest}`);

  if (input.haikuFirstPass !== undefined) {
    lines.push("", "haiku_first_pass:", JSON.stringify(input.haikuFirstPass, null, 2));
    lines.push(
      "",
      "You are the Sonnet escalation pass. Re-evaluate any criteria where Haiku's evidence looks misread.",
    );
  }

  lines.push("", "Return strict JSON matching the output shape. No prose outside JSON.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public runners
// ---------------------------------------------------------------------------

export interface RunScoringResult extends ReconciledScore {
  agentRunId: string;
  costEur: number;
}

/**
 * Single Haiku pass. Use this directly only when you've already decided not to
 * escalate; otherwise call runScoringWithEscalation.
 */
export async function runScoringAgentHaiku(
  runtime: RunAgentRuntime,
  input: ScoringInput,
): Promise<RunScoringResult> {
  return runScoringPass(runtime, input, CLAUDE_MODEL_STRINGS.haiku);
}

/**
 * Single Sonnet pass. The caller must populate `haikuFirstPass` in the input.
 */
export async function runScoringAgentSonnet(
  runtime: RunAgentRuntime,
  input: ScoringInput,
): Promise<RunScoringResult> {
  if (input.haikuFirstPass === undefined) {
    throw new Error("runScoringAgentSonnet requires haikuFirstPass in input");
  }
  return runScoringPass(runtime, input, CLAUDE_MODEL_STRINGS.sonnet);
}

export interface RunScoringWithEscalationResult {
  /** Final reconciled result the caller should persist. */
  final: RunScoringResult;
  /** Always populated — the Haiku first pass result. */
  haiku: RunScoringResult;
  /** Populated when Haiku scored in the 55–70 band and escalation ran. */
  sonnet?: RunScoringResult;
  /** Convenience: was the escalation actually triggered? */
  escalated: boolean;
}

/**
 * The end-to-end scoring flow per docs/NICHE_SCORING_RUBRIC.md "Borderline escalation":
 * 1. Run Haiku.
 * 2. If host-reconciled total lands in [55, 70], re-run on Sonnet with Haiku's
 *    breakdown attached as `haiku_first_pass`. Final stored score = Sonnet's.
 * 3. Otherwise return Haiku's result.
 *
 * Hard-blocked candidates never escalate — a zero score is decisive.
 */
export async function runScoringWithEscalation(
  runtime: RunAgentRuntime,
  input: ScoringInput,
): Promise<RunScoringWithEscalationResult> {
  const haiku = await runScoringAgentHaiku(runtime, input);

  // Hard block is decisive; no need to spend Sonnet tokens.
  if (haiku.output.block_reason !== null) {
    return { final: haiku, haiku, escalated: false };
  }

  if (!shouldEscalate(haiku.output.total_score)) {
    return { final: haiku, haiku, escalated: false };
  }

  const sonnet = await runScoringAgentSonnet(runtime, {
    ...input,
    haikuFirstPass: haiku.output.breakdown,
  });

  // Stitch Haiku's breakdown into Sonnet's output for downstream auditability.
  const stitched: ScoringOutput = {
    ...sonnet.output,
    breakdown: { ...sonnet.output.breakdown, haiku_first_pass: haiku.output.breakdown },
  };
  const final: RunScoringResult = { ...sonnet, output: stitched };

  return { final, haiku, sonnet, escalated: true };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function runScoringPass(
  runtime: RunAgentRuntime,
  input: ScoringInput,
  model: typeof CLAUDE_MODEL_STRINGS.haiku | typeof CLAUDE_MODEL_STRINGS.sonnet,
): Promise<RunScoringResult> {
  const { output, agentRunId, costEur } = await runAgent<ScoringInput, ScoringOutput>(
    {
      agent: "scoring",
      model,
      systemPrompt: SCORING_SYSTEM_PROMPT,
      inputSchema: ScoringInputSchema,
      outputSchema: ScoringOutputSchema,
      buildUserMessage,
      // One candidate's worth of JSON; well under the model's window.
      maxTokens: 4_000,
    },
    runtime,
    input,
  );

  // Defense in depth: rubric_version check is also a sanity gate against a
  // stale prompt deployment talking to a fresh rubric.
  if (output.rubric_version !== RUBRIC_VERSION) {
    throw new Error(
      `scoring: model returned rubric_version=${output.rubric_version}, expected ${RUBRIC_VERSION}`,
    );
  }

  const hostBlock = evaluateHostBlocks(input);
  const reconciled = reconcileScore(output, hostBlock);
  return { ...reconciled, agentRunId, costEur };
}
