import { describe, expect, it } from "vitest";
import { computeCost, computeCostEur } from "../src/cost";

describe("computeCost", () => {
  it("haiku: 1M input + 1M output ≈ $1 + $5 = $6", () => {
    const c = computeCost("claude-haiku-4-5-20251001", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(c.inputCostUsd).toBeCloseTo(1, 6);
    expect(c.outputCostUsd).toBeCloseTo(5, 6);
    expect(c.totalUsd).toBeCloseTo(6, 6);
  });

  it("opus: 1M input + 1M output ≈ $15 + $75 = $90", () => {
    const c = computeCost("claude-opus-4-7", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(c.totalUsd).toBeCloseTo(90, 6);
  });

  it("cache reads cost 0.1× of normal input", () => {
    const c = computeCost("claude-sonnet-4-6", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
    });
    // sonnet input = $3/MTok, cache read = 0.1× → $0.30
    expect(c.cacheReadCostUsd).toBeCloseTo(0.3, 6);
  });

  it("cache writes cost 1.25× of normal input", () => {
    const c = computeCost("claude-sonnet-4-6", {
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 1_000_000,
    });
    expect(c.cacheWriteCostUsd).toBeCloseTo(3.75, 6); // 3 × 1.25
  });

  it("EUR conversion applies (default 0.92)", () => {
    const c = computeCost("claude-haiku-4-5-20251001", {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(c.totalEur).toBeCloseTo(0.92, 6);
  });

  it("throws on unknown model", () => {
    expect(() =>
      // @ts-expect-error — deliberately bad model
      computeCost("claude-zomg-9000", { inputTokens: 0, outputTokens: 0 }),
    ).toThrow(/Unknown model/);
  });
});

describe("computeCostEur — DB-precision rounding", () => {
  it("rounds to 4 decimals (numeric(10,4))", () => {
    const eur = computeCostEur("claude-haiku-4-5-20251001", {
      inputTokens: 1234,
      outputTokens: 567,
    });
    // exact computation: ((1234/1e6)*1 + (567/1e6)*5) * 0.92 = 0.001134*0.92 + ...
    const rounded = Math.round(eur * 10_000) / 10_000;
    expect(eur).toBe(rounded);
  });
});
