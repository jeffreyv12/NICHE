// Source of truth for the promotion-gate thresholds — mirrors docs/PROMOTION_GATE.md.
// The Promotion Agent and the admin UI evaluate against these constants.
//
// Thresholds are DELIBERATELY STRICT. Loosening them is a one-way mistake:
// premature promotion costs months of redirect-chain pain.

// Mirror of the `promotion_evaluation_result` Postgres enum. Inlined here to
// keep `@nichefinder/shared` a leaf package per FOLDER_STRUCTURE.md. The
// canonical SQL definition lives in packages/db/migrations/0001_init.sql; the
// matching Drizzle enum is exported from `@nichefinder/db`.
export type PromotionEvaluationResult =
  | 'not_ready'
  | 'ready'
  | 'blocked_by_update_window'
  | 'blocked_by_single_source';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const PROMOTION_THRESHOLDS = {
  rollingWindowDays: 90,

  // C1 — revenue
  minRevenueEurPerMonth: 150,
  minMonthlyRevenueFloorEur: 75, // no single month may go below this
  consecutiveMonths: 3,

  // C2 — organic clicks
  minOrganicClicksPerMonth: 1500,
  minNonBrandLongTailShare: 0.3,

  // C3 — diversity
  minAffiliateSources: 2,
  maxSingleNetworkShare: 0.65,
  maxSingleProductShare: 0.7,

  // C4 — branded search
  minBrandedQueriesPerMonth: 20,

  // C5 — engagement
  minMedianTimeOnPageSeconds: 90,
  minMedianScrollDepth: 0.6,
  maxMedianBotScore: 30,
  maxBounceRate: 0.7,

  // C6 — algorithm cooldown
  algorithmEventCooldownDays: 30,
} as const;

// ---------------------------------------------------------------------------
// Kill thresholds (inverse of the promotion gate)
// ---------------------------------------------------------------------------

export const KILL_THRESHOLDS = {
  daysInBuildingBeforeKillReview: 180,
  maxRevenueEurPerMonth: 30, // below this triggers kill review
  maxOrganicClicksPerMonth: 500,
  maxDaysSinceHeroEdit: 60,
} as const;

// ---------------------------------------------------------------------------
// Criterion check helpers
// ---------------------------------------------------------------------------

export interface CriterionResult {
  passed: boolean;
  /** Actual measured value (for the UI breakdown). */
  value: unknown;
  /** Threshold used (for the UI breakdown). */
  threshold: unknown;
}

export interface PromotionInputs {
  /** Last 3 calendar months of revenue, oldest to newest, EUR. */
  monthlyRevenueEur: readonly [number, number, number];
  monthlyOrganicClicks: readonly [number, number, number];
  nonBrandLongTailShare: number;
  affiliateSourcesShare: Record<string, number>;
  singleProductShareMax: number;
  brandedQueriesPerMonth: number;
  engagement: {
    medianTimeOnPageSeconds: number;
    medianScrollDepth: number;
    medianBotScore: number;
    bounceRate: number;
  };
  algorithmEventsLast30Days: ReadonlyArray<{
    kind: string;
    startedAt: Date;
    endedAt: Date | null;
  }>;
  gscManualActions: ReadonlyArray<{ kind: string; openedAt: Date }>;
}

export interface PromotionEvaluation {
  result: PromotionEvaluationResult;
  criteria: Record<string, CriterionResult>;
  earliestRetryDate: Date | null;
  failingReasons: string[];
}

/**
 * Run the 7-criterion check. Pure function; no I/O.
 * Caller computes the inputs (from gsc_metrics, conversions, etc.) and passes them in.
 */
