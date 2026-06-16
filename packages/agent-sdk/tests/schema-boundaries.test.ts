// Pins the REJECTION paths of every agent Zod schema that guards Claude
// output before it reaches the database.  The happy-path (valid data flows
// through) is already covered by scoring-reconcile.test.ts,
// validation-safeguards.test.ts, content-disclosures.test.ts, and
// promotion-recheck.test.ts.  This file covers the other half: malformed
// output MUST be rejected.

import { CRITERION_KEYS, RUBRIC_VERSION } from "@nichefinder/shared";
import { describe, expect, it } from "vitest";
import { PromotionInputSchema, PromotionOutputSchema } from "../src/agents/promotion/index.js";
import { ScoringInputSchema, ScoringOutputSchema } from "../src/agents/scoring/index.js";
import { ScoreBreakdownSchema, ScoringCandidateSchema } from "../src/agents/scoring/schema.js";
import { ValidationInputSchema } from "../src/agents/validation/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pass<T>(schema: { safeParse: (v: unknown) => { success: boolean } }, value: T) {
  return schema.safeParse(value).success;
}

function fail<T>(schema: { safeParse: (v: unknown) => { success: boolean } }, value: T) {
  return !schema.safeParse(value).success;
}

/** Minimal valid ScoringSignalBundle for use as a sub-fixture. */
const SIGNALS = {
  affiliate_availability: {},
  dataforseo_keywords: {},
  dataforseo_serp_top5: {},
  trademark: { euipo_tmview: "clear" as const },
  kill_list_match: null,
  ymyl_match: false,
  operator_interest: 50,
};

/** Minimal valid ScoringCandidate. */
const VALID_CANDIDATE = {
  topic: "koffiemolen",
  topic_slug: "koffiemolen",
  language: "nl" as const,
  related_keywords: ["espressomolen"],
};

/** Minimal valid ScoringInput. */
function validScoringInput(candidateOverride?: object) {
  return {
    candidate: { ...VALID_CANDIDATE, ...candidateOverride },
    signals: SIGNALS,
  };
}

/** Builds a valid ScoreBreakdown for ScoringOutputSchema tests. */
function breakdown(scoreOverrides: Partial<Record<(typeof CRITERION_KEYS)[number], number>> = {}) {
  return Object.fromEntries(
    CRITERION_KEYS.map((k) => [k, { score: scoreOverrides[k] ?? 50, evidence: {} }]),
  );
}

