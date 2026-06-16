import { describe, expect, it, vi } from "vitest";
import { createDrizzleConversionStore } from "../conversionStore.js";

// ---------------------------------------------------------------------------
// Minimal ServiceDb mock — only the chained query builder methods used by
// createDrizzleConversionStore are needed.
//
// Drizzle query chains can be awaited at different points:
//   select().from().where()               → Promise<rows>  (links query)
//   select().from().where().orderBy().limit() → Promise<rows>  (clicks query)
//   select().from().where().limit()       → Promise<rows>  (existing check)
//
// Each call to where() produces a real Promise (with .orderBy/.limit extras).
// The sequence index is fixed at where()-call time.
// ---------------------------------------------------------------------------

type SelectResult = Record<string, unknown>[];

function makeDb({
  selectSequence = [] as SelectResult[],
  updateImpl = vi.fn(async () => {}),
  insertImpl = vi.fn(async () => {}),
} = {}) {
  const counter = { n: 0 };

  // Returns a real Promise (so `await` works without a `then` property) that
  // also carries `.orderBy().limit()` and `.limit()` for Drizzle chaining.
  // The sequence index is fixed at `.where()` call time, so all derived
  // chains resolve to the same row set.
  function makeQueryResult() {
    const seqIdx = counter.n++;
    const rows = () => selectSequence[seqIdx] ?? [];
    return Object.assign(Promise.resolve(rows()), {
      orderBy: () => ({ limit: () => Promise.resolve(rows()) }),
      limit: () => Promise.resolve(rows()),
    });
  }

  const db = {
    select: () => ({ from: () => ({ where: () => makeQueryResult() }) }),
    update: () => ({ set: () => ({ where: updateImpl }) }),
    insert: () => ({ values: insertImpl }),
  };

  return { db, updateImpl, insertImpl };
}

// ---------------------------------------------------------------------------
// resolveLinks
// ---------------------------------------------------------------------------

describe("resolveLinks", () => {
  it("returns null when no affiliate_links row matches the subid", async () => {
    const { db } = makeDb({ selectSequence: [[]] });
    const store = createDrizzleConversionStore(db as never);
    expect(await store.resolveLinks("bol", "unknown-subid")).toBeNull();
  });

  it("returns the matching link with click resolved", async () => {
    const link = { id: "link-1", tenantId: "tenant-1", network: "bol" };
    const click = { id: "click-1", pageId: "page-1" };

    const { db } = makeDb({ selectSequence: [[link], [click]] });
    const store = createDrizzleConversionStore(db as never);

    const result = await store.resolveLinks("bol", "sub-abc");
    expect(result).toMatchObject({
      tenantId: "tenant-1",
      affiliateLinkId: "link-1",
      clickId: "click-1",
      pageId: "page-1",
    });
  });

  it("returns null clickId and pageId when no clicks exist", async () => {
    const link = { id: "link-1", tenantId: "tenant-1", network: "bol" };

    const { db } = makeDb({ selectSequence: [[link], []] });
    const store = createDrizzleConversionStore(db as never);

    const result = await store.resolveLinks("bol", "sub-abc");
    expect(result?.clickId).toBeNull();
    expect(result?.pageId).toBeNull();
  });

  it("falls back to first link when requested network is not in the set", async () => {
    const bolLink = { id: "link-bol", tenantId: "tenant-1", network: "bol" };
    const awinLink = { id: "link-awin", tenantId: "tenant-1", network: "awin" };

    // Links present: bol + awin. Requesting "daisycon" → falls back to bolLink (first).
    const { db } = makeDb({ selectSequence: [[bolLink, awinLink], []] });
    const store = createDrizzleConversionStore(db as never);

    const result = await store.resolveLinks("daisycon", "sub-abc");
    expect(result?.affiliateLinkId).toBe("link-bol");
  });

  it("returns the network-specific link when it exists in the set", async () => {
    const bolLink = { id: "link-bol", tenantId: "tenant-1", network: "bol" };
    const awinLink = { id: "link-awin", tenantId: "tenant-1", network: "awin" };

    const { db } = makeDb({ selectSequence: [[bolLink, awinLink], []] });
    const store = createDrizzleConversionStore(db as never);

    const result = await store.resolveLinks("awin", "sub-abc");
    expect(result?.affiliateLinkId).toBe("link-awin");
  });
});

// ---------------------------------------------------------------------------
// upsertConversion
// ---------------------------------------------------------------------------

const BASE_ROW = {
  tenantId: "tenant-1",
  network: "bol" as const,
  networkTransactionId: "txn-001",
  affiliateLinkId: "link-1",
  clickId: "click-1",
  pageId: "page-1",
  productExternalId: "prod-42",
  amountCents: 1999,
  commissionCents: 160,
  currency: "EUR",
  occurredAt: "2026-06-01T10:00:00.000Z",
  status: "pending" as const,
  raw: {},
};

describe("upsertConversion", () => {
  it("inserts a new row when no existing conversion matches", async () => {
    // First select (existing check) returns empty → insert path.
    const { db, insertImpl } = makeDb({ selectSequence: [[]] });
    const store = createDrizzleConversionStore(db as never);

    const result = await store.upsertConversion(BASE_ROW);
    expect(result.action).toBe("inserted");
    expect(insertImpl).toHaveBeenCalledTimes(1);
  });

  it("updates an existing row when networkTransactionId matches", async () => {
    // First select returns an existing row.
    const { db, updateImpl } = makeDb({
      selectSequence: [[{ id: "conv-existing" }]],
    });
    const store = createDrizzleConversionStore(db as never);

    const result = await store.upsertConversion(BASE_ROW);
    expect(result.action).toBe("updated");
    expect(updateImpl).toHaveBeenCalledTimes(1);
  });

  it("does not call insert when update path is taken", async () => {
    const { db, insertImpl } = makeDb({
      selectSequence: [[{ id: "conv-existing" }]],
    });
    const store = createDrizzleConversionStore(db as never);
    await store.upsertConversion(BASE_ROW);
    expect(insertImpl).not.toHaveBeenCalled();
  });

  it("does not call update when insert path is taken", async () => {
    const { db, updateImpl } = makeDb({ selectSequence: [[]] });
    const store = createDrizzleConversionStore(db as never);
    await store.upsertConversion(BASE_ROW);
    expect(updateImpl).not.toHaveBeenCalled();
  });
});