export function evaluatePromotionGate(input: PromotionInputs): PromotionEvaluation {
  const criteria: Record<string, CriterionResult> = {};
  const failing: string[] = [];

  // C1 revenue
  const revAvg = input.monthlyRevenueEur.reduce((a, b) => a + b, 0) / 3;
  const minMonth = Math.min(...input.monthlyRevenueEur);
  const revPass =
    revAvg >= PROMOTION_THRESHOLDS.minRevenueEurPerMonth &&
    minMonth >= PROMOTION_THRESHOLDS.minMonthlyRevenueFloorEur;
  criteria.revenue = {
    passed: revPass,
    value: { avgEur: revAvg, minMonthEur: minMonth, months: input.monthlyRevenueEur },
    threshold: {
      minAvgEur: PROMOTION_THRESHOLDS.minRevenueEurPerMonth,
      minMonthEur: PROMOTION_THRESHOLDS.minMonthlyRevenueFloorEur,
    },
  };
  if (!revPass) failing.push('revenue');

  // C2 organic clicks
  const clicksAvg =
    input.monthlyOrganicClicks.reduce((a, b) => a + b, 0) / 3;
  const clicksPass =
    clicksAvg >= PROMOTION_THRESHOLDS.minOrganicClicksPerMonth &&
    input.nonBrandLongTailShare >= PROMOTION_THRESHOLDS.minNonBrandLongTailShare;
  criteria.organic_clicks = {
    passed: clicksPass,
    value: { avg: clicksAvg, nonBrandLongTailShare: input.nonBrandLongTailShare },
    threshold: {
      minAvg: PROMOTION_THRESHOLDS.minOrganicClicksPerMonth,
      minNonBrandShare: PROMOTION_THRESHOLDS.minNonBrandLongTailShare,
    },
  };
  if (!clicksPass) failing.push('organic_clicks');

  // C3 diversity
  const shares = Object.values(input.affiliateSourcesShare);
  const activeSources = shares.filter((s) => s > 0).length;
  const maxShare = shares.length === 0 ? 0 : Math.max(...shares);
  const diversityPass =
    activeSources >= PROMOTION_THRESHOLDS.minAffiliateSources &&
    maxShare <= PROMOTION_THRESHOLDS.maxSingleNetworkShare &&
    input.singleProductShareMax <= PROMOTION_THRESHOLDS.maxSingleProductShare;
  criteria.diversity = {
    passed: diversityPass,
    value: {
      activeSources,
      maxNetworkShare: maxShare,
      maxProductShare: input.singleProductShareMax,
    },
    threshold: {
      minSources: PROMOTION_THRESHOLDS.minAffiliateSources,
      maxNetworkShare: PROMOTION_THRESHOLDS.maxSingleNetworkShare,
      maxProductShare: PROMOTION_THRESHOLDS.maxSingleProductShare,
    },
  };
  if (!diversityPass) failing.push('diversity');

  // C4 branded search
  const brandPass = input.brandedQueriesPerMonth >= PROMOTION_THRESHOLDS.minBrandedQueriesPerMonth;
  criteria.branded_search = {
    passed: brandPass,
    value: input.brandedQueriesPerMonth,
    threshold: PROMOTION_THRESHOLDS.minBrandedQueriesPerMonth,
  };
  if (!brandPass) failing.push('branded_search');

  // C5 engagement
  const e = input.engagement;
  const engPass =
    e.medianTimeOnPageSeconds >= PROMOTION_THRESHOLDS.minMedianTimeOnPageSeconds &&
    e.medianScrollDepth >= PROMOTION_THRESHOLDS.minMedianScrollDepth &&
    e.medianBotScore < PROMOTION_THRESHOLDS.maxMedianBotScore &&
    e.bounceRate < PROMOTION_THRESHOLDS.maxBounceRate;
  criteria.engagement = {
    passed: engPass,
    value: e,
    threshold: {
      minTime: PROMOTION_THRESHOLDS.minMedianTimeOnPageSeconds,
      minScroll: PROMOTION_THRESHOLDS.minMedianScrollDepth,
      maxBotScore: PROMOTION_THRESHOLDS.maxMedianBotScore,
      maxBounce: PROMOTION_THRESHOLDS.maxBounceRate,
    },
  };
  if (!engPass) failing.push('engagement');

  // C6 algorithm cooldown
  const now = Date.now();
  const cutoff = now - PROMOTION_THRESHOLDS.algorithmEventCooldownDays * 86_400_000;
  const recentEvents = input.algorithmEventsLast30Days.filter((ev) => {
    const endMs = ev.endedAt?.getTime() ?? now;
    return endMs >= cutoff;
  });
  const algoPass = recentEvents.length === 0;
  criteria.algorithm_quiet = {
    passed: algoPass,
    value: recentEvents,
    threshold: { cooldownDays: PROMOTION_THRESHOLDS.algorithmEventCooldownDays },
  };
  if (!algoPass) failing.push('algorithm_quiet');

  // C7 manual actions
  const maPass = input.gscManualActions.length === 0;
  criteria.no_manual_action = {
    passed: maPass,
    value: input.gscManualActions,
    threshold: 'zero open manual actions',
  };
  if (!maPass) failing.push('no_manual_action');

  // Decision tree (mirrors AGENT_PROMPTS.md promotion@1.0.0)
  let result: PromotionEvaluationResult;
  let earliestRetry: Date | null = null;
  if (!algoPass) {
    result = 'blocked_by_update_window';
    const latestEnd = Math.max(
      ...recentEvents.map((ev) => (ev.endedAt ?? new Date()).getTime()),
    );
    earliestRetry = new Date(
      latestEnd + PROMOTION_THRESHOLDS.algorithmEventCooldownDays * 86_400_000,
    );
  } else if (!diversityPass && maxShare > PROMOTION_THRESHOLDS.maxSingleNetworkShare) {
    result = 'blocked_by_single_source';
  } else if (failing.length === 0) {
    result = 'ready';
  } else {
    result = 'not_ready';
  }

  return { result, criteria, earliestRetryDate: earliestRetry, failingReasons: failing };
}
