import { describe, expect, it } from "vitest";
import {
  CRITERION_KEYS,
  CRITERION_WEIGHTS,
  ESCALATION_BAND,
  RUBRIC_VERSION,
  type ScoreBreakdown,
  computeTotalScore,
  shouldEscalate,
} from "../src/rubric";

const mkBreakdown = (
  scores: Partial<Record<(typeof CRITERION_KEYS)[number], number>>,
): Pick<ScoreBreakdown, (typeof CRITERION_KEYS)[number]> => {
  const out = {} as Pick<ScoreBreakdown, (typeof CRITERION_KEYS)[number]>;
  for (const k of CRITERION_KEYS) {
    out[k] = { score: scores[k] ?? 50, evidence: null };
  }
  return out;
};

describe("rubric weights", () => {
  it("weights sum to 1.0", () => {
    const sum = Object.values(CRITERION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it("every criterion has a weight", () => {
    for (const k of CRITERION_KEYS) {
      expect(CRITERION_WEIGHTS[k]).toBeGreaterThan(0);
    }
  });
});

describe("rubric version", () => {
  it("is a semver string", () => {
    expect(RUBRIC_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("computeTotalScore", () => {
  it("all-50 → 50", () => {
    expect(computeTotalScore(mkBreakdown({}))).toBe(50);
  });

  it("all-100 → 100", () => {
    const b = mkBreakdown(
      Object.fromEntries(CRITERION_KEYS.map((k) => [k, 100])) as Record<
        (typeof CRITERION_KEYS)[number],
        number
      >,
    );
    expect(computeTotalScore(b)).toBe(100);
  });

  it("all-0 → 0", () => {
    const b = mkBreakdown(
      Object.fromEntries(CRITERION_KEYS.map((k) => [k, 0])) as Record<
        (typeof CRITERION_KEYS)[number],
        number
      >,
    );
    expect(computeTotalScore(b)).toBe(0);
  });

  it("honours weights (high affiliate availability lifts the total)", () => {
    const low = computeTotalScore(mkBreakdown({ affiliate_availability: 0 }));
    const high = computeTotalScore(mkBreakdown({ affiliate_availability: 100 }));
    // affiliate_availability weight is 20% → 50→0 ≈ -10, 50→100 ≈ +10
    expect(high - low).toBeCloseTo(20, 0);
  });
});

describe("escalation band", () => {
  it.each([55, 60, 65, 70])("escalates at %i", (n) => {
    expect(shouldEscalate(n)).toBe(true);
  });
  it.each([54, 71, 0, 100])("does not escalate at %i", (n) => {
    expect(shouldEscalate(n)).toBe(false);
  });
  it("band is 55..70 inclusive", () => {
    expect(ESCALATION_BAND.min).toBe(55);
    expect(ESCALATION_BAND.max).toBe(70);
  });
});
