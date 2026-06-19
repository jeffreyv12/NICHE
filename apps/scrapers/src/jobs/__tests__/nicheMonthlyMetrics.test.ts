import { describe, expect, it } from "vitest";
import type { RunNicheMonthlyMetricsOptions } from "../nicheMonthlyMetrics.js";
import { runNicheMonthlyMetricsJob } from "../nicheMonthlyMetrics.js";

// ---------------------------------------------------------------------------
// Mock DB
// Only two DB operations need mocking: selectTargetNiches and the final upsert.
// All three loaders are injected in every test so the real DB queries never run.
// ---------------------------------------------------------------------------

interface TargetNicheRow {
  id: string;
  tenantId: string | null;
}

type InsertedRow = Record<string, unknown>;

function makeMockDb(nicheRows: TargetNicheRow[]) {
  const insertedRows: InsertedRow[] = [];

  // selectTargetNiches calls either:
  //   db.select().from().where()           → Promise<TargetNiche[]>
  //   db.select().from().where().limit(1)  → Promise<TargetNiche[]>
  // Attach .limit() to the Promise so both paths resolve to the same rows.
  const whereResult = Object.assign(Promise.resolve(nicheRows as unknown[]), {
    limit: (_n: number) => Promise.resolve(nicheRows as unknown[]),
  });

  const db = {
    select: (_cols: unknown) => ({
      from: (_t: unknown) => ({
        where: (_cond: unknown) => whereResult,
      }),
    }),
    insert: (_t: unknown) => ({
      values: (rows: InsertedRow[]) => ({
        onConflictDoUpdate: (_opts: unknown) => {
          insertedRows.push(...rows);
          return Promise.resolve();
        },
      }),
    }),
  } as unknown as RunNicheMonthlyMetricsOptions["db"];

  return { db, insertedRows };
}

// ---------------------------------------------------------------------------
// Stub loaders — return empty by default; override per test as needed.
// ---------------------------------------------------------------------------

