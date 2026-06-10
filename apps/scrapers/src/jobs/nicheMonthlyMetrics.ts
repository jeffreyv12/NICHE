// Phase 5.4 support — nightly per-niche monthly-metrics rollup (migration 0009).
//
// Recomputes the last `monthsBack` calendar months of per-niche revenue from
// `conversions` (attributed via page_id → pages.niche_id) and upserts the
// monthly close into `niche_monthly_metrics`. Recomputing a trailing window each
// run lets late-arriving conversions and refunds settle recent months while
// older months stabilise.
//
// REVENUE ONLY. `organic_clicks` is left untouched (NULL) — it is not derivable
// per niche yet (gsc_metrics is tenant-grain). When the GSC page-dimension pull
// lands it backfills that column; this job's upsert deliberately does NOT write
// organic_clicks, so that future backfill survives. TODO(gsc-page-dim).
//
// Pure aggregation lives in @nichefinder/shared (rollupNicheMonthlyRevenue);
// this file is the I/O shell. Injected db + an injectable conversion loader make
// it unit-testable without a live DB. Mirrors killScan.ts.

import { type ServiceDb, conversions, nicheMonthlyMetrics, niches, pages } from "@nichefinder/db";
import {
  type ConversionForRollup,
  lastNMonthKeys,
  rollupNicheMonthlyRevenue,
} from "@nichefinder/shared";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

// Niche states whose revenue is worth a monthly close (have/earn pages).
const TRACKED_STATES = ["validating", "go", "building", "mature", "promoted"] as const;

export interface LoadedConversion extends ConversionForRollup {
  tenantId: string | null;
}

export interface RunNicheMonthlyMetricsOptions {
  db: ServiceDb;
  /** ISO timestamp for "now". Default real now. */
  asOf?: string;
  /** How many recent calendar months to recompute each run. Default 4. */
  monthsBack?: number;
  /** Only roll up this niche (operator on-demand). Default: all tracked niches. */
  nicheId?: string;
  /** Count still-pending conversions as revenue? Default: false (approved-only). */
  countPending?: boolean;
  /** Injectable conversion loader for tests. Defaults to the pages-join query. */
  loadConversions?: (
    db: ServiceDb,
    sinceIso: string,
    nicheId?: string,
  ) => Promise<LoadedConversion[]>;
}

export interface RunNicheMonthlyMetricsResult {
  niches: number;
  months: string[];
  rowsUpserted: number;
  totalRevenueEur: number;
}

interface TargetNiche {
  id: string;
  tenantId: string | null;
}

export async function runNicheMonthlyMetricsJob(
  opts: RunNicheMonthlyMetricsOptions,
): Promise<RunNicheMonthlyMetricsResult> {
  const asOf = new Date(opts.asOf ?? new Date().toISOString());
  const monthsBack = opts.monthsBack ?? 4;
  const months = lastNMonthKeys(asOf, monthsBack);
  const sinceIso = `${months[0]}T00:00:00.000Z`;
  const loadConversions = opts.loadConversions ?? defaultLoadConversions;

  const targets = await selectTargetNiches(opts.db, opts.nicheId);
  if (targets.length === 0) {
    return { niches: 0, months, rowsUpserted: 0, totalRevenueEur: 0 };
  }

  const loaded = await loadConversions(opts.db, sinceIso, opts.nicheId);
  const rolled = rollupNicheMonthlyRevenue(loaded, { countPending: opts.countPending });

  // Index rolled revenue by `${nicheId} ${month}` for O(1) lookup while filling
  // the full niche × window grid (so a month that dropped to €0 is overwritten,
  // not left stale).
  const byKey = new Map(rolled.map((r) => [`${r.nicheId} ${r.month}`, r]));

  const rows = targets.flatMap((niche) =>
    months.map((month) => {
      const hit = byKey.get(`${niche.id} ${month}`);
      return {
        nicheId: niche.id,
        tenantId: niche.tenantId,
        month,
        revenueEur: (hit?.revenueEur ?? 0).toFixed(2),
        conversionsCount: hit?.conversionsCount ?? 0,
      };
    }),
  );

  await opts.db
    .insert(nicheMonthlyMetrics)
    .values(rows)
    .onConflictDoUpdate({
      target: [nicheMonthlyMetrics.nicheId, nicheMonthlyMetrics.month],
      set: {
        // excluded.* = the values from this INSERT, so each conflicting row gets
        // its own recomputed figure. organic_clicks is intentionally absent.
        revenueEur: sql`excluded.revenue_eur`,
        conversionsCount: sql`excluded.conversions_count`,
        tenantId: sql`excluded.tenant_id`,
        computedAt: sql`now()`,
      },
    });

  const totalRevenueEur = Math.round(rolled.reduce((sum, r) => sum + r.revenueEur, 0) * 100) / 100;

  return { niches: targets.length, months, rowsUpserted: rows.length, totalRevenueEur };
}

async function selectTargetNiches(
  db: ServiceDb,
  nicheId: string | undefined,
): Promise<TargetNiche[]> {
  const cols = { id: niches.id, tenantId: niches.tenantId };
  if (nicheId) {
    return db.select(cols).from(niches).where(eq(niches.id, nicheId)).limit(1) as Promise<
      TargetNiche[]
    >;
  }
  return db
    .select(cols)
    .from(niches)
    .where(inArray(niches.state, [...TRACKED_STATES])) as Promise<TargetNiche[]>;
}

// -----------------------------------------------------------------------------
// Default conversion loader: countable-or-not conversions since `since`,
// attributed to a niche via page_id → pages.niche_id. Conversions with no page
// (or whose page has no niche) cannot be attributed and are excluded — the
// promotion gate judges a niche on its OWN pages' revenue. The countable filter
// is applied later in the pure rollup.
// -----------------------------------------------------------------------------

async function defaultLoadConversions(
  db: ServiceDb,
  sinceIso: string,
  nicheId?: string,
): Promise<LoadedConversion[]> {
  const rows = await db
    .select({
      nicheId: pages.nicheId,
      tenantId: conversions.tenantId,
      occurredAt: conversions.occurredAt,
      commissionCents: conversions.commissionCents,
      status: conversions.status,
    })
    .from(conversions)
    .innerJoin(pages, eq(conversions.pageId, pages.id))
    .where(
      and(
        isNotNull(pages.nicheId),
        gte(conversions.occurredAt, new Date(sinceIso)),
        nicheId ? eq(pages.nicheId, nicheId) : undefined,
      ),
    );

  return rows
    .filter((r): r is typeof r & { nicheId: string } => r.nicheId !== null)
    .map((r) => ({
      nicheId: r.nicheId,
      tenantId: r.tenantId,
      occurredAt: r.occurredAt,
      commissionCents: r.commissionCents,
      status: r.status,
    }));
}
