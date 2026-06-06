// Phase 3.3 — Validation metrics aggregator.
//
// Builds the `ValidationInput` the Validation Agent consumes for one niche,
// from data the engine already has:
//   - test pages          → pages where niche_id = X and kind = 'test_page'
//   - affiliate clicks     → non-bot `clicks` on those pages within the window
//   - clicks by network    → joined via affiliate_links.network
//   - conversions/revenue  → `conversions` on those pages within the window
//
// Sessions / bounce / time-on-page / paid spend / email signups are NOT in the
// database (Plausible + paid platforms are external). They arrive via an
// injectable AnalyticsAdapter; the default returns zeros so the job still runs
// for smoke tests (the agent reflects the thin data in its `confidence`).
//
// Returns null when the niche has no test pages — there is nothing to validate
// yet, and ValidationInputSchema requires ≥1 test page.

import type { validationAgent } from "@nichefinder/agent-sdk";
import {
  type ServiceDb,
  affiliateLinks,
  clicks,
  conversions,
  niches,
  pages,
} from "@nichefinder/db";
import { canonicalConversionStatus, conversionCountsAsRevenue } from "@nichefinder/shared";
import { and, eq, gte, inArray } from "drizzle-orm";

type ValidationInput = validationAgent.ValidationInput;

// -----------------------------------------------------------------------------
// Analytics adapter — the seam for Plausible (Phase 3.2+). Default = zeros.
// -----------------------------------------------------------------------------

export interface NicheAnalytics {
  /** Sessions per test-page, keyed by the page's full_path. */
  sessionsByPath: Record<string, number>;
  /** Total sessions across the niche in the window. */
  sessionsTotal: number;
  bounceRate?: number;
  avgTimeOnPageSeconds?: number;
  paidTrafficSpendEur?: number;
  emailSignups?: number;
}

export interface AnalyticsAdapterArgs {
  nicheId: string;
  topicSlug: string;
  pagePaths: string[];
  windowDays: number;
  asOf: string;
}

export interface AnalyticsAdapter {
  fetch(args: AnalyticsAdapterArgs): Promise<NicheAnalytics>;
}

/** No-signal adapter: every analytics value is zero / absent. */
export const emptyAnalyticsAdapter: AnalyticsAdapter = {
  async fetch() {
    return { sessionsByPath: {}, sessionsTotal: 0 };
  },
};

// -----------------------------------------------------------------------------
// Aggregation
// -----------------------------------------------------------------------------

export interface BuildValidationInputOptions {
  db: ServiceDb;
  nicheId: string;
  analytics?: AnalyticsAdapter;
  /** Validation window in days. Default 14. */
  windowDays?: number;
  /** ISO timestamp the window is measured back from. Default now. */
  asOf?: string;
}

interface NicheRow {
  id: string;
  topic: string;
  topicSlug: string;
  validationStartedAt: Date | null;
}

interface TestPageRow {
  id: string;
  fullPath: string;
}

/**
 * Assemble a validated `ValidationInput` for one niche, or null when the niche
 * has no test pages yet.
 */
