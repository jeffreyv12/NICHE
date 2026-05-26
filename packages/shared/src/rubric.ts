// Source of truth for the niche scoring rubric — mirrors docs/NICHE_SCORING_RUBRIC.md.
// Used by the Scoring Agent and by the admin UI to render score breakdowns.
//
// Bump RUBRIC_VERSION on any weight or criterion change. Old scores remain
// stored against their old version in niche_scores.rubric_version.

export const RUBRIC_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// Criteria + weights
// ---------------------------------------------------------------------------

export const CRITERION_KEYS = [
  "affiliate_availability",
  "commercial_intent",
  "kgr_supply_gap",
  "ai_saturation_inverse",
  "trend_slope",
  "ymyl_safety",
  "avoid_list_inverse",
  "unit_economics",
  "competition_diversity",
  "operator_interest",
] as const;

export type CriterionKey = (typeof CRITERION_KEYS)[number];

export const CRITERION_WEIGHTS: Record<CriterionKey, number> = {
  affiliate_availability: 0.2,
  commercial_intent: 0.15,
  kgr_supply_gap: 0.1,
  ai_saturation_inverse: 0.1,
  trend_slope: 0.1,
  ymyl_safety: 0.1,
  avoid_list_inverse: 0.1,
  unit_economics: 0.05,
  competition_diversity: 0.05,
  operator_interest: 0.05,
};

// Sanity-check: weights sum to 1.0 (with floating tolerance).
const _sum = Object.values(CRITERION_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(_sum - 1) > 1e-9) {
  throw new Error(`Rubric weights must sum to 1.0; got ${_sum}`);
}

// ---------------------------------------------------------------------------
// Score bands
// ---------------------------------------------------------------------------
// Per-criterion bands documented in NICHE_SCORING_RUBRIC.md. Round individual
// scores to the nearest 5 to reduce false precision.

export const SCORE_BANDS = {
  veryLow: { min: 0, max: 25, mid: 10 },
  low: { min: 26, max: 50, mid: 40 },
  high: { min: 51, max: 75, mid: 65 },
  veryHigh: { min: 76, max: 100, mid: 88 },
} as const;

// ---------------------------------------------------------------------------
// Hard-block reasons (override composite to 0)
// ---------------------------------------------------------------------------

export const HARD_BLOCK_REASONS = [
  "kill_list",
  "ymyl",
  "trademark",
  "duplicate_killed",
  "duplicate_active",
] as const;
export type HardBlockReason = (typeof HARD_BLOCK_REASONS)[number];

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------

export interface CriterionScore {
  score: number; // 0..100
  evidence: unknown;
}

export type ScoreBreakdown = Record<CriterionKey, CriterionScore> & {
  haiku_first_pass?: ScoreBreakdown | null;
};

/**
 * Compute the weighted composite. Caller is responsible for hard-block override
 * (return 0 + reason).
 */
export function computeTotalScore(breakdown: Pick<ScoreBreakdown, CriterionKey>): number {
  let total = 0;
  for (const key of CRITERION_KEYS) {
    total += CRITERION_WEIGHTS[key] * breakdown[key].score;
  }
  return Math.round(total);
}

/**
 * The Sonnet escalation band. If Haiku's first pass lands here, re-run on Sonnet
 * with the Haiku breakdown attached as context.
 */
export const ESCALATION_BAND = { min: 55, max: 70 } as const;

export function shouldEscalate(totalScore: number): boolean {
  return totalScore >= ESCALATION_BAND.min && totalScore <= ESCALATION_BAND.max;
}

// ---------------------------------------------------------------------------
// Operator-triage thresholds
// ---------------------------------------------------------------------------

/**
 * Score above this surfaces a candidate in the operator triage UI by default.
 * Operator can lower in the filter.
 */
export const APPROVE_FOR_VALIDATION_DEFAULT_THRESHOLD = 65;
