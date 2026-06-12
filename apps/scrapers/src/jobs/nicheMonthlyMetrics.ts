// Phase 5.4 support — nightly per-niche monthly-metrics rollup (migration 0009).
//
// Recomputes the last `monthsBack` calendar months of per-niche revenue from
// `conversions` (attributed via page_id → pages.niche_id) and upserts the
// monthly close into `niche_monthly_metrics`. Recomputing a trailing window each
// run lets late-arriving conversions and refunds settle recent months while
// older months stabilise.
//
// REVENUE + ORGANIC CLICKS. Revenue comes from `conversions`; per-niche organic
// clicks come from `gsc_page_metrics` (migration 0010), attributed to a niche via
// page_path → pages.full_path → niche_id. Both sides normalize the path with the
// SAME normalizeGscPagePath so GSC's URL variants compare equal to full_path.
//
// organic_clicks uses PRESERVE-ON-NO-DATA semantics (unlike the zero-filled
// revenue): a niche×month with no matching GSC rows is inserted as NULL, and the
// conflict SET coalesces (excluded → existing) so a gap never overwrites a real
// figure. The table is new and backfills gradually, so "no rows" means "unknown",
// not "zero" — and the promotion gate's C2 must not read a false 0 (CLAUDE.md #10).
//
// Pure aggregation lives in @nichefinder/shared (rollupNicheMonthlyRevenue,
// rollupNicheMonthlyOrganicClicks); this file is the I/O shell. Injected db +
// injectable loaders make it unit-testable without a live DB. Mirrors killScan.ts.

import {
  type ServiceDb,
  conversions,
  gscPageMetrics,
  nicheMonthlyMetrics,
  niches,
  pages,
} from "@nichefinder/db";
import {
  type ConversionForRollup,
  type PageClicksRow,
  lastNMonthKeys,
  normalizeGscPagePath,
  rollupNicheMonthlyOrganicClicks,
  rollupNicheMonthlyRevenue,
  tenantPathKey,
} from "@nichefinder/shared";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

// Niche states whose revenue is worth a monthly close (have/earn pages).
const TRACKED_STATES = ["validating", "go", "building", "mature", "promoted"] as const;

export interface LoadedConversion extends ConversionForRollup {
  tenantId: string | null;
}

/** One niche-owned page, used to build the tenant+path → niche attribution map. */
export interface NichePathRow {
  nicheId: string;
  /** Owning tenant; pages.tenant_id is NOT NULL, so this is always present. */
  tenantId: string;
  /** Stored pages.full_path; normalized before keying. */
  fullPath: string;
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
  /** Injectable page-clicks loader. Defaults to a gsc_page_metrics window query. */
  loadPageClicks?: (db: ServiceDb, sinceIso: string, nicheId?: string) => Promise<PageClicksRow[]>;
  /** Injectable niche-paths loader. Defaults to a pages query over niche-owned pages. */
  loadNichePaths?: (db: ServiceDb, nicheId?: string) => Promise<NichePathRow[]>;
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
  const loadPageClicks = opts.loadPageClicks ?? defaultLoadPageClicks;
  const loadNichePaths = opts.loadNichePaths ?? defaultLoadNichePaths;

  const targets = await selectTargetNiches(opts.db, opts.nicheId);
  if (targets.length === 0) {
    return { niches: 0, months, rowsUpserted: 0, totalRevenueEur: 0 };
  }

  const loaded = await loadConversions(opts.db, sinceIso, opts.nicheId);
  const rolled = rollupNicheMonthlyRevenue(loaded, { countPending: opts.countPending });

  // Organic clicks: map each niche-owned page path → nicheId (tenant-scoped, same
  // normalization as the GSC side), then roll page-grain clicks up per niche×month.
  const nichePaths = await loadNichePaths(opts.db, opts.nicheId);
  const nicheByTenantPath = new Map<string, string>();
  for (const p of nichePaths) {
    nicheByTenantPath.set(tenantPathKey(p.tenantId, normalizeGscPagePath(p.fullPath)), p.nicheId);
  }
  const pageClicks = await loadPageClicks(opts.db, sinceIso, opts.nicheId);
  const organic = rollupNicheMonthlyOrganicClicks(pageClicks, nicheByTenantPath);

  // Index rolled revenue + organic clicks by `${nicheId} ${month}` for O(1) lookup
  // while filling the full niche × window grid (so a month that dropped to €0 is
  // overwritten, not left stale).
  const byKey = new Map(rolled.map((r) => [`${r.nicheId} ${r.month}`, r]));
  const organicByKey = new Map(organic.map((o) => [`${o.nicheId} ${o.month}`, o.organicClicks]));

  const rows = targets.flatMap((niche) =>
    months.map((month) => {
      const hit = byKey.get(`${niche.id} ${month}`);
      // PRESERVE-ON-NO-DATA: no matching GSC rows → NULL (not 0), so the coalesce
      // SET below keeps any prior value instead of asserting "no organic traffic".
      const organicClicks = organicByKey.get(`${niche.id} ${month}`) ?? null;
      return {
        nicheId: niche.id,
        tenantId: niche.tenantId,
        month,
        revenueEur: (hit?.revenueEur ?? 0).toFixed(2),
        conversionsCount: hit?.conversionsCount ?? 0,
        organicClicks,
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
        // its own recomputed figure.
        revenueEur: sql`excluded.revenue_eur`,
        conversionsCount: sql`excluded.conversions_count`,
        // Keep the stored organic_clicks when this run had no GSC data for the
        // niche×month (excluded.organic_clicks IS NULL) — see PRESERVE-ON-NO-DATA.
        organicClicks: sql`coalesce(excluded.organic_clicks, ${nicheMonthlyMetrics.organicClicks})`,
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

// -----------------------------------------------------------------------------
// Default page-clicks loader: page-grain GSC clicks since `since` from
// gsc_page_metrics (migration 0010). Tenant-scoped attribution happens in the
// rollup; this just streams the window. nicheId can't filter here (the table has
// no niche dimension) — over-fetch is bounded by the page count per site.
// -----------------------------------------------------------------------------

async function defaultLoadPageClicks(
  db: ServiceDb,
  sinceIso: string,
  _nicheId?: string,
): Promise<PageClicksRow[]> {
  return db
    .select({
      tenantId: gscPageMetrics.tenantId,
      pagePath: gscPageMetrics.pagePath,
      date: gscPageMetrics.date,
      clicks: gscPageMetrics.clicks,
    })
    .from(gscPageMetrics)
    .where(gte(gscPageMetrics.date, sinceIso.slice(0, 10))) as Promise<PageClicksRow[]>;
}

// -----------------------------------------------------------------------------
// Default niche-paths loader: every niche-owned page's (tenant_id, full_path).
// Pages with no niche are excluded — clicks on them can't be attributed. When a
// single niche is targeted, restrict to its pages.
// -----------------------------------------------------------------------------

async function defaultLoadNichePaths(db: ServiceDb, nicheId?: string): Promise<NichePathRow[]> {
  const rows = await db
    .select({
      nicheId: pages.nicheId,
      tenantId: pages.tenantId,
      fullPath: pages.fullPath,
    })
    .from(pages)
    .where(and(isNotNull(pages.nicheId), nicheId ? eq(pages.nicheId, nicheId) : undefined));

  return rows
    .filter((r): r is typeof r & { nicheId: string } => r.nicheId !== null)
    .map((r) => ({ nicheId: r.nicheId, tenantId: r.tenantId, fullPath: r.fullPath }));
}