/** Minimal valid ScoringOutput (before being parsed). */
function validOutput(overrides: object = {}) {
  return {
    rubric_version: RUBRIC_VERSION,
    total_score: 50,
    block_reason: null,
    breakdown: breakdown(),
    notes: "ok",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ScoringCandidateSchema — topic_slug kebab-case guard
// ---------------------------------------------------------------------------

describe("ScoringCandidateSchema — topic_slug", () => {
  it("accepts a valid kebab-case slug", () => {
    expect(pass(ScoringCandidateSchema, VALID_CANDIDATE)).toBe(true);
  });

  it("rejects a slug with spaces", () => {
    expect(fail(ScoringCandidateSchema, { ...VALID_CANDIDATE, topic_slug: "koffie molen" })).toBe(
      true,
    );
  });

  it("rejects a slug with uppercase letters", () => {
    expect(fail(ScoringCandidateSchema, { ...VALID_CANDIDATE, topic_slug: "Koffiemolen" })).toBe(
      true,
    );
  });

  it("rejects a slug with underscores", () => {
    expect(fail(ScoringCandidateSchema, { ...VALID_CANDIDATE, topic_slug: "koffie_molen" })).toBe(
      true,
    );
  });

  it("rejects a slug with a leading hyphen", () => {
    expect(fail(ScoringCandidateSchema, { ...VALID_CANDIDATE, topic_slug: "-koffiemolen" })).toBe(
      true,
    );
  });

  it("rejects a single-character slug (min 2)", () => {
    expect(fail(ScoringCandidateSchema, { ...VALID_CANDIDATE, topic_slug: "k" })).toBe(true);
  });

  it("rejects a slug with a trailing hyphen", () => {
    expect(fail(ScoringCandidateSchema, { ...VALID_CANDIDATE, topic_slug: "koffiemolen-" })).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// ScoringCandidateSchema — related_keywords array bounds
// ---------------------------------------------------------------------------

describe("ScoringCandidateSchema — related_keywords bounds", () => {
  it("rejects an empty related_keywords array (min 1)", () => {
    expect(fail(ScoringCandidateSchema, { ...VALID_CANDIDATE, related_keywords: [] })).toBe(true);
  });

  it("rejects more than 20 related_keywords (max 20)", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `keyword-${i}`);
    expect(fail(ScoringCandidateSchema, { ...VALID_CANDIDATE, related_keywords: tooMany })).toBe(
      true,
    );
  });

  it("accepts exactly 20 related_keywords", () => {
    const exactly20 = Array.from({ length: 20 }, (_, i) => `keyword-${i}`);
    expect(pass(ScoringCandidateSchema, { ...VALID_CANDIDATE, related_keywords: exactly20 })).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// ScoringSignalBundleSchema — operator_interest bounds
// ---------------------------------------------------------------------------

describe("ScoringInputSchema — operator_interest bounds", () => {
  it("rejects operator_interest above 100", () => {
    expect(
      fail(ScoringInputSchema, {
        candidate: VALID_CANDIDATE,
        signals: { ...SIGNALS, operator_interest: 101 },
      }),
    ).toBe(true);
  });

  it("rejects operator_interest below 0", () => {
    expect(
      fail(ScoringInputSchema, {
        ...validScoringInput(),
        signals: { ...SIGNALS, operator_interest: -1 },
      }),
    ).toBe(true);
  });

  it("accepts operator_interest at boundary values 0 and 100", () => {
    expect(
      pass(ScoringInputSchema, {
        ...validScoringInput(),
        signals: { ...SIGNALS, operator_interest: 0 },
      }),
    ).toBe(true);
    expect(
      pass(ScoringInputSchema, {
        ...validScoringInput(),
        signals: { ...SIGNALS, operator_interest: 100 },
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ScoringOutputSchema — total_score and per-criterion score bounds
// ---------------------------------------------------------------------------

describe("ScoringOutputSchema — total_score bounds", () => {
  it("rejects total_score above 100", () => {
    expect(fail(ScoringOutputSchema, validOutput({ total_score: 101 }))).toBe(true);
  });

  it("rejects total_score below 0", () => {
    expect(fail(ScoringOutputSchema, validOutput({ total_score: -1 }))).toBe(true);
  });

  it("rejects a non-integer total_score", () => {
    expect(fail(ScoringOutputSchema, validOutput({ total_score: 50.5 }))).toBe(true);
  });

  it("rejects a wrong rubric_version literal", () => {
    expect(fail(ScoringOutputSchema, validOutput({ rubric_version: "v0.0.0-wrong" }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ScoreBreakdownSchema — strict mode + per-criterion score bounds
// ---------------------------------------------------------------------------

// CRITERION_KEYS is a readonly string[] — pick the first key without a
// non-null assertion (Biome noNonNullAssertion). The array is non-empty by
// construction (rubric requires ≥1 criterion) so the String() fallback
// never fires in practice.
const FIRST_CRITERION_KEY = String(CRITERION_KEYS[0]);

describe("ScoreBreakdownSchema — criterion score bounds", () => {
  it("rejects a criterion score above 100", () => {
    expect(
      fail(ScoreBreakdownSchema, {
        ...breakdown(),
        [FIRST_CRITERION_KEY]: { score: 101, evidence: {} },
      }),
    ).toBe(true);
  });

  it("rejects a criterion score below 0", () => {
    expect(
      fail(ScoreBreakdownSchema, {
        ...breakdown(),
        [FIRST_CRITERION_KEY]: { score: -1, evidence: {} },
      }),
    ).toBe(true);
  });

  it("rejects a non-integer criterion score", () => {
    expect(
      fail(ScoreBreakdownSchema, {
        ...breakdown(),
        [FIRST_CRITERION_KEY]: { score: 49.9, evidence: {} },
      }),
    ).toBe(true);
  });

  it("rejects breakdown with an extra hallucinated criterion key (strict mode)", () => {
    expect(
      fail(ScoreBreakdownSchema, {
        ...breakdown(),
        nonexistent_criterion: { score: 50, evidence: {} },
      }),
    ).toBe(true);
  });

  it("rejects breakdown missing a required criterion key", () => {
    const partial: Record<string, unknown> = { ...breakdown() };
    delete partial[FIRST_CRITERION_KEY];
    expect(fail(ScoreBreakdownSchema, partial)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ValidationInputSchema — topic_slug constraint inherited from shared shape
// ---------------------------------------------------------------------------

describe("ValidationInputSchema — topic_slug rejection", () => {
  it("rejects a topic_slug with spaces", () => {
    const raw = {
      candidate: {
        topic: "aeropress draagbaar",
        topic_slug: "aeropress draagbaar",
        language: "nl",
      },
      test_pages: [
        {
          url: "https://example.nl/test",
          page_slug: "test",
          published_at: "2026-01-01",
          window_days: 14,
        },
      ],
    };
    expect(fail(ValidationInputSchema, raw)).toBe(true);
  });

  it("rejects a topic_slug with uppercase", () => {
    const raw = {
      candidate: { topic: "Aeropress", topic_slug: "Aeropress", language: "nl" },
      test_pages: [
        {
          url: "https://example.nl/test",
          page_slug: "test",
          published_at: "2026-01-01",
          window_days: 14,
        },
      ],
    };
    expect(fail(ValidationInputSchema, raw)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PromotionInputSchema — candidate_domains constraints
// ---------------------------------------------------------------------------

const BASE_DOMAIN = {
  hostname: "koffiemolen.nl",
  registrar: "transip" as const,
  cost_eur_year: 12,
  available: true,
  tmview_clear: true,
};

const BASE_PROMOTION_INPUT = {
  niche: {
    topic: "koffiemolen",
    topic_slug: "koffiemolen",
    current_state: "validated",
    days_in_state: 95,
  },
  metrics_90d: {
    approved_revenue_per_month_eur: [60, 80, 120] as [number, number, number],
    organic_clicks_per_month: [500, 800, 1200] as [number, number, number],
    non_brand_long_tail_share: 0.7,
    affiliate_sources_share: { bol: 0.6, awin: 0.4 },
    single_product_share_max: 0.3,
    branded_queries_per_month: 120,
    engagement: {
      median_time_on_page_seconds: 90,
      median_scroll_depth: 0.6,
      median_bot_score: 8,
      bounce_rate: 0.35,
    },
  },
  algorithm_events_30d: [],
  gsc_manual_actions_30d: [],
  candidate_domains: [BASE_DOMAIN],
};

describe("PromotionInputSchema — candidate_domains", () => {
  it("rejects a hostname shorter than 3 characters", () => {
    const raw = {
      ...BASE_PROMOTION_INPUT,
      candidate_domains: [{ ...BASE_DOMAIN, hostname: "ab" }],
    };
    expect(fail(PromotionInputSchema, raw)).toBe(true);
  });

  it("rejects an unknown registrar value", () => {
    const raw = {
      ...BASE_PROMOTION_INPUT,
      candidate_domains: [{ ...BASE_DOMAIN, registrar: "namecheap" }],
    };
    expect(fail(PromotionInputSchema, raw)).toBe(true);
  });

  it("rejects an empty candidate_domains array (min 1)", () => {
    const raw = { ...BASE_PROMOTION_INPUT, candidate_domains: [] };
    expect(fail(PromotionInputSchema, raw)).toBe(true);
  });

  it("accepts the valid base input", () => {
    expect(pass(PromotionInputSchema, BASE_PROMOTION_INPUT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PromotionOutputSchema — proposed_domains hostname constraint
// ---------------------------------------------------------------------------

const BASE_PROMOTION_OUTPUT = {
  result: "ready" as const,
  criteria: {
    revenue: { passed: true, value: 120, threshold: 150 },
    organic_clicks: { passed: true, value: 1200, threshold: 1500 },
    diversity: { passed: true, value: 2, threshold: 2 },
    branded_search: { passed: true, value: 120, threshold: 50 },
    engagement: { passed: true, value: 90, threshold: 60 },
    algorithm_quiet: { passed: true, value: 0, threshold: 0 },
    no_manual_action: { passed: true, value: 0, threshold: 0 },
  },
  recommendation: "Promote koffiemolen.nl to its own domain.",
  proposed_domains: [BASE_DOMAIN],
  earliest_retry_date: null,
};

describe("PromotionOutputSchema — proposed_domains hostname", () => {
  it("rejects a proposed hostname shorter than 3 characters", () => {
    const raw = {
      ...BASE_PROMOTION_OUTPUT,
      proposed_domains: [{ ...BASE_DOMAIN, hostname: "ab" }],
    };
    expect(fail(PromotionOutputSchema, raw)).toBe(true);
  });

  it("rejects an unknown registrar in proposed_domains", () => {
    const raw = {
      ...BASE_PROMOTION_OUTPUT,
      proposed_domains: [{ ...BASE_DOMAIN, registrar: "namecheap" }],
    };
    expect(fail(PromotionOutputSchema, raw)).toBe(true);
  });

  it("accepts an empty proposed_domains array (default)", () => {
    const raw = { ...BASE_PROMOTION_OUTPUT, proposed_domains: [] };
    expect(pass(PromotionOutputSchema, raw)).toBe(true);
  });
});