export async function buildValidationInput(
  opts: BuildValidationInputOptions,
): Promise<ValidationInput | null> {
  const analytics = opts.analytics ?? emptyAnalyticsAdapter;
  const windowDays = opts.windowDays ?? 14;
  const asOf = opts.asOf ?? new Date().toISOString();
  const asOfMs = new Date(asOf).getTime();
  const cutoff = new Date(asOfMs - windowDays * 86_400_000);

  const niche = await loadNiche(opts.db, opts.nicheId);
  if (!niche) throw new Error(`niche not found: ${opts.nicheId}`);

  const testPages = await loadTestPages(opts.db, niche.id);
  if (testPages.length === 0) return null;

  const pageIds = testPages.map((p) => p.id);
  const pagePaths = testPages.map((p) => p.fullPath);

  const [clickRows, conversionRows, signals] = await Promise.all([
    loadClicks(opts.db, pageIds, cutoff),
    loadConversions(opts.db, pageIds, cutoff),
    analytics.fetch({
      nicheId: niche.id,
      topicSlug: niche.topicSlug,
      pagePaths,
      windowDays,
      asOf,
    }),
  ]);

  // Clicks per page + per network.
  const clicksByPage = new Map<string, number>();
  const clicksByNetwork: Record<string, number> = {};
  for (const row of clickRows) {
    if (row.pageId) clicksByPage.set(row.pageId, (clicksByPage.get(row.pageId) ?? 0) + 1);
    clicksByNetwork[row.network] = (clicksByNetwork[row.network] ?? 0) + 1;
  }
  const affiliateClicksTotal = clickRows.length;

  // Conversions: count + revenue (commission, EUR). Only conversions whose
  // status counts as revenue are included — see COUNT_PENDING_AS_REVENUE in
  // @nichefinder/shared (operator decision: pending excluded). Declined are
  // always dropped.
  const countableConversions = conversionRows.filter((c) =>
    conversionCountsAsRevenue(canonicalConversionStatus(c.status)),
  );
  const affiliateConversions = countableConversions.length;
  const affiliateRevenueEur =
    countableConversions.reduce((sum, c) => sum + c.commissionCents, 0) / 100;

  const daysInValidation = niche.validationStartedAt
    ? Math.max(0, Math.floor((asOfMs - niche.validationStartedAt.getTime()) / 86_400_000))
    : 0;

  const input: ValidationInput = {
    niche: {
      topic: niche.topic,
      topic_slug: niche.topicSlug,
      days_in_validation: daysInValidation,
    },
    test_pages: testPages.map((p) => ({
      url: p.fullPath,
      sessions: signals.sessionsByPath[p.fullPath] ?? 0,
      affiliate_clicks: clicksByPage.get(p.id) ?? 0,
      ...(signals.avgTimeOnPageSeconds !== undefined
        ? { avg_time_on_page_seconds: signals.avgTimeOnPageSeconds }
        : {}),
    })),
    metrics: {
      window_days: windowDays,
      paid_traffic_spend_eur: signals.paidTrafficSpendEur ?? 0,
      sessions_total: signals.sessionsTotal,
      ...(signals.bounceRate !== undefined ? { bounce_rate: signals.bounceRate } : {}),
      ...(signals.avgTimeOnPageSeconds !== undefined
        ? { avg_time_on_page_seconds: signals.avgTimeOnPageSeconds }
        : {}),
      affiliate_clicks_total: affiliateClicksTotal,
      affiliate_clicks_by_network: clicksByNetwork,
      affiliate_conversions: affiliateConversions,
      affiliate_revenue_eur: affiliateRevenueEur,
      email_signups: signals.emailSignups ?? 0,
    },
  };

  return input;
}

// -----------------------------------------------------------------------------
// Queries — narrow selects; aggregation happens in JS (windows are small).
// -----------------------------------------------------------------------------

async function loadNiche(db: ServiceDb, nicheId: string): Promise<NicheRow | null> {
  const rows = await db
    .select({
      id: niches.id,
      topic: niches.topic,
      topicSlug: niches.topicSlug,
      validationStartedAt: niches.validationStartedAt,
    })
    .from(niches)
    .where(eq(niches.id, nicheId))
    .limit(1);
  return rows[0] ?? null;
}

async function loadTestPages(db: ServiceDb, nicheId: string): Promise<TestPageRow[]> {
  return db
    .select({ id: pages.id, fullPath: pages.fullPath })
    .from(pages)
    .where(and(eq(pages.nicheId, nicheId), eq(pages.kind, "test_page")));
}

async function loadClicks(
  db: ServiceDb,
  pageIds: string[],
  cutoff: Date,
): Promise<Array<{ pageId: string | null; network: string }>> {
  if (pageIds.length === 0) return [];
  return db
    .select({ pageId: clicks.pageId, network: affiliateLinks.network })
    .from(clicks)
    .innerJoin(affiliateLinks, eq(clicks.affiliateLinkId, affiliateLinks.id))
    .where(
      and(eq(clicks.isBot, false), gte(clicks.occurredAt, cutoff), inArray(clicks.pageId, pageIds)),
    );
}

async function loadConversions(
  db: ServiceDb,
  pageIds: string[],
  cutoff: Date,
): Promise<Array<{ commissionCents: number; status: string }>> {
  if (pageIds.length === 0) return [];
  return db
    .select({ commissionCents: conversions.commissionCents, status: conversions.status })
    .from(conversions)
    .where(and(gte(conversions.occurredAt, cutoff), inArray(conversions.pageId, pageIds)));
}
