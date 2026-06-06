// Phase 6.3 — Claude cost telemetry aggregation.
//
// Pure roll-up of agent_runs cost rows for the current month into the figures
// the admin dashboard shows and the budget alert keys off (CLAUDE.md #7).
// Date-free: the caller passes dayOfMonth / daysInMonth so this stays testable.

export interface AgentRunCost {
  agent: string;
  model: string;
  costEur: number;
  inputTokens: number;
  cacheReadTokens: number;
  isBatch: boolean;
}

export interface SummarizeCostsOptions {
  budgetEur: number;
  /** 1..31; day of the month "so far" for projection. 0 ⇒ no projection. */
  dayOfMonth: number;
  daysInMonth: number;
}

export interface CostBucket {
  costEur: number;
  runs: number;
}

export type CostAlertLevel = "ok" | "warn" | "over";

export interface CostSummary {
  mtdSpendEur: number;
  runCount: number;
  byModel: Record<string, CostBucket>;
  byAgent: Record<string, CostBucket>;
  /** cache-read / (cache-read + input), 0..1. */
  cacheHitRatio: number;
  batchRuns: number;
  batchSharePct: number;
  projectedMonthEndEur: number;
  budgetEur: number;
  pctOfBudget: number;
  projectedPctOfBudget: number;
  alertLevel: CostAlertLevel;
}

const WARN_PCT = 80;

function bump(map: Record<string, CostBucket>, key: string, costEur: number): void {
  const b = map[key] ?? { costEur: 0, runs: 0 };
  b.costEur += costEur;
  b.runs += 1;
  map[key] = b;
}

export function summarizeCosts(runs: AgentRunCost[], opts: SummarizeCostsOptions): CostSummary {
  const byModel: Record<string, CostBucket> = {};
  const byAgent: Record<string, CostBucket> = {};
  let mtdSpendEur = 0;
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let batchRuns = 0;

  for (const r of runs) {
    mtdSpendEur += r.costEur;
    inputTokens += r.inputTokens;
    cacheReadTokens += r.cacheReadTokens;
    if (r.isBatch) batchRuns += 1;
    bump(byModel, r.model, r.costEur);
    bump(byAgent, r.agent, r.costEur);
  }

  const runCount = runs.length;
  const cacheDenom = cacheReadTokens + inputTokens;
  const cacheHitRatio = cacheDenom > 0 ? cacheReadTokens / cacheDenom : 0;
  const batchSharePct = runCount > 0 ? (batchRuns / runCount) * 100 : 0;
  const projectedMonthEndEur =
    opts.dayOfMonth > 0 ? (mtdSpendEur / opts.dayOfMonth) * opts.daysInMonth : mtdSpendEur;

  const pctOfBudget = opts.budgetEur > 0 ? (mtdSpendEur / opts.budgetEur) * 100 : 0;
  const projectedPctOfBudget =
    opts.budgetEur > 0 ? (projectedMonthEndEur / opts.budgetEur) * 100 : 0;

  let alertLevel: CostAlertLevel = "ok";
  if (pctOfBudget >= 100) alertLevel = "over";
  else if (pctOfBudget >= WARN_PCT || projectedPctOfBudget >= WARN_PCT) alertLevel = "warn";

  return {
    mtdSpendEur,
    runCount,
    byModel,
    byAgent,
    cacheHitRatio,
    batchRuns,
    batchSharePct,
    projectedMonthEndEur,
    budgetEur: opts.budgetEur,
    pctOfBudget,
    projectedPctOfBudget,
    alertLevel,
  };
}