const NO_CONVERSIONS: RunNicheMonthlyMetricsOptions["loadConversions"] = async () => [];
const NO_PAGE_CLICKS: RunNicheMonthlyMetricsOptions["loadPageClicks"] = async () => [];
const NO_NICHE_PATHS: RunNicheMonthlyMetricsOptions["loadNichePaths"] = async () => [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runNicheMonthlyMetricsJob", () => {
  it("returns niches:0 and skips the upsert when no tracked niches are found", async () => {
    const { db, insertedRows } = makeMockDb([]);
    const result = await runNicheMonthlyMetricsJob({
      db,
      asOf: "2026-06-19T00:00:00.000Z",
      loadConversions: NO_CONVERSIONS,
      loadPageClicks: NO_PAGE_CLICKS,
      loadNichePaths: NO_NICHE_PATHS,
    });
    expect(result.niches).toBe(0);
    expect(result.rowsUpserted).toBe(0);
    expect(insertedRows).toHaveLength(0);
  });

  it("sets organicClicks to null when loadPageClicks returns empty (PRESERVE-ON-NO-DATA)", async () => {
    const { db, insertedRows } = makeMockDb([{ id: "n1", tenantId: "t1" }]);
    await runNicheMonthlyMetricsJob({
      db,
      asOf: "2026-06-19T00:00:00.000Z",
      monthsBack: 2,
      loadConversions: NO_CONVERSIONS,
      loadPageClicks: NO_PAGE_CLICKS,
      loadNichePaths: NO_NICHE_PATHS,
    });
    // NULL (not 0) prevents a false "no organic traffic" from overwriting a real figure.
    expect(insertedRows.every((r) => r.organicClicks === null)).toBe(true);
  });

  it("attributes page-grain clicks to a niche via normalized path match", async () => {
    const { db, insertedRows } = makeMockDb([{ id: "n1", tenantId: "t1" }]);
    await runNicheMonthlyMetricsJob({
      db,
      asOf: "2026-06-19T00:00:00.000Z",
      monthsBack: 1,
      loadConversions: NO_CONVERSIONS,
      loadPageClicks: async () => [
        { tenantId: "t1", pagePath: "/test/koffie/beste-machine", date: "2026-06-01", clicks: 100 },
        { tenantId: "t1", pagePath: "/test/koffie/beste-machine", date: "2026-06-10", clicks: 50 },
      ],
      loadNichePaths: async () => [
        { nicheId: "n1", tenantId: "t1", fullPath: "/test/koffie/beste-machine" },
      ],
    });
    const juneRow = insertedRows.find((r) => r.month === "2026-06-01" && r.nicheId === "n1");
    expect(juneRow?.organicClicks).toBe(150); // 100 + 50 summed across the month
  });

  it("does not credit clicks from tenant A to a niche owned by tenant B (CLAUDE.md #9)", async () => {
    const { db, insertedRows } = makeMockDb([
      { id: "n1", tenantId: "t1" },
      { id: "n2", tenantId: "t2" },
    ]);
    await runNicheMonthlyMetricsJob({
      db,
      asOf: "2026-06-19T00:00:00.000Z",
      monthsBack: 1,
      loadConversions: NO_CONVERSIONS,
      // Same path /foo exists on both tenants; GSC row is from t1 only.
      loadPageClicks: async () => [
        { tenantId: "t1", pagePath: "/foo", date: "2026-06-01", clicks: 200 },
      ],
      loadNichePaths: async () => [
        { nicheId: "n1", tenantId: "t1", fullPath: "/foo" },
        { nicheId: "n2", tenantId: "t2", fullPath: "/foo" },
      ],
    });
    const n1Row = insertedRows.find((r) => r.nicheId === "n1" && r.month === "2026-06-01");
    const n2Row = insertedRows.find((r) => r.nicheId === "n2" && r.month === "2026-06-01");
    expect(n1Row?.organicClicks).toBe(200);
    expect(n2Row?.organicClicks).toBe(null); // t2 had no clicks — must not be 0
  });

  it("rolls up revenue from loadConversions and totals EUR correctly", async () => {
    const { db } = makeMockDb([{ id: "n1", tenantId: "t1" }]);
    const result = await runNicheMonthlyMetricsJob({
      db,
      asOf: "2026-06-19T00:00:00.000Z",
      monthsBack: 1,
      loadConversions: async () => [
        {
          nicheId: "n1",
          tenantId: "t1",
          occurredAt: new Date("2026-06-10"),
          commissionCents: 1500,
          status: "approved",
        },
        {
          nicheId: "n1",
          tenantId: "t1",
          occurredAt: new Date("2026-06-15"),
          commissionCents: 500,
          status: "approved",
        },
      ],
      loadPageClicks: NO_PAGE_CLICKS,
      loadNichePaths: NO_NICHE_PATHS,
    });
    expect(result.totalRevenueEur).toBe(20); // (1500 + 500) cents / 100
  });

  it("respects monthsBack: produces exactly monthsBack rows per niche", async () => {
    const { db, insertedRows } = makeMockDb([{ id: "n1", tenantId: "t1" }]);
    const result = await runNicheMonthlyMetricsJob({
      db,
      asOf: "2026-06-19T00:00:00.000Z",
      monthsBack: 3,
      loadConversions: NO_CONVERSIONS,
      loadPageClicks: NO_PAGE_CLICKS,
      loadNichePaths: NO_NICHE_PATHS,
    });
    expect(result.months).toHaveLength(3);
    expect(insertedRows).toHaveLength(3); // 1 niche × 3 months
  });

  it("strips URL scheme, host, trailing slash, and query string before path matching", async () => {
    const { db, insertedRows } = makeMockDb([{ id: "n1", tenantId: "t1" }]);
    await runNicheMonthlyMetricsJob({
      db,
      asOf: "2026-06-19T00:00:00.000Z",
      monthsBack: 1,
      loadConversions: NO_CONVERSIONS,
      // GSC reports full URL with trailing slash + UTM params
      loadPageClicks: async () => [
        {
          tenantId: "t1",
          pagePath: "https://example.com/test/koffie/beste-machine/?utm=nl",
          date: "2026-06-05",
          clicks: 30,
        },
      ],
      // pages.full_path stores the clean normalized path
      loadNichePaths: async () => [
        { nicheId: "n1", tenantId: "t1", fullPath: "/test/koffie/beste-machine" },
      ],
    });
    const juneRow = insertedRows.find((r) => r.month === "2026-06-01" && r.nicheId === "n1");
    expect(juneRow?.organicClicks).toBe(30);
  });
});
