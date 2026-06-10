import { describe, expect, it } from "vitest";
import {
  type ConversionForRollup,
  lastNMonthKeys,
  monthKeyUTC,
  rollupNicheMonthlyRevenue,
  toRevenueSeries,
} from "../src/nicheMonthlyMetrics";

function conv(over: Partial<ConversionForRollup> = {}): ConversionForRollup {
  return {
    nicheId: "n1",
    occurredAt: "2026-03-15T10:00:00.000Z",
    commissionCents: 1000,
    status: "approved",
    ...over,
  };
}

describe("monthKeyUTC", () => {
  it("buckets any day to the first of its UTC month", () => {
    expect(monthKeyUTC(new Date("2026-03-31T23:59:59.000Z"))).toBe("2026-03-01");
    expect(monthKeyUTC(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01");
  });

  it("uses UTC, not local time, at month boundaries", () => {
    // 2026-03-01T00:30 UTC is still March in UTC regardless of local offset.
    expect(monthKeyUTC(new Date("2026-03-01T00:30:00.000Z"))).toBe("2026-03-01");
  });
});

describe("lastNMonthKeys", () => {
  it("returns n month keys oldest→newest ending at asOf's month", () => {
    expect(lastNMonthKeys(new Date("2026-06-10T00:00:00Z"), 3)).toEqual([
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
    ]);
  });

  it("crosses the year boundary correctly", () => {
    expect(lastNMonthKeys(new Date("2026-01-15T00:00:00Z"), 3)).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
    ]);
  });
});

describe("rollupNicheMonthlyRevenue", () => {
  it("sums countable commission per niche per month, in EUR", () => {
    const out = rollupNicheMonthlyRevenue([
      conv({ commissionCents: 1000 }),
      conv({ commissionCents: 2550 }),
    ]);
    expect(out).toEqual([
      { nicheId: "n1", month: "2026-03-01", revenueEur: 35.5, conversionsCount: 2 },
    ]);
  });

  it("splits buckets by niche and by month", () => {
    const out = rollupNicheMonthlyRevenue([
      conv({ nicheId: "n1", occurredAt: "2026-03-01T00:00:00Z", commissionCents: 500 }),
      conv({ nicheId: "n1", occurredAt: "2026-04-01T00:00:00Z", commissionCents: 700 }),
      conv({ nicheId: "n2", occurredAt: "2026-03-20T00:00:00Z", commissionCents: 900 }),
    ]);
    expect(out).toHaveLength(3);
    expect(out).toContainEqual({
      nicheId: "n1",
      month: "2026-03-01",
      revenueEur: 5,
      conversionsCount: 1,
    });
    expect(out).toContainEqual({
      nicheId: "n2",
      month: "2026-03-01",
      revenueEur: 9,
      conversionsCount: 1,
    });
  });

  it("excludes pending and declined conversions by default (approved-only policy)", () => {
    const out = rollupNicheMonthlyRevenue([
      conv({ status: "approved", commissionCents: 1000 }),
      conv({ status: "pending", commissionCents: 5000 }),
      conv({ status: "refunded", commissionCents: 9999 }),
    ]);
    expect(out).toEqual([
      { nicheId: "n1", month: "2026-03-01", revenueEur: 10, conversionsCount: 1 },
    ]);
  });

  it("can count pending when explicitly opted in", () => {
    const out = rollupNicheMonthlyRevenue([conv({ status: "pending", commissionCents: 1000 })], {
      countPending: true,
    });
    expect(out[0]?.revenueEur).toBe(10);
  });

  it("skips rows with an unparseable date instead of throwing", () => {
    const out = rollupNicheMonthlyRevenue([conv({ occurredAt: "not-a-date" })]);
    expect(out).toEqual([]);
  });

  it("returns an empty array for no input", () => {
    expect(rollupNicheMonthlyRevenue([])).toEqual([]);
  });
});

describe("toRevenueSeries", () => {
  it("maps stored months onto the [m-2, m-1, m-0] tuple", () => {
    const series = toRevenueSeries(
      [
        { month: "2026-04-01", revenueEur: 120 },
        { month: "2026-05-01", revenueEur: 160 },
        { month: "2026-06-01", revenueEur: 200 },
      ],
      new Date("2026-06-10T00:00:00Z"),
    );
    expect(series).toEqual([120, 160, 200]);
  });

  it("treats a missing month as €0 (a gap is a failing month)", () => {
    const series = toRevenueSeries(
      [{ month: "2026-06-01", revenueEur: 200 }],
      new Date("2026-06-10T00:00:00Z"),
    );
    expect(series).toEqual([0, 0, 200]);
  });
});
