import { CRITERION_KEYS, RUBRIC_VERSION, computeTotalScore } from "@nichefinder/shared";
import { describe, expect, it } from "vitest";
import {
  type ScoringInput,
  ScoringInputSchema,
  type ScoringOutput,
  ScoringOutputSchema,
  evaluateHostBlocks,
  reconcileScore,
} from "../src/agents/scoring";

// -----------------------------------------------------------------------------
// Builders
// -----------------------------------------------------------------------------

function breakdown(scores: Partial<Record<(typeof CRITERION_KEYS)[number], number>>) {
  return Object.fromEntries(
    CRITERION_KEYS.map((k) => [k, { score: scores[k] ?? 50, evidence: { stub: true } }]),
  ) as ScoringOutput["breakdown"];
}

function output(overrides: Partial<ScoringOutput>): ScoringOutput {
  const base: ScoringOutput = {
    rubric_version: RUBRIC_VERSION,
    total_score: 50,
    block_reason: null,
    breakdown: breakdown({}),
    notes: "test",
  };
  return { ...base, ...overrides };
}

function input(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return ScoringInputSchema.parse({
    candidate: {
      topic: "specialty espresso gear",
      topic_slug: "specialty-espresso-gear",
      language: "nl",
      related_keywords: ["espressomachine", "aeropress"],
    },
    signals: {
      affiliate_availability: { bol: { advertisers: 5, products: 50 } },
      dataforseo_keywords: { total_volume_intent_commercial: 8000 },
      dataforseo_serp_top5: { pct_top10_templated: 0.2 },
      trademark: { euipo_tmview: "clear" },
      kill_list_match: null,
      ymyl_match: false,
      operator_interest: 50,
    },
    killedSlugs: [],
    activeSlugs: [],
    ...overrides,
  });
}

// -----------------------------------------------------------------------------
// Host block evaluator
// -----------------------------------------------------------------------------

describe("evaluateHostBlocks", () => {
  it("returns null when nothing matches", () => {
    expect(evaluateHostBlocks(input()).reason).toBeNull();
  });

  it("blocks on kill-list match (topic-level YMYL)", () => {
    const res = evaluateHostBlocks(
      input({
        candidate: {
          topic: "best supplements for sleep",
          topic_slug: "best-supplements-sleep",
          language: "en",
          related_keywords: ["melatonin", "magnesium"],
        },
      }),
    );
    expect(res.reason).toBe("kill_list");
    expect(res.killListMatch?.category.severity).toBe("hard_block");
  });

  it("blocks on signal-reported YMYL when kill-list misses", () => {
    expect(
      evaluateHostBlocks(
        input({
          signals: {
            affiliate_availability: {},
            dataforseo_keywords: {},
            dataforseo_serp_top5: {},
            trademark: { euipo_tmview: "clear" },
            kill_list_match: null,
            ymyl_match: true,
            operator_interest: 50,
          },
        }),
      ).reason,
    ).toBe("ymyl");
  });

  it("blocks on EUIPO trademark match", () => {
    expect(
      evaluateHostBlocks(
        input({
          signals: {
            affiliate_availability: {},
            dataforseo_keywords: {},
            dataforseo_serp_top5: {},
            trademark: { euipo_tmview: "match", matched_marks: ["ACME"] },
            kill_list_match: null,
            ymyl_match: false,
            operator_interest: 50,
          },
        }),
      ).reason,
    ).toBe("trademark");
  });

  it("blocks on duplicate killed slug", () => {
    expect(evaluateHostBlocks(input({ killedSlugs: ["specialty-espresso-gear"] })).reason).toBe(
      "duplicate_killed",
    );
  });

  it("blocks on duplicate active slug", () => {
    expect(evaluateHostBlocks(input({ activeSlugs: ["specialty-espresso-gear"] })).reason).toBe(
      "duplicate_active",
    );
  });

  it("kill-list takes precedence over duplicates", () => {
    const res = evaluateHostBlocks(
      input({
        candidate: {
          topic: "online casino reviews",
          topic_slug: "online-casino-reviews",
          language: "nl",
          related_keywords: ["casino"],
        },
        killedSlugs: ["online-casino-reviews"],
      }),
    );
    expect(res.reason).toBe("kill_list");
  });
});

