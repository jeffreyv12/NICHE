import { describe, expect, it } from "vitest";
import {
  type AnalyticsAdapter,
  buildValidationInput,
  emptyAnalyticsAdapter,
} from "../validationMetrics.js";

// -----------------------------------------------------------------------------
// Fake db: a single thenable chain that yields queued result-sets in await
// order. Query order in buildValidationInput is deterministic:
//   [0] niche, [1] test pages, [2] clicks, [3] conversions
// -----------------------------------------------------------------------------

function makeFakeDb(results: unknown[][]) {
  let i = 0;
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => chain,
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable test double
    then: (resolve: (rows: unknown[]) => void) => resolve(results[i++] ?? []),
  };
  return { select: () => chain } as unknown as Parameters<typeof buildValidationInput>[0]["db"];
}

const NICHE = {
  id: "n1",
  topic: "Aeropress draagbaar",
  topicSlug: "aeropress-draagbaar",
  validationStartedAt: new Date("2026-05-01T00:00:00Z"),
};

describe("buildValidationInput", () => {
  it("returns null when the niche has no test pages", async () => {
    const db = makeFakeDb([[NICHE], /* test pages */ []]);
    const input = await buildValidationInput({ db, nicheId: "n1" });
    expect(input).toBeNull();
  });

  it("throws when the niche does not exist", async () => {
    const db = makeFakeDb([[]]);
    await expect(buildValidationInput({ db, nicheId: "missing" })).rejects.toThrow(
      /niche not found/,
    );
  });

  it("aggregates clicks per page + per network and conversion revenue", async () => {
    const testPages = [
      { id: "p1", fullPath: "/test/aeropress-draagbaar/review" },
      { id: "p2", fullPath: "/test/aeropress-draagbaar/vergelijking" },
    ];
    const clicks = [
      { pageId: "p1", network: "bol" },
      { pageId: "p1", network: "bol" },
      { pageId: "p2", network: "awin" },
    ];
    const conversions = [
      { commissionCents: 450, status: "approved" },
      { commissionCents: 1200, status: "confirmed" },
    ];
    const db = makeFakeDb([[NICHE], testPages, clicks, conversions]);

    const input = await buildValidationInput({
      db,
      nicheId: "n1",
      windowDays: 14,
      asOf: "2026-05-15T00:00:00Z",
    });

    expect(input).not.toBeNull();
    if (!input) return;

    expect(input.niche.days_in_validation).toBe(14);
    expect(input.test_pages).toHaveLength(2);
    expect(input.test_pages[0]).toMatchObject({ url: testPages[0]?.fullPath, affiliate_clicks: 2 });
    expect(input.test_pages[1]).toMatchObject({ url: testPages[1]?.fullPath, affiliate_clicks: 1 });

    expect(input.metrics.affiliate_clicks_total).toBe(3);
    expect(input.metrics.affiliate_clicks_by_network).toEqual({ bol: 2, awin: 1 });
    expect(input.metrics.affiliate_conversions).toBe(2);
    expect(input.metrics.affiliate_revenue_eur).toBeCloseTo(16.5, 5);
    // No analytics adapter → sessions zero.
    expect(input.metrics.sessions_total).toBe(0);
  });

  it("excludes pending and declined conversions from revenue (COUNT_PENDING_AS_REVENUE=false)", async () => {
    const testPages = [{ id: "p1", fullPath: "/test/x/review" }];
    const conversions = [
      { commissionCents: 450, status: "approved" },
      { commissionCents: 1200, status: "pending" },
      { commissionCents: 999, status: "disapproved" },
    ];
    const db = makeFakeDb([[NICHE], testPages, /* clicks */ [], conversions]);

    const input = await buildValidationInput({ db, nicheId: "n1", asOf: "2026-05-15T00:00:00Z" });
    expect(input).not.toBeNull();
    if (!input) return;

    // Only the approved conversion counts.
    expect(input.metrics.affiliate_conversions).toBe(1);
    expect(input.metrics.affiliate_revenue_eur).toBeCloseTo(4.5, 5);
  });

  it("uses the analytics adapter for sessions / bounce / time", async () => {
    const testPages = [{ id: "p1", fullPath: "/test/x/review" }];
    const db = makeFakeDb([[NICHE], testPages, /* clicks */ [], /* conversions */ []]);

    const analytics: AnalyticsAdapter = {
      async fetch() {
        return {
          sessionsByPath: { "/test/x/review": 180 },
          sessionsTotal: 180,
          bounceRate: 0.62,
          avgTimeOnPageSeconds: 35,
          paidTrafficSpendEur: 12.5,
          emailSignups: 3,
        };
      },
    };

    const input = await buildValidationInput({ db, nicheId: "n1", analytics });
    expect(input).not.toBeNull();
    if (!input) return;

    expect(input.test_pages[0]?.sessions).toBe(180);
    expect(input.metrics.sessions_total).toBe(180);
    expect(input.metrics.bounce_rate).toBe(0.62);
    expect(input.metrics.avg_time_on_page_seconds).toBe(35);
    expect(input.metrics.paid_traffic_spend_eur).toBe(12.5);
    expect(input.metrics.email_signups).toBe(3);
  });

  it("emptyAnalyticsAdapter yields zero sessions", async () => {
    const signals = await emptyAnalyticsAdapter.fetch({
      nicheId: "n1",
      topicSlug: "x",
      pagePaths: [],
      windowDays: 14,
      asOf: "2026-05-15T00:00:00Z",
    });
    expect(signals.sessionsTotal).toBe(0);
    expect(signals.sessionsByPath).toEqual({});
  });
});
