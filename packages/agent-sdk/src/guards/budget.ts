// Budget guards — monthly ceiling + per-call cap.
//
// CLAUDE.md non-negotiable #7: per-month spend ceiling alert at 80%, hard pause
// at 100%. Per-call cap kills any single call that exceeds it.
//
// Implementation: the agent plane writes `agent_runs.cost_eur` after every
// call; the guard reads the MTD sum and refuses new calls if budget is breached.

import { sql } from 'drizzle-orm';
import { agentRuns, type ServiceDb } from '@nichefinder/db';

export class BudgetExceededError extends Error {
  constructor(
    public spentEur: number,
    public budgetEur: number,
  ) {
    super(
      `Monthly Claude budget exceeded: spent €${spentEur.toFixed(2)} of €${budgetEur.toFixed(2)}. ` +
        'Agents are paused until next month or until CLAUDE_MONTHLY_BUDGET_EUR is raised.',
    );
    this.name = 'BudgetExceededError';
  }
}

export class PerCallCapExceededError extends Error {
  constructor(
    public costEur: number,
    public capEur: number,
  ) {
    super(
      `Per-call cap exceeded: this call would cost €${costEur.toFixed(4)} ` +
        `(cap €${capEur.toFixed(2)}). Aborting and pausing this agent for 1h.`,
    );
    this.name = 'PerCallCapExceededError';
  }
}

export interface BudgetState {
  spentEur: number;
  budgetEur: number;
  fractionUsed: number;
  alertAt80Pct: boolean;
  exceeded: boolean;
}

/**
 * Read MTD Claude spend from agent_runs and compare to the monthly budget.
 */
export async function getMonthlyBudgetState(
  db: ServiceDb,
  budgetEur: number,
): Promise<BudgetState> {
  // sum(cost_eur) from agent_runs where status='success' AND started_at >= start of month
  const result = await db
    .select({
      total: sql<string>`coalesce(sum(${agentRuns.costEur}), 0)`,
    })
    .from(agentRuns)
    .where(
      sql`${agentRuns.status} = 'success' and ${agentRuns.startedAt} >= date_trunc('month', now())`,
    );

  const spentEur = Number(result[0]?.total ?? 0);
  const fractionUsed = budgetEur > 0 ? spentEur / budgetEur : 0;

  return {
    spentEur,
    budgetEur,
    fractionUsed,
    alertAt80Pct: fractionUsed >= 0.8 && fractionUsed < 1,
    exceeded: fractionUsed >= 1,
  };
}

/**
 * Throws BudgetExceededError if MTD spend is at or above the monthly ceiling.
 * Call BEFORE every Claude request.
 */
export async function assertBudgetAvailable(
  db: ServiceDb,
  budgetEur: number,
): Promise<BudgetState> {
  const state = await getMonthlyBudgetState(db, budgetEur);
  if (state.exceeded) {
    throw new BudgetExceededError(state.spentEur, budgetEur);
  }
  return state;
}

/**
 * Post-call check. If a single call exceeded the per-call cap, throw — the
 * runtime should pause that agent for 1 hour and log loudly.
 */
export function assertPerCallCap(actualCostEur: number, capEur: number): void {
  if (actualCostEur > capEur) {
    throw new PerCallCapExceededError(actualCostEur, capEur);
  }
}
