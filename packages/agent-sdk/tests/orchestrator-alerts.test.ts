import { describe, expect, it } from "vitest";
import {
  type OrchestratorInput,
  OrchestratorInputSchema,
  OrchestratorOutputSchema,
  deriveBudgetAlerts,
  mergeAlerts,
} from "../src/agents/orchestrator";

function input(claudeMtd: number, budget = 200): OrchestratorInput {
  return OrchestratorInputSchema.parse({
    week_of: "2026-05-25",
    niches: [],
    spend: {
      claude_mtd_eur: claudeMtd,
      claude_budget_eur: budget,
      cost_ledger_mtd: [{ category: "vercel", mtd_eur: 20 }],
    },
  });
}

describe("deriveBudgetAlerts", () => {
  it("returns no alerts below 80% budget", () => {
    expect(deriveBudgetAlerts(input(100))).toEqual([]);
  });

  it("returns warning at ≥80% budget", () => {
    const alerts = deriveBudgetAlerts(input(160));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe("warning");
  });

  it("returns critical at ≥100% budget", () => {
    const alerts = deriveBudgetAlerts(input(220));
    expect(alerts[0]?.severity).toBe("critical");
  });

  it("returns no alerts when budget is 0 (unconfigured)", () => {
    expect(deriveBudgetAlerts(input(100, 0))).toEqual([]);
  });
});

describe("mergeAlerts", () => {
  it("appends synthetic alerts the model missed", () => {
    const merged = mergeAlerts(
      [{ severity: "info", message: "All good." }],
      [{ severity: "warning", message: "Budget at 80%." }],
    );
    expect(merged).toHaveLength(2);
  });

  it("does not duplicate identical messages", () => {
    const merged = mergeAlerts(
      [{ severity: "warning", message: "Budget at 80%." }],
      [{ severity: "warning", message: "Budget at 80%." }],
    );
    expect(merged).toHaveLength(1);
  });
});

describe("OrchestratorOutputSchema", () => {
  const sample = {
    week_of: "2026-05-25",
    headline: "Quiet week",
    portfolio_state: {
      candidate_count: 10,
      validating: 2,
      building: 3,
      mature: 1,
      promoted: 0,
      killed_lifetime: 12,
      kill_rate_12m: 0.5,
      promotion_rate_12m: 0.1,
    },
    spend: {
      claude_mtd_eur: 100,
      claude_budget_eur: 200,
      claude_pct_used: 0.5,
      infra_mtd_eur: 20,
      paid_traffic_mtd_eur: 0,
    },
  };

  it("accepts minimal output with defaulted arrays", () => {
    const parsed = OrchestratorOutputSchema.parse(sample);
    expect(parsed.alerts).toEqual([]);
    expect(parsed.kills_recommended).toEqual([]);
  });

  it("rejects unknown alert severity", () => {
    expect(() =>
      OrchestratorOutputSchema.parse({
        ...sample,
        alerts: [{ severity: "emergency", message: "x" }],
      }),
    ).toThrow();
  });
});
