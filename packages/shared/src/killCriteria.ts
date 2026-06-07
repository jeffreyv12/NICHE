// Phase 6.2 — kill-list automation criteria.
//
// Pure evaluation of the automatable kill criteria for a niche. The daily job
// computes the inputs from the DB and writes a *recommendation*; it NEVER kills
// (CLAUDE.md #2 + #13 — the operator confirms). Mirrors the validation /
// promotion recommendation pattern.
//
// Reasons mirror the automatable subset of the kill_reason enum
// (packages/db/src/enums.ts).

export type AutoKillReason =
  | "kill_list_match"
  | "google_penalty"
  | "low_revenue_month_6"
  | "low_traffic_month_6";

export interface KillCriteriaInput {
  nicheAgeDays: number;
  /** Commission revenue (EUR) in the trailing 30 days, countable conversions only. */
  trailing30dRevenueEur: number;
  /** Organic clicks in the trailing 30 days (GSC). */
  trailing30dOrganicClicks: number;
  /** topic/keywords hit a §A hard-block kill-list category. */
  killListHardBlock: boolean;
  /** GSC reports a manual action against the niche's property. */
  hasGoogleManualAction: boolean;
}

export interface KillCriteriaThresholds {
  /** "Month 6" maturity gate before low-revenue/traffic flags apply. */
  matureAgeDays: number;
  minMonthlyRevenueEur: number;
  minMonthlyOrganicClicks: number;
}

export const DEFAULT_KILL_THRESHOLDS: KillCriteriaThresholds = {
  matureAgeDays: 180,
  minMonthlyRevenueEur: 10,
  minMonthlyOrganicClicks: 100,
};

export interface KillFlag {
  reason: AutoKillReason;
  detail: string;
}

/** Evaluate the automatable kill criteria. Returns the matched flags (possibly
 *  several); an empty array means "healthy — no recommendation". */
export function evaluateKillCriteria(
  input: KillCriteriaInput,
  thresholds: KillCriteriaThresholds = DEFAULT_KILL_THRESHOLDS,
): KillFlag[] {
  const flags: KillFlag[] = [];

  // Kill-list match overrides everything and ignores maturity.
  if (input.killListHardBlock) {
    flags.push({
      reason: "kill_list_match",
      detail: "Topic matcht een §A hard-block kill-list categorie.",
    });
  }

  if (input.hasGoogleManualAction) {
    flags.push({ reason: "google_penalty", detail: "GSC meldt een handmatige actie." });
  }

  const mature = input.nicheAgeDays >= thresholds.matureAgeDays;
  if (mature && input.trailing30dRevenueEur < thresholds.minMonthlyRevenueEur) {
    flags.push({
      reason: "low_revenue_month_6",
      detail: `30d-omzet €${input.trailing30dRevenueEur.toFixed(2)} < drempel €${thresholds.minMonthlyRevenueEur} na ${input.nicheAgeDays}d.`,
    });
  }
  if (mature && input.trailing30dOrganicClicks < thresholds.minMonthlyOrganicClicks) {
    flags.push({
      reason: "low_traffic_month_6",
      detail: `30d-clicks ${input.trailing30dOrganicClicks} < drempel ${thresholds.minMonthlyOrganicClicks} na ${input.nicheAgeDays}d.`,
    });
  }

  return flags;
}
