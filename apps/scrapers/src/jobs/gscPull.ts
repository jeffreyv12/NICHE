// Phase 3.2 / Promotion Gate — daily Google Search Console pull.
//
// For each active tenant with a `gscSiteUrl` in config:
//   1. Pull date-level totals (clicks, impressions, CTR, avgPosition) for the
//      last `lookbackDays` (default 3 — data lags ~2 days in GSC).
//   2. Pull query-level breakdown for the same window; classify branded vs
//      non-brand long-tail based on `brandKeywords` in tenant config.
//   3. Upsert into `gsc_metrics` (tenant_id + date unique constraint).
//
// The gsc_metrics table feeds the Promotion Gate C2 (organic clicks) and
// C4 (branded search signal) criteria.

import type { ServiceDb } from "@nichefinder/db";
import { gscMetrics, gscPageMetrics, tenants } from "@nichefinder/db";
import { normalizeGscPagePath } from "@nichefinder/shared";
import { and, eq, gte } from "drizzle-orm";
import { GscClient } from "../sources/gsc/client.js";
import type { ServiceAccountJson } from "../sources/gsc/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantGscConfig {
  gscSiteUrl?: string;
  brandKeywords?: string[];
}

export interface RunGscPullJobOptions {
  db: ServiceDb;
  serviceAccount: ServiceAccountJson;
  /** Days to look back (default 3). GSC data finalises ~2 days after the date. */
  lookbackDays?: number;
  fetchImpl?: typeof fetch;
  /** Injectable GscClient for testing — bypasses serviceAccount+fetchImpl. */
  gscClient?: Pick<GscClient, "querySearchAnalytics">;
}

export interface GscPullTenantResult {
  tenantId: string;
  slug: string;
  siteUrl: string;
  datesWritten: number;
  /** Distinct (date, page_path) rows written to gsc_page_metrics (migration 0010). */
  pagesWritten: number;
  error?: string;
}

