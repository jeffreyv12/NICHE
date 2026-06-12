import type { PageClicksRow } from "@nichefinder/shared";
import { describe, expect, it } from "vitest";
import type {
  LoadedConversion,
  NichePathRow,
  RunNicheMonthlyMetricsOptions,
} from "../nicheMonthlyMetrics.js";
import { runNicheMonthlyMetricsJob } from "../nicheMonthlyMetrics.js";

// ---------------------------------------------------------------------------
// Fake db: records the niche select result and captures the upsert payload
// (both the inserted rows and the ON CONFLICT ... SET clause).
// ---------------------------------------------------------------------------

interface UpsertCapture {
  rows: Array<Record<string, unknown>>;
  conflict?: { target: unknown; set: Record<string, unknown> };
}

function makeDb(
  targetNiches: Array<{ id: string; tenantId: string | null }>,
  capture: UpsertCapture,
) {
  // `where()` returns a real Promise (so `.from().where()` is awaitable) with a
  // `.limit()` method attached for the nicheId path `.from().where().limit()`.
  const where = () => {
    const p = Promise.resolve(targetNiches) as Promise<typeof targetNiches> & {
      limit: () => Promise<typeof targetNiches>;
    };
    p.limit = () => Promise.resolve(targetNiches);
    return p;
  };

  return {
    select: () => ({ from: () => ({ where }) }),
    insert: () => ({
      values: (rows: Array<Record<string, unknown>>) => {
        capture.rows = rows;
        return {
          onConflictDoUpdate: (cfg: { target: unknown; set: Record<string, unknown> }) => {
            capture.conflict = cfg;
            return Promise.resolve(undefined);
          },
        };
      },
    }),
  } as unknown as RunNicheMonthlyMetricsOptions["db"];
}

function opts(over: Partial<RunNicheMonthlyMetricsOptions> = {}): RunNicheMonthlyMetricsOptions {
  return {
    db: makeDb([{ id: "n1", tenantId: "t1" }], { rows: [] }),
    asOf: "2026-06-10T04:00:00.000Z",
    monthsBack: 3,
    loadConversions: async () => [],
    loadPageClicks: async () => [],
    loadNichePaths: async () => [],
    ...over,
  };
}

