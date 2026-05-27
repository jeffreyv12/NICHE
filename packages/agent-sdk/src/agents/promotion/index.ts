// promotion@1.0.0 — evaluates the 7-criterion promotion gate.
//
// CLAUDE.md non-negotiable #10: the gate is deliberately strict and slow.
// The agent never acts — it produces evaluations. Domain registration is
// gated on operator confirmation in the admin UI (non-negotiable #1).
//
// Host post-checks: the model's `result` is verified against a small,
// mechanical re-evaluation of two unambiguous criteria (revenue floor +
// algorithm window). On mismatch, the host result wins and `result_amended`
// flags the discrepancy.

import { CLAUDE_MODEL_STRINGS } from "@nichefinder/shared";
import { type RunAgentRuntime, runAgent } from "../../runAgent";
import { PROMOTION_AGENT_VERSION, PROMOTION_SYSTEM_PROMPT } from "./prompt";
import {
  PROMOTION_REGISTRARS,
  PROMOTION_RESULTS,
  type PromotionInput,
  PromotionInputSchema,
  type PromotionOutput,
  PromotionOutputSchema,
  type PromotionRegistrar,
  type PromotionResult,
} from "./schema";

export {
  PROMOTION_AGENT_VERSION,
  PROMOTION_REGISTRARS,
  PROMOTION_RESULTS,
  PROMOTION_SYSTEM_PROMPT,
  PromotionInputSchema,
  PromotionOutputSchema,
};
export type { PromotionInput, PromotionOutput, PromotionRegistrar, PromotionResult };

// ---------------------------------------------------------------------------
// Mechanical re-check of the unambiguous criteria.
// ---------------------------------------------------------------------------

export interface MechanicalGateResult {
  /** Did the mechanical re-check force a non-"ready" verdict? */
  forcedResult: PromotionResult | null;
  reasons: string[];
}

const REVENUE_FLOOR_EUR = 75;
const REVENUE_AVG_EUR = 150;

export function mechanicalRecheck(input: PromotionInput): MechanicalGateResult {
  const reasons: string[] = [];

  const rev = input.metrics_90d.approved_revenue_per_month_eur;
  if (rev.some((v) => v < REVENUE_FLOOR_EUR)) {
    reasons.push(
      `Revenue floor breached: a month <€${REVENUE_FLOOR_EUR} disqualifies; got [${rev.join(", ")}].`,
    );
  }
  const avg = (rev[0] + rev[1] + rev[2]) / 3;
  if (avg < REVENUE_AVG_EUR) {
    reasons.push(`Revenue avg <€${REVENUE_AVG_EUR}: got €${avg.toFixed(2)}.`);
  }

  if (reasons.length > 0) {
    return { forcedResult: "not_ready", reasons };
  }

  // Algorithm-quiet check: any active or recent event forces blocked_by_update_window.
  if (input.algorithm_events_30d.length > 0) {
    return {
      forcedResult: "blocked_by_update_window",
      reasons: ["Algorithm event present in last 30 days."],
    };
  }

  return { forcedResult: null, reasons: [] };
}

// ---------------------------------------------------------------------------
// User-turn renderer.
// ---------------------------------------------------------------------------

function buildUserMessage(input: PromotionInput): string {
  return JSON.stringify({ task: "evaluate_promotion_gate", ...input }, null, 2);
}

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

export interface RunPromotionResult {
  output: PromotionOutput;
  /** Model's pre-recheck result (preserved for telemetry). */
  modelResult: PromotionResult;
  /** Mechanical re-check verdict. */
  mechanical: MechanicalGateResult;
  /** True if mechanical recheck overrode the model. */
  resultAmended: boolean;
  agentRunId: string;
  costEur: number;
}

export async function runPromotionAgent(
  runtime: RunAgentRuntime,
  input: PromotionInput,
): Promise<RunPromotionResult> {
  const { output, agentRunId, costEur } = await runAgent<PromotionInput, PromotionOutput>(
    {
      agent: "promotion",
      model: CLAUDE_MODEL_STRINGS.opus,
      systemPrompt: PROMOTION_SYSTEM_PROMPT,
      inputSchema: PromotionInputSchema,
      outputSchema: PromotionOutputSchema,
      buildUserMessage,
      maxTokens: 6_000,
    },
    runtime,
    input,
  );

  const mechanical = mechanicalRecheck(input);
  const amended = mechanical.forcedResult !== null && mechanical.forcedResult !== output.result;

  const finalOutput: PromotionOutput = amended
    ? {
        ...output,
        result: mechanical.forcedResult ?? output.result,
        recommendation: `[Host mechanical recheck] ${mechanical.reasons.join(" ")} — Model said "${output.result}".\n\n${output.recommendation}`,
      }
    : output;

  return {
    output: finalOutput,
    modelResult: output.result,
    mechanical,
    resultAmended: amended,
    agentRunId,
    costEur,
  };
}