export interface RunGscPullJobResult {
  tenantsProcessed: number;
  tenantsSkipped: number;
  datesWritten: number;
  pagesWritten: number;
  errors: string[];
  tenants: GscPullTenantResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoDate(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function extractConfig(raw: unknown): TenantGscConfig {
  if (!raw || typeof raw !== "object") return {};
  return raw as TenantGscConfig;
}

/** Returns true when `query` contains at least one brand keyword (case-insensitive). */
function isBranded(query: string, brandKeywords: string[]): boolean {
  const q = query.toLowerCase();
  return brandKeywords.some((kw) => q.includes(kw.toLowerCase()));
}

/** Long-tail: non-branded query with ≥3 words. */
function isLongTail(query: string, brandKeywords: string[]): boolean {
  return !isBranded(query, brandKeywords) && query.trim().split(/\s+/).length >= 3;
}

// ---------------------------------------------------------------------------
// Core job
// ---------------------------------------------------------------------------

export async function runGscPullJob(opts: RunGscPullJobOptions): Promise<RunGscPullJobResult> {
  const lookbackDays = opts.lookbackDays ?? 3;
  const startDate = isoDate(lookbackDays);
  const endDate = isoDate(1); // yesterday (today's data is almost always missing)

  const client: Pick<GscClient, "querySearchAnalytics"> =
    opts.gscClient ??
    new GscClient({
      serviceAccount: opts.serviceAccount,
      fetchImpl: opts.fetchImpl,
    });

  // Load all active tenants.
  const allTenants = await opts.db.select().from(tenants).where(eq(tenants.isActive, true));

  const result: RunGscPullJobResult = {
    tenantsProcessed: 0,
    tenantsSkipped: 0,
    datesWritten: 0,
    pagesWritten: 0,
    errors: [],
    tenants: [],
  };

  for (const tenant of allTenants) {
    const config = extractConfig(tenant.config);

    if (!config.gscSiteUrl) {
      result.tenantsSkipped++;
      continue;
    }

    const siteUrl = config.gscSiteUrl;
    const brandKeywords = config.brandKeywords ?? [];

    try {
      // 1. Date-level totals.
      const dateRows = await client.querySearchAnalytics(siteUrl, {
        startDate,
        endDate,
        dimensions: ["date"],
        rowLimit: 1000,
      });

      // 2. Query-level for branded/long-tail classification.
      const queryRows = await client.querySearchAnalytics(siteUrl, {
        startDate,
        endDate,
        dimensions: ["date", "query"],
        rowLimit: 5000,
      });

      // Index query rows by date for fast lookup.
      const queryByDate = new Map<string, typeof queryRows.rows>();
      for (const row of queryRows.rows) {
        const [date] = row.keys; // first dimension is date
        if (!date) continue;
        const existing = queryByDate.get(date) ?? [];
        existing.push(row);
        queryByDate.set(date, existing);
      }

      let datesWritten = 0;
      for (const row of dateRows.rows) {
        const [date] = row.keys;
        if (!date) continue;

        const dayQueries = queryByDate.get(date) ?? [];
        let brandedClicks = 0;
        let nonBrandLongTailClicks = 0;
        const byQuery: Record<string, { clicks: number; impressions: number; position: number }> =
          {};
        for (const q of dayQueries) {
          const query = q.keys[1] ?? "";
          if (isBranded(query, brandKeywords)) brandedClicks += q.clicks;
          if (isLongTail(query, brandKeywords)) nonBrandLongTailClicks += q.clicks;
          byQuery[query] = {
            clicks: q.clicks,
            impressions: q.impressions,
            position: q.position,
          };
        }

        // Upsert: insert or update on (tenant_id, date).
        await opts.db
          .insert(gscMetrics)
          .values({
            tenantId: tenant.id,
            date,
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: String(row.ctr.toFixed(4)),
            avgPosition: String(row.position.toFixed(2)),
            brandedClicks,
            nonBrandLongTailClicks,
            byQuery,
            fetchedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [gscMetrics.tenantId, gscMetrics.date],
            set: {
              clicks: row.clicks,
              impressions: row.impressions,
              ctr: String(row.ctr.toFixed(4)),
              avgPosition: String(row.position.toFixed(2)),
              brandedClicks,
              nonBrandLongTailClicks,
              byQuery,
              fetchedAt: new Date(),
            },
          });
        datesWritten++;
      }

      // 3. Page-level clicks → gsc_page_metrics (migration 0010), for per-niche
      //    organic-click attribution. Page count per site is bounded, so one
      //    ["date","page"] query over the short lookback stays within the row
      //    cap. Distinct GSC URLs (trailing slash / query variants) collapse
      //    onto one normalized path, so aggregate before the upsert.
      const pageRows = await client.querySearchAnalytics(siteUrl, {
        startDate,
        endDate,
        dimensions: ["date", "page"],
        rowLimit: 5000,
      });

      const pageAgg = new Map<
        string,
        { date: string; pagePath: string; clicks: number; impressions: number }
      >();
      for (const row of pageRows.rows) {
        const [date, rawPage] = row.keys;
        if (!date || !rawPage) continue;
        const pagePath = normalizeGscPagePath(rawPage);
        const key = `${date}\n${pagePath}`;
        const cur = pageAgg.get(key) ?? { date, pagePath, clicks: 0, impressions: 0 };
        cur.clicks += row.clicks;
        cur.impressions += row.impressions;
        pageAgg.set(key, cur);
      }

      let pagesWritten = 0;
      for (const p of pageAgg.values()) {
        await opts.db
          .insert(gscPageMetrics)
          .values({
            tenantId: tenant.id,
            date: p.date,
            pagePath: p.pagePath,
            clicks: p.clicks,
            impressions: p.impressions,
            fetchedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [gscPageMetrics.tenantId, gscPageMetrics.date, gscPageMetrics.pagePath],
            set: {
              clicks: p.clicks,
              impressions: p.impressions,
              fetchedAt: new Date(),
            },
          });
        pagesWritten++;
      }

      result.tenantsProcessed++;
      result.datesWritten += datesWritten;
      result.pagesWritten += pagesWritten;
      result.tenants.push({
        tenantId: tenant.id,
        slug: tenant.slug,
        siteUrl,
        datesWritten,
        pagesWritten,
      });
    } catch (err) {
      const msg = `tenant ${tenant.slug} (${siteUrl}): ${err instanceof Error ? err.message : String(err)}`;
      result.errors.push(msg);
      result.tenants.push({
        tenantId: tenant.id,
        slug: tenant.slug,
        siteUrl,
        datesWritten: 0,
        pagesWritten: 0,
        error: msg,
      });
    }
  }

  return result;
}
