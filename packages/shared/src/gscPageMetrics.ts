// Phase 3.2 / 5.4 support — per-niche organic-click attribution via the GSC
// page dimension (feeds niche_monthly_metrics.organic_clicks, Promotion Gate C2).
//
// gsc_metrics is TENANT-grain (unique on tenant_id+date), so it can answer "how
// many organic clicks did this *site* get" but never "...this *niche*". This
// module turns page-grain GSC rows (clicks per page-URL per day, persisted in
// gsc_page_metrics) into per-(niche, month) click totals that backfill
// niche_monthly_metrics.organic_clicks and feed the promotion gate's C2 criterion.
//
// Attribution path: GSC page URL → normalized path → pages.full_path → niche.
// It MUST be tenant-scoped: pages.full_path is unique only per (tenant_id, slug),
// so the same path (e.g. "/") can exist under two tenants. Keying on tenant+path
// prevents crediting one tenant's clicks to another tenant's niche (CLAUDE.md #9).
//
// Pure + I/O-free per FOLDER_STRUCTURE.md; the job loads the rows and the
// tenant→path→niche map, this rolls them up. Mirrors rollupNicheMonthlyRevenue.

import { monthKeyUTC } from "./nicheMonthlyMetrics";

/**
 * Normalize a GSC page identifier (an absolute URL like
 * "https://site.nl/test/koffie/?utm=1#x", or a bare path) to a canonical path
 * for matching against `pages.full_path`. Strips scheme+host, query, and
 * fragment; decodes percent-encoding; drops a trailing slash (except root).
 *
 * Applied symmetrically to BOTH the GSC URL and the stored full_path, so the two
 * sides compare equal regardless of how GSC reports the URL.
 */
export function normalizeGscPagePath(raw: string): string {
  let path = raw.trim();

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    // Absolute URL — URL().pathname already excludes query + fragment.
    try {
      path = new URL(path).pathname;
    } catch {
      // Unparseable URL: fall through and treat the raw string as a path.
    }
  } else {
    // Bare path: strip query/fragment manually.
    const cut = path.search(/[?#]/);
    if (cut !== -1) path = path.slice(0, cut);
  }

  // Match a full_path stored in decoded form (slugs are ASCII, so this is a
  // no-op in practice, but defends against GSC returning encoded URLs).
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed escape sequence: keep the path as-is.
  }

  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

/**
 * Composite Map key for tenant-scoped path lookup. Tenant ids are uuids (no
 * newline) and paths never contain a newline, so "\n" is a collision-free
 * delimiter. (A NUL byte would corrupt source files — see the 0009 post-mortem;
 * a runtime-only newline key is safe.)
 */
export function tenantPathKey(tenantId: string, normalizedPath: string): string {
  return `${tenantId}\n${normalizedPath}`;
}

/** One page-grain daily GSC click row, as loaded from gsc_page_metrics. */
export interface PageClicksRow {
  tenantId: string;
  /** Raw GSC page URL or path; normalized internally before matching. */
  pagePath: string;
  /** ISO string or Date of the day. Unparseable values are skipped. */
  date: string | Date;
  clicks: number;
}

export interface NicheMonthlyOrganicClicks {
  nicheId: string;
  /** First-of-month UTC, "YYYY-MM-01". */
  month: string;
  organicClicks: number;
}

/**
 * Roll page-grain clicks up to per-(niche, month) organic-click totals. Pure.
 *
 * @param nicheByTenantPath map from {@link tenantPathKey}(tenantId, normalized
 *   full_path) → nicheId. The caller builds it from the `pages` table using the
 *   SAME {@link normalizeGscPagePath}, so both sides match. Clicks on a page with
 *   no entry (path not in `pages`, or its page has no niche) are dropped — a
 *   niche is judged only on its OWN pages, mirroring the revenue rollup.
 */
export function rollupNicheMonthlyOrganicClicks(
  rows: readonly PageClicksRow[],
  nicheByTenantPath: ReadonlyMap<string, string>,
): NicheMonthlyOrganicClicks[] {
  const acc = new Map<string, NicheMonthlyOrganicClicks>();

  for (const r of rows) {
    const nicheId = nicheByTenantPath.get(
      tenantPathKey(r.tenantId, normalizeGscPagePath(r.pagePath)),
    );
    if (!nicheId) continue;

    const d = r.date instanceof Date ? r.date : new Date(r.date);
    if (Number.isNaN(d.getTime())) continue;

    const month = monthKeyUTC(d);
    const key = `${nicheId}\n${month}`;
    const cur = acc.get(key) ?? { nicheId, month, organicClicks: 0 };
    cur.organicClicks += r.clicks;
    acc.set(key, cur);
  }

  return [...acc.values()];
}
