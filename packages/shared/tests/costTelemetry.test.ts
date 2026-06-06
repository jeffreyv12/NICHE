import { describe, expect, it } from "vitest";
import { type AgentRunCost, summarizeCosts } from "../src/costTelemetry";

function run(over: Partial<AgentRunCost> = {}): AgentRunCost {
  return {
    agent: "discovery",
    model: "claude-haiku-4-5-20251001",
    costEur: 0.1,
    inputTokens: 1000,
    cacheReadTokens: 0,
    isBatch: false,
    ...over,
  };
}

const OPTS = { budgetEur: 200, dayOfMonth: 10, daysInMonth: 30 };

describe("summarizeCosts", () => {
  it("sums MTD spend and groups by model + agent", () => {
    const s = summarizeCosts(
      [
        run({ costEur: 1, model: "claude-haiku-4-5-20251001", agent: "discovery" }),
        run({ costEur: 2, model: "claude-sonnet-4-6", agent: "validation" }),
        run({ costEur: 3, model: "claude-sonnet-4-6", agent: "validation" }),
      ],
      OPTS,
    );
    expect(s.mtdSpendEur).toBeCloseTo(6, 5);
    expect(s.runCount).toBe(3);
    expect(s.byModel["claude-sonnet-4-6"]).toEqual({ costEur: 5, runs: 2 });
    expect(s.byAgent.validation).toEqual({ costEur: 5, runs: 2 });
  });

  it("projects month-end from the run-rate so far", () => {
    const s = summarizeCosts([run({ costEur: 50 })], { ...OPTS, dayOfMonth: 10, daysInMonth: 30 });
    // 50 over 10 days → 150 projected over 30.
    expect(s.projectedMonthEndEur).toBeCloseTo(150, 5);
  });

  it("computes the cache hit ratio from cache-read vs input tokens", () => {
    const s = summarizeCosts([run({ inputTokens: 1000, cacheReadTokens: 3000 })], OPTS);
    expect(s.cacheHitRatio).toBeCloseTo(0.75, 5);
  });

  it("reports batch share", () => {
    const s = summarizeCosts([run(), run({ isBatch: true }), run({ isBatch: true })], OPTS);
    expect(s.batchRuns).toBe(2);
    expect(s.batchSharePct).toBeCloseTo(66.6667, 3);
  });

  it("flags warn at ≥80% projected of budget", () => {
    // 60 over 10 days → 180 projected = 90% of 200.
    const s = summarizeCosts([run({ costEur: 60 })], OPTS);
    expect(s.alertLevel).toBe("warn");
  });

  it("flags over when MTD spend reaches the budget", () => {
    const s = summarizeCosts([run({ costEur: 200 })], OPTS);
    expect(s.alertLevel).toBe("over");
    expect(s.pctOfBudget).toBeCloseTo(100, 5);
  });

  it("stays ok well under budget", () => {
    const s = summarizeCosts([run({ costEur: 5 })], OPTS);
    expect(s.alertLevel).toBe("ok");
  });

  it("handles an empty month without dividing by zero", () => {
    const s = summarizeCosts([], { ...OPTS, dayOfMonth: 0 });
    expect(s.mtdSpendEur).toBe(0);
    expect(s.cacheHitRatio).toBe(0);
    expect(s.projectedMonthEndEur).toBe(0);
    expect(s.alertLevel).toBe("ok");
  });
});
