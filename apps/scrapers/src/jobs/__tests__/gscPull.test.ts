import { describe, expect, it, vi } from "vitest";
import type { GscQueryRequest, GscQueryResponse } from "../../sources/gsc/types.js";
import { runGscPullJob } from "../gscPull.js";
import type { RunGscPullJobOptions } from "../gscPull.js";

// ---------------------------------------------------------------------------
// Minimal stub service account (never actually signed in these tests).
// ---------------------------------------------------------------------------

const STUB_ACCOUNT: RunGscPullJobOptions["serviceAccount"] = {
  type: "service_account",
  project_id: "test",
  private_key_id: "k1",
  private_key: "-----BEGIN RSA PRIVATE KEY-----\nNOT_USED\n-----END RSA PRIVATE KEY-----",
  client_email: "test@test.iam.gserviceaccount.com",
  token_uri: "https://oauth2.googleapis.com/token",
};

// ---------------------------------------------------------------------------
// Mock GscClient (injectable via opts.gscClient)
// ---------------------------------------------------------------------------

type MockGscCall = { siteUrl: string; request: GscQueryRequest; response: GscQueryResponse };

function makeGscClient(calls: MockGscCall[]): RunGscPullJobOptions["gscClient"] {
  return {
    querySearchAnalytics: vi.fn(async (siteUrl: string, req: GscQueryRequest) => {
      const match = calls.find(
        (c) =>
          c.siteUrl === siteUrl &&
          JSON.stringify(c.request.dimensions ?? ["date"]) ===
            JSON.stringify(req.dimensions ?? ["date"]),
      );
      if (!match) return { rows: [] };
      return match.response;
    }),
  };
}

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

type InsertedRow = Record<string, unknown>;

function makeMockDb(tenantRows: unknown[]) {
  const insertedRows: InsertedRow[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(tenantRows),
      }),
    }),
    insert: () => ({
      values: (row: InsertedRow) => ({
        onConflictDoUpdate: (_opts: unknown) => {
          insertedRows.push(row);
          return Promise.resolve();
        },
      }),
    }),
  } as unknown as RunGscPullJobOptions["db"];
  return { db, insertedRows };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runGscPullJob", () => {
  it("skips tenants without gscSiteUrl in config", async () => {
    const { db, insertedRows } = makeMockDb([
      { id: "t1", slug: "no-gsc", isActive: true, config: {} },
    ]);
    const result = await runGscPullJob({
      db,
      serviceAccount: STUB_ACCOUNT,
      gscClient: makeGscClient([]),
    });
    expect(result.tenantsSkipped).toBe(1);
    expect(result.tenantsProcessed).toBe(0);
    expect(insertedRows).toHaveLength(0);
  });

  it("writes one row per date returned by GSC", async () => {
    const { db, insertedRows } = makeMockDb([
      {
        id: "t1",
        slug: "test",
        isActive: true,
        config: { gscSiteUrl: "sc-domain:example.com" },
      },
    ]);

    const gscClient = makeGscClient([
      {
        siteUrl: "sc-domain:example.com",
        request: { startDate: "", endDate: "", dimensions: ["date"] },
        response: {
          rows: [
            { keys: ["2026-06-01"], clicks: 120, impressions: 1800, ctr: 0.067, position: 4.2 },
            { keys: ["2026-06-02"], clicks: 95, impressions: 1500, ctr: 0.063, position: 4.5 },
          ],
        },
      },
      {
        siteUrl: "sc-domain:example.com",
        request: { startDate: "", endDate: "", dimensions: ["date", "query"] },
        response: { rows: [] },
      },
    ]);

    const result = await runGscPullJob({ db, serviceAccount: STUB_ACCOUNT, gscClient });
    expect(result.tenantsProcessed).toBe(1);
    expect(result.datesWritten).toBe(2);
    expect(insertedRows).toHaveLength(2);
  });

  it("classifies branded vs non-brand long-tail clicks", async () => {
    const { db, insertedRows } = makeMockDb([
      {
        id: "t1",
        slug: "test",
        isActive: true,
        config: { gscSiteUrl: "sc-domain:example.com", brandKeywords: ["myBrand"] },
      },
    ]);

    const gscClient = makeGscClient([
      {
        siteUrl: "sc-domain:example.com",
        request: { startDate: "", endDate: "", dimensions: ["date"] },
        response: {
          rows: [
            { keys: ["2026-06-01"], clicks: 200, impressions: 3000, ctr: 0.066, position: 5.0 },
          ],
        },
      },
      {
        siteUrl: "sc-domain:example.com",
        request: { startDate: "", endDate: "", dimensions: ["date", "query"] },
        response: {
          rows: [
            // branded: contains "mybrand"
            {
              keys: ["2026-06-01", "mybrand wandelschoenen"],
              clicks: 50,
              impressions: 500,
              ctr: 0.1,
              position: 1.5,
            },
            // non-brand long-tail (≥3 words, no brand)
            {
              keys: ["2026-06-01", "beste wandelschoenen hardlopen"],
              clicks: 30,
              impressions: 400,
              ctr: 0.075,
              position: 6.0,
            },
            // non-brand short-tail (1 word — not long-tail)
            {
              keys: ["2026-06-01", "wandelschoenen"],
              clicks: 20,
              impressions: 300,
              ctr: 0.066,
              position: 8.0,
            },
          ],
        },
      },
    ]);

    await runGscPullJob({ db, serviceAccount: STUB_ACCOUNT, gscClient });

    const row = insertedRows[0];
    expect(row?.brandedClicks).toBe(50);
    expect(row?.nonBrandLongTailClicks).toBe(30);
  });

  it("records an error per failing tenant but processes the rest", async () => {
    const { db } = makeMockDb([
      {
        id: "t1",
        slug: "bad-tenant",
        isActive: true,
        config: { gscSiteUrl: "sc-domain:bad.com" },
      },
      {
        id: "t2",
        slug: "ok-tenant",
        isActive: true,
        config: { gscSiteUrl: "sc-domain:ok.com" },
      },
    ]);

    const gscClient = {
      querySearchAnalytics: vi.fn(async (siteUrl: string) => {
        if (siteUrl === "sc-domain:bad.com") throw new Error("403 Forbidden");
        return { rows: [] };
      }),
    };

    const result = await runGscPullJob({ db, serviceAccount: STUB_ACCOUNT, gscClient });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("bad-tenant");
    expect(result.tenantsProcessed).toBe(1);
  });

  it("returns zero datesWritten when GSC returns no rows", async () => {
    const { db } = makeMockDb([
      {
        id: "t1",
        slug: "empty",
        isActive: true,
        config: { gscSiteUrl: "sc-domain:empty.com" },
      },
    ]);

    const gscClient = makeGscClient([]);
    const result = await runGscPullJob({ db, serviceAccount: STUB_ACCOUNT, gscClient });
    expect(result.datesWritten).toBe(0);
    expect(result.tenantsProcessed).toBe(1);
  });
});
