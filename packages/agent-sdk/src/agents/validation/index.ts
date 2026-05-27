// validation@1.0.0 — applies the GO/PIVOT/KILL decision rule to a single niche
// under validation.
//
// Phase 3.3 deliverable per PHASE_PLAN.md:
//   3.3.1 Prompt wired (prompt.ts)
//   3.3.3 Inputs: niche + test pages + 14-day metrics (schema.ts)
//   3.3.4 Output: GO/PIVOT/KILL written to niches.state (caller's job)
//
// Trust model:
//   - The agent makes the decision, but the host runs the same rule-based
//     checks via `evaluateMechanicalSafeguards` and surfaces overrides:
//       * "GO without ≥1 affiliate conversion" → host downgrades to PIVOT
//       * "GO with >70% sessions from a single page" → host downgrades to PIVOT
//   - These are the two "NEVER" constraints in the prompt; they're enforced
//     defensively because LLMs sometimes rationalize past hard rules.

import { CLAUDE_MODEL_STRINGS } from "@nichefinder/shared";
import { type RunAgentRuntime, runAgent } from "../../runAgent";
import { VALIDATION_AGENT_VERSION, VALIDATION_SYSTEM_PROMPT } from "./prompt";
import {
  type TestPageMetrics,
  type ValidationConfidence,
  type ValidationDecision,
  type ValidationInput,
  ValidationInputSchema,
  type ValidationMetrics,
  type ValidationOutput,
  ValidationOutputSchema,
} from "./schema";

export {
  VALIDATION_AGENT_VERSION,
  VALIDATION_SYSTEM_PROMPT,
  ValidationInputSchema,
  ValidationOutputSchema,
};
export type {
  TestPageMetrics,
  ValidationConfidence,
  ValidationDecision,
  ValidationInput,
  ValidationMetrics,
  ValidationOutput,
};

// ---------------------------------------------------------------------------
// Mechanical safeguards: pure rules the host applies after the agent decides.
// ---------------------------------------------------------------------------

export type SafeguardReason = "go_without_conversion" | "go_concentrated_traffic";

export interface MechanicalSafeguardResult {
  /** Reason the original decision should be amended, or null if it stands. */
  amendedReason: SafeguardReason | null;
  /** Decision after safeguard; same as original when no amendment fires. */
  decision: ValidationDecision;
  /** Was at least one safeguard triggered? */
  amended: boolean;
}

const CONCENTRATED_TRAFFIC_THRESHOLD = 0.7;

export function evaluateMechanicalSafeguards(
  input: ValidationInput,
  modelDecision: ValidationDecision,
): MechanicalSafeguardResult {
  if (modelDecision !== "go") {
    return { amendedReason: null, decision: modelDecision, amended: false };
  }

  if (input.metrics.affiliate_conversions < 1) {
    return { amendedReason: "go_without_conversion", decision: "pivot", amended: true };
  }

  // "Single page accounts for >70% of sessions" → demand pivot.
  const totalSessions = input.metrics.sessions_total;
  if (totalSessions > 0) {
    const topPage = Math.max(...input.test_pages.map((p) => p.sessions), 0);
    if (topPage / totalSessions > CONCENTRATED_TRAFFIC_THRESHOLD) {
      return { amendedReason: "go_concentrated_traffic", decision: "pivot", amended: true };
    }
  }

  return { amendedReason: null, decision: modelDecision, amended: false };
}

// ---------------------------------------------------------------------------
// User-turn renderer — stable order for prompt-cache.
// ---------------------------------------------------------------------------

function buildUserMessage(input: ValidationInput): string {
  const { niche, test_pages, metrics, prior_score_breakdown } = input;
  const lines: string[] = [
    "Validate this niche.",
    "",
    "niche:",
    `  topic: ${JSON.stringify(niche.topic)}`,
    `  slug: ${JSON.stringify(niche.topic_slug)}`,
    `  days_in_validation: ${niche.days_in_validation}`,
    "  test_pages:",
  ];
  for (const p of test_pages) {
    lines.push(
      `    - ${p.url} (sessions=${p.sessions}, clicks=${p.affiliate_clicks}${
        p.avg_time_on_page_seconds !== undefined ? `, time=${p.avg_time_on_page_seconds}s` : ""
      })`,
    );
  }
  lines.push("");
  lines.push(`metrics (${metrics.window_days}d):`);
  lines.push(`  paid_traffic_spend_eur: ${metrics.paid_traffic_spend_eur}`);
  lines.push(`  sessions_total: ${metrics.sessions_total}`);
  if (metrics.bounce_rate !== undefined) lines.push(`  bounce_rate: ${metrics.bounce_rate}`);
  if (metrics.avg_time_on_page_seconds !== undefined) {
    lines.push(`  avg_time_on_page_seconds: ${metrics.avg_time_on_page_seconds}`);
  }
  lines.push(
    `  affiliate_clicks: ${metrics.affiliate_clicks_total} ${JSON.stringify(metrics.affiliate_clicks_by_network)}`,
  );
  lines.push(`  affiliate_conversions: ${metrics.affiliate_conversions}`);
  lines.push(`  affiliate_revenue_eur: ${metrics.affiliate_revenue_eur}`);
  lines.push(`  email_signups: ${metrics.email_signups}`);

  if (prior_score_breakdown !== undefined) {
    lines.push("", "prior_score_breakdown (for context — do NOT re-score):");
    lines.push(JSON.stringify(prior_score_breakdown, null, 2));
  }

  lines.push("", "Return strict JSON matching the decision shape. No prose outside JSON.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public runner
// ---------------------------------------------------------------------------

export interface RunValidationResult {
  /** Final output: model output with `decision` overridden by safeguards if any. */
  output: ValidationOutput;
  /** Model's pre-safeguard decision (preserved for telemetry). */
  modelDecision: ValidationDecision;
  /** Safeguard outcome (amended? why?). */
  safeguard: MechanicalSafeguardResult;
  agentRunId: string;
  costEur: number;
}

export async function runValidationAgent(
  runtime: RunAgentRuntime,
  input: ValidationInput,
): Promise<RunValidationResult> {
  const { output, agentRunId, costEur } = await runAgent<ValidationInput, ValidationOutput>(
    {
      agent: "validation",
      model: CLAUDE_MODEL_STRINGS.sonnet,
      systemPrompt: VALIDATION_SYSTEM_PROMPT,
      inputSchema: ValidationInputSchema,
      outputSchema: ValidationOutputSchema,
      buildUserMessage,
      maxTokens: 4_000,
    },
    runtime,
    input,
  );

  const safeguard = evaluateMechanicalSafeguards(input, output.decision);
  const finalOutput: ValidationOutput = safeguard.amended
    ? {
        ...output,
        decision: safeguard.decision,
        rationale: `[Host safeguard: ${safeguard.amendedReason}] ${output.rationale}`,
      }
    : output;

  return {
    output: finalOutput,
    modelDecision: output.decision,
    safeguard,
    agentRunId,
    costEur,
  };
}
