import { describe, expect, it } from "vitest";
import type { KillMetricsAdapter } from "../killScan.js";
import { runKillScanJob } from "../killScan.js";

interface InsertedFlag {
  nicheId: string;
  reasons: string[];
  [k: string]: unknown;
}

// Fake db: select() pops a queued result set in await order; insert().returning()
// records the row. Select order here: niches, then one open-flag check per
// flagged niche (healthy niches issue no further query).
function makeFakeDb(selectResults: unknown[][]) {
  let i = 0;
  const inserted: InsertedFlag[] = [];

  function chain(rows: unknown[]) {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.limit = () => Promise.resolve(rows);
    // biome-ignore lint/suspicious/noThenProperty: drizzle PromiseLike shim
    c.then = (resolve: (r: unknown[]) => unknown) => resolve(rows);
    return c;
  }

  const db = {
    select: () => chain(selectResults[i++] ?? []),
    insert: () => ({
      values: (row: InsertedFlag) => ({
        returning: () => {
          inserted.push(row);
          return Promise.resolve([{ id: `flag-${inserted.length}` }]);
        },
      }),
    }),
  };
  return { db: db as unknown as Parameters<typeof runKillScanJob>[0]["db"], inserted };
}

const OLD = new Date("2025-10-01T00:00:00Z"); // ~243d before asOf → mature
const AS_OF = "2026-06-01T00:00:00Z";

function niche(id: string, over: Partial<{ topic: string; topicSlug: string }> = {}) {
  return {
    id,
    topic: over.topic ?? "koffiemolens",
    topicSlug: over.topicSlug ?? "koffiemolens",
    tenantId: "tenant-1",
    createdAt: OLD,
    state: "mature",
  };
}

// Adapter: n1 + n3 starved (→ low revenue + low traffic), n2 healthy.
const adapter: KillMetricsAdapter = {
  async fetch(n) {
    if (n.id === "n2") {
      return {
        trailing30dRevenueEur: 100,
        trailing30dOrganicClicks: 500,
        hasGoogleManualAction: false,
      };
    }
    return { trailing30dRevenueEur: 0, trailing30dOrganicClicks: 0, hasGoogleManualAction: false };
  },
};

describe("runKillScanJob", () => {
  it("flags starved niches, skips healthy, and dedupes against an open flag", async () => {
    const { db, inserted } = makeFakeDb([
      [niche("n1"), niche("n2"), niche("n3")],
      [], // n1 has no open flag → insert
      [{ id: "existing" }], // n3 already has an open flag → skip
    ]);

    const result = await runKillScanJob({ db, metrics: adapter, asOf: AS_OF });

    expect(result.considered).toBe(3);
    expect(result.healthy).toBe(1);
    expect(result.flagged).toBe(1);
    expect(result.skippedExistingOpen).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.nicheId).toBe("n1");
    expect(inserted[0]?.reasons.sort()).toEqual(["low_revenue_month_6", "low_traffic_month_6"]);
  });

  it("flags a kill-list match immediately, ignoring maturity/metrics", async () => {
    const { db, inserted } = makeFakeDb([
      [
        {
          ...niche("n1", { topic: "cbd olie kopen", topicSlug: "cbd-olie" }),
          createdAt: new Date(AS_OF),
        },
      ],
      [],
    ]);
    const healthy: KillMetricsAdapter = {
      async fetch() {
        return {
          trailing30dRevenueEur: 999,
          trailing30dOrganicClicks: 9999,
          hasGoogleManualAction: false,
        };
      },
    };

    const result = await runKillScanJob({ db, metrics: healthy, asOf: AS_OF });
    expect(result.flagged).toBe(1);
    expect(inserted[0]?.reasons).toContain("kill_list_match");
  });

  it("leaves a fully healthy niche unflagged", async () => {
    const { db, inserted } = makeFakeDb([[niche("n2")]]);
    const result = await runKillScanJob({ db, metrics: adapter, asOf: AS_OF });
    expect(result.flagged).toBe(0);
    expect(result.healthy).toBe(1);
    expect(inserted).toHaveLength(0);
  });
});
