import { describe, expect, it } from "vitest";
import {
  BudgetExceededError,
  PerCallCapExceededError,
  assertBudgetAvailable,
  assertPerCallCap,
  getMonthlyBudgetState,
} from "../src/guards/budget.js";

// ---------------------------------------------------------------------------
// Minimal DB mock — getMonthlyBudgetState only calls
//   select({ total }).from(agentRuns).where(sql`...`)
// so the chain terminates at .where() returning a Promise<[{total: string}]>.
// ---------------------------------------------------------------------------

function makeDb(totalStr: string) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ total: totalStr }]),
      }),
    }),
  };
}

function makeEmptyDb() {
  // Simulates a DB where result[0] is undefined (no rows).
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// BudgetExceededError
// ---------------------------------------------------------------------------

describe("BudgetExceededError", () => {
  it("carries spentEur and budgetEur properties", () => {
    const err = new BudgetExceededError(185.5, 200);
    expect(err.spentEur).toBe(185.5);
    expect(err.budgetEur).toBe(200);
  });

  it("has name BudgetExceededError", () => {
    expect(new BudgetExceededError(0, 200).name).toBe("BudgetExceededError");
  });

  it("message includes formatted EUR amounts", () => {
    const msg = new BudgetExceededError(200, 200).message;
    expect(msg).toContain("€200.00");
  });
});

// ---------------------------------------------------------------------------
// PerCallCapExceededError
// ---------------------------------------------------------------------------

describe("PerCallCapExceededError", () => {
  it("carries costEur and capEur properties", () => {
    const err = new PerCallCapExceededError(0.085, 0.05);
    expect(err.costEur).toBe(0.085);
    expect(err.capEur).toBe(0.05);
  });

  it("has name PerCallCapExceededError", () => {
    expect(new PerCallCapExceededError(0, 1).name).toBe("PerCallCapExceededError");
  });

  it("message mentions aborting and pausing", () => {
    const msg = new PerCallCapExceededError(0.1, 0.05).message;
    expect(msg).toContain("Aborting");
    expect(msg).toContain("1h");
  });
});

// ---------------------------------------------------------------------------
// getMonthlyBudgetState
// ---------------------------------------------------------------------------

describe("getMonthlyBudgetState", () => {
  it("returns fractionUsed < 0.8 when well under budget", async () => {
    const state = await getMonthlyBudgetState(makeDb("50") as never, 200);
    expect(state.spentEur).toBe(50);
    expect(state.budgetEur).toBe(200);
    expect(state.fractionUsed).toBeCloseTo(0.25);
    expect(state.alertAt80Pct).toBe(false);
    expect(state.exceeded).toBe(false);
  });

  it("sets alertAt80Pct=true and exceeded=false at exactly 80%", async () => {
    const state = await getMonthlyBudgetState(makeDb("160") as never, 200);
    expect(state.alertAt80Pct).toBe(true);
    expect(state.exceeded).toBe(false);
  });

  it("sets alertAt80Pct=false and exceeded=true at 100%", async () => {
    const state = await getMonthlyBudgetState(makeDb("200") as never, 200);
    expect(state.alertAt80Pct).toBe(false);
    expect(state.exceeded).toBe(true);
  });

  it("sets exceeded=true when spend exceeds budget", async () => {
    const state = await getMonthlyBudgetState(makeDb("250") as never, 200);
    expect(state.exceeded).toBe(true);
  });

  it("returns fractionUsed=0 when budgetEur is zero (guard against division by zero)", async () => {
    const state = await getMonthlyBudgetState(makeDb("0") as never, 0);
    expect(state.fractionUsed).toBe(0);
    expect(state.exceeded).toBe(false);
  });

  it("treats missing DB row as zero spend", async () => {
    const state = await getMonthlyBudgetState(makeEmptyDb() as never, 200);
    expect(state.spentEur).toBe(0);
    expect(state.alertAt80Pct).toBe(false);
    expect(state.exceeded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assertBudgetAvailable
// ---------------------------------------------------------------------------

describe("assertBudgetAvailable", () => {
  it("returns budget state when not exceeded", async () => {
    const state = await assertBudgetAvailable(makeDb("100") as never, 200);
    expect(state.spentEur).toBe(100);
    expect(state.exceeded).toBe(false);
  });

  it("throws BudgetExceededError when budget is at 100%", async () => {
    await expect(assertBudgetAvailable(makeDb("200") as never, 200)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it("throws BudgetExceededError when budget is exceeded", async () => {
    await expect(assertBudgetAvailable(makeDb("210") as never, 200)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it("does NOT throw at 79% usage", async () => {
    await expect(assertBudgetAvailable(makeDb("158") as never, 200)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// assertPerCallCap
// ---------------------------------------------------------------------------

describe("assertPerCallCap", () => {
  it("does not throw when cost is below cap", () => {
    expect(() => assertPerCallCap(0.04, 0.05)).not.toThrow();
  });

  it("does not throw when cost equals cap exactly", () => {
    expect(() => assertPerCallCap(0.05, 0.05)).not.toThrow();
  });

  it("throws PerCallCapExceededError when cost exceeds cap", () => {
    expect(() => assertPerCallCap(0.06, 0.05)).toThrow(PerCallCapExceededError);
  });

  it("thrown error carries the actual cost and cap values", () => {
    let caught: PerCallCapExceededError | undefined;
    try {
      assertPerCallCap(0.123, 0.05);
    } catch (e) {
      caught = e as PerCallCapExceededError;
    }
    expect(caught?.costEur).toBe(0.123);
    expect(caught?.capEur).toBe(0.05);
  });
});
