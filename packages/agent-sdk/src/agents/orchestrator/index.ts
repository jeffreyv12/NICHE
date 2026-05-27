// orchestrator@1.0.0 — weekly portfolio review.
//
// Mon 06:00 NL cron in production; on-demand from the operator otherwise.
// Tier-routing: Opus 4.7 only (CLAUDE.md non-negotiable #7 — ~5% of calls).
//
// Trust model: the orchestrator produces a report; humans act on it. We do
// not auto-execute kills or promotions from its output (CLAUDE.md gate #1).
// Host post-check: synthesise budget alerts mechanically so the operator
// always sees the budget warning even if the model misses it.

import { CLAUDE_MODEL_STRINGS } from "@nichefinder/shared";
import { type RunAgentRuntime, runAgent } from "../../runAgent";
import { ORCHESTRATOR_AGENT_VERSION, ORCHESTRATOR_SYSTEM_PROMPT } from "./prompt";
import {
  ALERT_SEVERITIES,
  type AlertSeverity,
  type OrchestratorInput,
  OrchestratorInputSchema,
  type OrchestratorOutput,
  OrchestratorOutputSchema,
} from "./schema";

export {
  ALERT_SEVERITIES,
  ORCHESTRATOR_AGENT_VERSION,
  ORCHESTRATOR_SYSTEM_PROMPT,
  OrchestratorInputSchema,
  OrchestratorOutputSchema,
};
export type { AlertSeverity, OrchestratorInput, OrchestratorOutput };

// ---------------------------------------------------------------------------
// Mechanical budget alert — guaranteed to appear regardless of the model.
// ---------------------------------------------------------------------------

const BUDGET_WARNING_THRESHOLD = 0.8;
const BUDGET_CRITICAL_THRESHOLD = 1.0;

export function deriveBudgetAlerts(
  input: OrchestratorInput,
): Array<{ severity: AlertSeverity; message: string }> {
  const { claude_mtd_eur, claude_budget_eur } = input.spend;
  if (claude_budget_eur <= 0) return [];
  const pct = claude_mtd_eur / claude_budget_eur;

  if (pct >= BUDGET_CRITICAL_THRESHOLD) {
    return [
      {
        severity: "critical",
        message: `Claude spend €${claude_mtd_eur.toFixed(2)} ≥ €${claude_budget_eur.toFixed(2)} budget (${(pct * 100).toFixed(0)}%). Halt high-cost operations.`,
      },
    ];
  }
  if (pct >= BUDGET_WARNING_THRESHOLD) {
    return [
      {
        severity: "warning",
        message: `Claude spend €${claude_mtd_eur.toFixed(2)} at ${(pct * 100).toFixed(0)}% of €${claude_budget_eur.toFixed(2)} monthly budget.`,
      },
    ];
  }
  return [];
}

/** Pure helper: merge synthetic alerts in, dedupe verbatim message duplicates. */
export function mergeAlerts(
  modelAlerts: OrchestratorOutput["alerts"],
  synthetic: Array<{ severity: AlertSeverity; message: string }>,
): OrchestratorOutput["alerts"] {
  const seen = new Set(modelAlerts.map((a) => a.message));
  const merged = [...modelAlerts];
  for (const s of synthetic) {
    if (!seen.has(s.message)) merged.push(s);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// User-turn renderer.
// ---------------------------------------------------------------------------

function buildUserMessage(input: OrchestratorInput): string {
  return JSON.stringify({ task: "weekly_portfolio_review", ...input }, null, 2);
}

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

export interface RunOrchestratorResult {
  output: OrchestratorOutput;
  /** Host-synthesised alerts that were added (empty array if none). */
  syntheticAlerts: Array<{ severity: AlertSeverity; message: string }>;
  agentRunId: string;
  costEur: number;
}

export async function runOrchestratorAgent(
  runtime: RunAgentRuntime,
  input: OrchestratorInput,
): Promise<RunOrchestratorResult> {
  const { output, agentRunId, costEur } = await runAgent<OrchestratorInput, OrchestratorOutput>(
    {
      agent: "orchestrator",
      model: CLAUDE_MODEL_STRINGS.opus,
      systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
      inputSchema: OrchestratorInputSchema,
      outputSchema: OrchestratorOutputSchema,
      buildUserMessage,
      maxTokens: 8_000,
    },
    runtime,
    input,
  );

  const synthetic = deriveBudgetAlerts(input);
  const finalOutput: OrchestratorOutput = {
    ...output,
    alerts: mergeAlerts(output.alerts, synthetic),
  };

  return { output: finalOutput, syntheticAlerts: synthetic, agentRunId, costEur };
}