describe("runNicheMonthlyMetricsJob", () => {
  it("returns early with no rows when there are no tracked niches", async () => {
    const capture: UpsertCapture = { rows: [] };
    const result = await runNicheMonthlyMetricsJob(opts({ db: makeDb([], capture) }));
    expect(result).toEqual({
      niches: 0,
      months: ["2026-04-01", "2026-05-01", "2026-06-01"],
      rowsUpserted: 0,
      totalRevenueEur: 0,
    });
    expect(capture.rows).toEqual([]);
  });

  it("writes a full niche × month grid, zero-filling months with no revenue", async () => {
    const capture: UpsertCapture = { rows: [] };
    const conversions: LoadedConversion[] = [
      {
        nicheId: "n1",
        tenantId: "t1",
        occurredAt: "2026-05-15T12:00:00.000Z",
        commissionCents: 12000, // €120, approved
        status: "approved",
      },
    ];
    const result = await runNicheMonthlyMetricsJob(
      opts({
        db: makeDb([{ id: "n1", tenantId: "t1" }], capture),
        loadConversions: async () => conversions,
      }),
    );

    expect(result.niches).toBe(1);
    expect(result.rowsUpserted).toBe(3); // 1 niche × 3 months
    expect(result.totalRevenueEur).toBe(120);

    // May carries the revenue; April + June are zero-filled.
    const may = capture.rows.find((r) => r.month === "2026-05-01");
    const apr = capture.rows.find((r) => r.month === "2026-04-01");
    expect(may).toMatchObject({ nicheId: "n1", revenueEur: "120.00", conversionsCount: 1 });
    expect(apr).toMatchObject({ nicheId: "n1", revenueEur: "0.00", conversionsCount: 0 });
    // No GSC page rows → organic_clicks inserted as NULL so the coalesce SET
    // preserves any prior value ("unknown" ≠ "0").
    expect(may).toHaveProperty("organicClicks", null);
    expect(apr).toHaveProperty("organicClicks", null);
  });

  it("excludes pending/declined conversions from the monthly revenue", async () => {
    const capture: UpsertCapture = { rows: [] };
    const conversions: LoadedConversion[] = [
      {
        nicheId: "n1",
        tenantId: "t1",
        occurredAt: "2026-06-02T00:00:00Z",
        commissionCents: 5000,
        status: "approved",
      },
      {
        nicheId: "n1",
        tenantId: "t1",
        occurredAt: "2026-06-03T00:00:00Z",
        commissionCents: 9000,
        status: "pending",
      },
      {
        nicheId: "n1",
        tenantId: "t1",
        occurredAt: "2026-06-04T00:00:00Z",
        commissionCents: 7000,
        status: "refunded",
      },
    ];
    const result = await runNicheMonthlyMetricsJob(
      opts({
        db: makeDb([{ id: "n1", tenantId: "t1" }], capture),
        loadConversions: async () => conversions,
      }),
    );
    expect(result.totalRevenueEur).toBe(50);
    const jun = capture.rows.find((r) => r.month === "2026-06-01");
    expect(jun).toMatchObject({ revenueEur: "50.00", conversionsCount: 1 });
  });

  it("scopes loadConversions to a single niche when nicheId is given", async () => {
    const capture: UpsertCapture = { rows: [] };
    let passedNicheId: string | undefined = "unset";
    await runNicheMonthlyMetricsJob(
      opts({
        db: makeDb([{ id: "n9", tenantId: "t1" }], capture),
        nicheId: "n9",
        loadConversions: async (_db, _since, nicheId) => {
          passedNicheId = nicheId;
          return [];
        },
      }),
    );
    expect(passedNicheId).toBe("n9");
  });

  // -------------------------------------------------------------------------
  // organic_clicks backfill (migration 0010 — GSC page-dimension attribution)
  // -------------------------------------------------------------------------

  it("attributes organic clicks to the niche owning the page path, by month", async () => {
    const capture: UpsertCapture = { rows: [] };
    const nichePaths: NichePathRow[] = [
      { nicheId: "n1", tenantId: "t1", fullPath: "/koffie/beste-machine" },
    ];
    const pageClicks: PageClicksRow[] = [
      // Two GSC URL variants of the same page collapse onto one path.
      {
        tenantId: "t1",
        pagePath: "https://site.nl/koffie/beste-machine/",
        date: "2026-05-10",
        clicks: 30,
      },
      { tenantId: "t1", pagePath: "/koffie/beste-machine?utm=x", date: "2026-05-20", clicks: 12 },
      { tenantId: "t1", pagePath: "/koffie/beste-machine", date: "2026-06-01", clicks: 7 },
    ];
    await runNicheMonthlyMetricsJob(
      opts({
        db: makeDb([{ id: "n1", tenantId: "t1" }], capture),
        loadNichePaths: async () => nichePaths,
        loadPageClicks: async () => pageClicks,
      }),
    );

    const may = capture.rows.find((r) => r.month === "2026-05-01");
    const jun = capture.rows.find((r) => r.month === "2026-06-01");
    expect(may).toHaveProperty("organicClicks", 42); // 30 + 12
    expect(jun).toHaveProperty("organicClicks", 7);
  });

  it("is tenant-scoped: clicks on an identical path under another tenant are not credited", async () => {
    const capture: UpsertCapture = { rows: [] };
    await runNicheMonthlyMetricsJob(
      opts({
        db: makeDb([{ id: "n1", tenantId: "t1" }], capture),
        loadNichePaths: async () => [{ nicheId: "n1", tenantId: "t1", fullPath: "/" }],
        // Same "/" path, but tenant t2 — must NOT credit n1 (CLAUDE.md #9).
        loadPageClicks: async () => [
          { tenantId: "t2", pagePath: "/", date: "2026-05-05", clicks: 99 },
        ],
      }),
    );
    const may = capture.rows.find((r) => r.month === "2026-05-01");
    expect(may).toHaveProperty("organicClicks", null);
  });

  it("drops clicks on a path that maps to no niche page", async () => {
    const capture: UpsertCapture = { rows: [] };
    await runNicheMonthlyMetricsJob(
      opts({
        db: makeDb([{ id: "n1", tenantId: "t1" }], capture),
        loadNichePaths: async () => [{ nicheId: "n1", tenantId: "t1", fullPath: "/koffie" }],
        loadPageClicks: async () => [
          { tenantId: "t1", pagePath: "/onbekend", date: "2026-05-05", clicks: 50 },
        ],
      }),
    );
    const may = capture.rows.find((r) => r.month === "2026-05-01");
    expect(may).toHaveProperty("organicClicks", null);
  });

  it("preserves prior organic_clicks via a coalesce conflict SET", async () => {
    const capture: UpsertCapture = { rows: [] };
    await runNicheMonthlyMetricsJob(opts({ db: makeDb([{ id: "n1", tenantId: "t1" }], capture) }));
    // The SET must coalesce so a NULL insert keeps the existing stored value.
    expect(capture.conflict?.set).toHaveProperty("organicClicks");
  });
});
