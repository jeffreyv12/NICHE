import { describe, expect, it } from "vitest";
import type { LoadedConversion, RunNicheMonthlyMetricsOptions } from "../nicheMonthlyMetrics.js";
import { runNicheMonthlyMetricsJob } from "../nicheMonthlyMetrics.js";

// ---------------------------------------------------------------------------
// Fake db: records the niche select result and captures the upsert payload.
// ---------------------------------------------------------------------------

interface UpsertCapture {
  rows: Array<Record<string, unknown>>;
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
        return { onConflictDoUpdate: () => Promise.resolve(undefined) };
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
    // organic_clicks is never written by this job (preserved for GSC backfill).
    expect(may).not.toHaveProperty("organicClicks");
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
});
