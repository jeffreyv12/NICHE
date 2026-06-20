// Pure conversion-status helpers — no Node.js crypto dependency.
// Extracted from webhooks.ts so these can be imported safely in Edge contexts
// (e.g. transitively via the @nichefinder/shared barrel → nicheMonthlyMetrics).

// =============================================================================
// SubID — the [tenant_slug]:[page_slug]:[cohort] tracking key.
// =============================================================================

export interface SubIdParts {
  tenantSlug: string;
  pageSlug: string;
  cohort: string;
}

const SUBID_SEP = ":";

/** Build a subid from its parts. Inverse of {@link parseSubId}. */
export function formatSubId(parts: SubIdParts): string {
  return [parts.tenantSlug, parts.pageSlug, parts.cohort].join(SUBID_SEP);
}

/**
 * Parse a subid into its parts, or return null if it is malformed (wrong
 * segment count or any empty segment). Tolerant of surrounding whitespace.
 */
export function parseSubId(raw: string | null | undefined): SubIdParts | null {
  if (!raw) return null;
  const segments = raw.trim().split(SUBID_SEP);
  if (segments.length !== 3) return null;
  const [tenantSlug, pageSlug, cohort] = segments;
  if (!tenantSlug || !pageSlug || !cohort) return null;
  return { tenantSlug, pageSlug, cohort };
}

// =============================================================================
// Conversion status — canonicalize each network's vocabulary, then decide
// which conversions count toward the validation revenue signal.
// =============================================================================

export type CanonicalConversionStatus = "approved" | "pending" | "declined";

const APPROVED_TOKENS = new Set([
  "approved",
  "confirmed",
  "accepted",
  "paid",
  "valid",
  "validated",
]);
const DECLINED_TOKENS = new Set([
  "declined",
  "disapproved",
  "cancelled",
  "canceled",
  "rejected",
  "deleted",
  "reversed",
  "refunded",
  "void",
]);

/** Map a raw network status string to our three canonical buckets. */
export function canonicalConversionStatus(
  raw: string | null | undefined,
): CanonicalConversionStatus {
  const s = (raw ?? "").trim().toLowerCase();
  if (APPROVED_TOKENS.has(s)) return "approved";
  if (DECLINED_TOKENS.has(s)) return "declined";
  return "pending";
}

// Operator decision (2026-06-06): pending conversions do NOT count toward the
// validation revenue figure. Flip to `true` to trade safety for an earlier
// revenue signal (see webhooks.ts for full rationale).
export const COUNT_PENDING_AS_REVENUE = false;

/**
 * Policy: does a conversion in this status count toward the revenue figure the
 * Validation Agent sees?
 */
export function conversionCountsAsRevenue(
  status: CanonicalConversionStatus,
  countPending: boolean = COUNT_PENDING_AS_REVENUE,
): boolean {
  if (status === "approved") return true;
  if (status === "declined") return false;
  return countPending;
}