// -----------------------------------------------------------------------------
// Reconcile — host arithmetic + block enforcement
// -----------------------------------------------------------------------------

describe("reconcileScore — host recomputes total", () => {
  it("agrees with the model when arithmetic is correct", () => {
    const bd = breakdown({
      affiliate_availability: 80,
      commercial_intent: 70,
      kgr_supply_gap: 65,
      ai_saturation_inverse: 55,
      trend_slope: 75,
      ymyl_safety: 100,
      avoid_list_inverse: 100,
      unit_economics: 60,
      competition_diversity: 70,
      operator_interest: 50,
    });
    const expected = computeTotalScore(bd as Parameters<typeof computeTotalScore>[0]);
    const r = reconcileScore(output({ total_score: expected, breakdown: bd }), { reason: null });
    expect(r.amended).toBe(false);
    expect(r.output.total_score).toBe(expected);
    expect(r.totalDriftDelta).toBe(0);
  });

  it("overrides the model when it claims a different total than the weighted sum", () => {
    const bd = breakdown({}); // all 50s → weighted total = 50
    const r = reconcileScore(output({ total_score: 99, breakdown: bd }), { reason: null });
    expect(r.output.total_score).toBe(50);
    expect(r.amended).toBe(true);
    expect(r.totalDriftDelta).toBe(49);
    expect(r.modelClaimed.total).toBe(99);
  });

  it("zeroes the total when the host block fires, regardless of model output", () => {
    const r = reconcileScore(
      output({ total_score: 85, block_reason: null, breakdown: breakdown({}) }),
      { reason: "kill_list" },
    );
    expect(r.output.total_score).toBe(0);
    expect(r.output.block_reason).toBe("kill_list");
    expect(r.amended).toBe(true);
  });

  it("zeroes the total when the model self-reports a block, even if host disagrees", () => {
    const r = reconcileScore(
      output({ total_score: 60, block_reason: "ymyl", breakdown: breakdown({}) }),
      { reason: null },
    );
    expect(r.output.total_score).toBe(0);
    expect(r.output.block_reason).toBe("ymyl");
  });

  it("host block reason wins over model block reason on conflict", () => {
    const r = reconcileScore(
      output({ total_score: 0, block_reason: "ymyl", breakdown: breakdown({}) }),
      { reason: "kill_list" },
    );
    expect(r.output.block_reason).toBe("kill_list");
  });
});

// -----------------------------------------------------------------------------
// Schema sanity — covers strict-shape regressions if the rubric changes.
// -----------------------------------------------------------------------------

describe("ScoringOutputSchema", () => {
  it("accepts a well-formed output", () => {
    expect(() => ScoringOutputSchema.parse(output({}))).not.toThrow();
  });

  it("rejects an output missing a criterion", () => {
    const malformed = output({});
    // biome-ignore lint/performance/noDelete: test-only mutation
    delete (malformed.breakdown as Record<string, unknown>).operator_interest;
    expect(() => ScoringOutputSchema.parse(malformed)).toThrow();
  });

  it("rejects rubric_version drift", () => {
    expect(() => ScoringOutputSchema.parse({ ...output({}), rubric_version: "9.9.9" })).toThrow();
  });

  it("rejects total_score outside 0..100", () => {
    expect(() => ScoringOutputSchema.parse(output({ total_score: 101 }))).toThrow();
  });

  it("rejects unknown breakdown keys (strict)", () => {
    const bad = output({});
    (bad.breakdown as Record<string, unknown>).extra = { score: 1, evidence: null };
    expect(() => ScoringOutputSchema.parse(bad)).toThrow();
  });

  it("accepts haiku_first_pass on escalation outputs", () => {
    const o = output({});
    (o.breakdown as Record<string, unknown>).haiku_first_pass = { stub: true };
    expect(() => ScoringOutputSchema.parse(o)).not.toThrow();
  });
});
