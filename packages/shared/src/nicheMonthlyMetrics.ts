// Phase 5.4 support — per-niche, per-month metrics rollup (the "monthly close").
//
// The promotion gate (docs/PROMOTION_GATE.md) is expressed in CONSECUTIVE
// CALENDAR MONTHS (≥€150 avg, no month below €75, 3 months running). Computing
// that off live `conversions` each run is fragile: a refund months later mutates
// a past month, and there is no point-in-time snapshot. This module defines the
// pure rollup that the nightly job persists into `niche_monthly_metrics`, so the
// gate reads stable monthly figures instead of re-deriving them every time.
//
// Pure + I/O-free per FOLDER_STRUCTURE.md; the job feeds it rows and writes the
// result. Revenue counts only *countable* conversions — same policy as the
// validation/kill signals (approved-only by default; see webhooks.ts).
//
// SCOPE NOTE: this rollup covers REVENUE only. Per-niche organic clicks are not
// yet derivable — `gsc_metrics` is tenant-grain (unique on tenant_id+date) and
// the GSC pull does not request the `page` dimension. Clicks are left to a
// follow-up that adds page-level GSC attribution. TODO(gsc-page-dim).

import { canonicalConversionStatus, conversionCountsAsRevenue } from "./webhooks";

/** One conversion reduced to what the revenue rollup needs. `nicheId` is the
 *  niche the conversion's page belongs to; the caller resolves it via
 *  conversions.page_id → pages.niche_id and drops unattributable rows. */
export interface ConversionForRollup {
  nicheId: string;
  /** ISO string or Date of the sale. Unparseable values are skipped. */
  occurredAt: string | Date;
  commissionCents: number;
  /** Raw network status; canonicalised internally. */
  status: string | null | undefined;
}

export interface NicheMonthlyRevenue {
  nicheId: string;
  /** First-of-month UTC, "YYYY-MM-01" — the monthly bucket key. */
  month: string;
  /** Countable commission for the month, EUR (rounded to cents). */
  revenueEur: number;
  /** Number of countable conversions in the month. */
  conversionsCount: number;
}

/** First-of-month UTC date string ("YYYY-MM-01") for a timestamp. */
export function monthKeyUTC(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/** The `n` most recent month keys ending at `asOf`'s month, oldest → newest. */
export function lastNMonthKeys(asOf: Date, n: number): string[] {
  const keys: string[] = [];
  for (let back = n - 1; back >= 0; back--) {
    keys.push(
      new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - back, 1))
        .toISOString()
        .slice(0, 10),
    );
  }
  return keys;
}

/**
 * Roll conversions up to per-(niche, month) countable revenue. Pure.
 *
 * Only conversions whose canonical status counts as revenue contribute, so a
 * still-pending or reversed conversion never inflates a month (matching the
 * validation/kill revenue policy — see {@link conversionCountsAsRevenue}).
 */
export function rollupNicheMonthlyRevenue(
  rows: readonly ConversionForRollup[],
  opts: { countPending?: boolean } = {},
): NicheMonthlyRevenue[] {
  const acc = new Map<string, NicheMonthlyRevenue>();

  for (const r of rows) {
    if (!conversionCountsAsRevenue(canonicalConversionStatus(r.status), opts.countPending))
      continue;
    const d = r.occurredAt instanceof Date ? r.occurredAt : new Date(r.occurredAt);
    if (Number.isNaN(d.getTime())) continue;

    const month = monthKeyUTC(d);
    // niche ids are uuids (no space) — a space cleanly delimits the composite key.
    const key = `${r.nicheId} ${month}`;
    const cur = acc.get(key) ?? { nicheId: r.nicheId, month, revenueEur: 0, conversionsCount: 0 };
    cur.revenueEur += r.commissionCents / 100;
    cur.conversionsCount += 1;
    acc.set(key, cur);
  }

  // Round once at the end to avoid float drift accumulating across rows.
  return [...acc.values()].map((m) => ({
    ...m,
    revenueEur: Math.round(m.revenueEur * 100) / 100,
  }));
}

/**
 * Map persisted monthly rows for ONE niche to the promotion gate's
 * `[m-2, m-1, m-0]` revenue tuple (oldest → newest). Months with no stored row
 * are treated as €0 — a missing month is a failing month, not an absent one.
 */
export function toRevenueSeries(
  monthly: ReadonlyArray<{ month: string; revenueEur: number }>,
  asOf: Date,
): [number, number, number] {
  const keys = lastNMonthKeys(asOf, 3);
  const byMonth = new Map(monthly.map((m) => [m.month, m.revenueEur]));
  return keys.map((k) => byMonth.get(k) ?? 0) as [number, number, number];
}
