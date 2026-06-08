import { describe, expect, it, vi } from "vitest";
import { runBolFeedSyncJob } from "../bolFeedSync.js";
import type { RunBolFeedSyncOptions } from "../bolFeedSync.js";

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

interface ProductRow {
  id: string;
  ean: string | null;
  tenantId: string;
}

function makeMockDb(rows: ProductRow[]) {
  const updatedRows: Record<string, unknown>[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    }),
    update: () => ({
      set: (data: Record<string, unknown>) => ({
        where: () => {
          updatedRows.push(data);
          return Promise.resolve();
        },
      }),
    }),
  } as unknown as RunBolFeedSyncOptions["db"];
  return { db, updatedRows };
}

// ---------------------------------------------------------------------------
// Mock BolClient
// ---------------------------------------------------------------------------

type SearchResult = {
  ean: string;
  title?: string;
  offerData?: { fromPrice?: number };
  categories?: Array<{ name?: string }>;
};

function makeBolClient(
  searchResults: Map<string, SearchResult[]>,
): RunBolFeedSyncOptions["bolClient"] {
  return {
    request: vi.fn(),
    // The job calls searchCatalog which internally calls client.request.
    // We override at the module level instead — see vi.mock below.
  } as unknown as RunBolFeedSyncOptions["bolClient"];
}

// ---------------------------------------------------------------------------
// Mock searchCatalog at module level
// ---------------------------------------------------------------------------

vi.mock("../../sources/bol/catalog.js", () => ({
  searchCatalog: vi.fn(),
}));

import { searchCatalog } from "../../sources/bol/catalog.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runBolFeedSyncJob", () => {
  it("skips products with null EAN", async () => {
    const { db, updatedRows } = makeMockDb([{ id: "p1", ean: null, tenantId: "t1" }]);
    const mockSearch = vi.mocked(searchCatalog);
    mockSearch.mockResolvedValue({ products: [] });

    const result = await runBolFeedSyncJob({
      db,
      bolClient: {} as RunBolFeedSyncOptions["bolClient"],
      batchDelayMs: 0,
    });

    expect(result.productsScanned).toBe(1);
    expect(updatedRows).toHaveLength(0);
  });

  it("updates product when exact EAN match is found in search results", async () => {
    const { db, updatedRows } = makeMockDb([{ id: "p1", ean: "8718526123456", tenantId: "t1" }]);
    const mockSearch = vi.mocked(searchCatalog);
    mockSearch.mockResolvedValue({
      products: [
        {
          ean: "8718526123456",
          title: "Beste Wandelschoenen XL",
          offerData: { fromPrice: 89.99 },
          categories: [{ id: "1", name: "Wandelschoenen" }],
        },
      ],
    });

    const result = await runBolFeedSyncJob({
      db,
      bolClient: {} as RunBolFeedSyncOptions["bolClient"],
      batchDelayMs: 0,
    });

    expect(result.updated).toBe(1);
    expect(result.notFound).toBe(0);
    expect(updatedRows[0]).toMatchObject({
      name: "Beste Wandelschoenen XL",
      priceCents: 8999,
      category: "Wandelschoenen",
    });
  });

  it("records notFound when EAN has no match in search results", async () => {
    const { db } = makeMockDb([{ id: "p1", ean: "0000000000000", tenantId: "t1" }]);
    vi.mocked(searchCatalog).mockResolvedValue({ products: [] });

    const result = await runBolFeedSyncJob({
      db,
      bolClient: {} as RunBolFeedSyncOptions["bolClient"],
      batchDelayMs: 0,
    });

    expect(result.notFound).toBe(1);
    expect(result.updated).toBe(0);
  });

  it("records error and continues when searchCatalog throws", async () => {
    const { db } = makeMockDb([
      { id: "p1", ean: "111", tenantId: "t1" },
      { id: "p2", ean: "222", tenantId: "t1" },
    ]);
    vi.mocked(searchCatalog)
      .mockRejectedValueOnce(new Error("Bol API 503"))
      .mockResolvedValueOnce({ products: [{ ean: "222", title: "Product B" }] });

    const result = await runBolFeedSyncJob({
      db,
      bolClient: {} as RunBolFeedSyncOptions["bolClient"],
      batchDelayMs: 0,
    });

    expect(result.errors).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.items[0]?.status).toBe("error");
    expect(result.items[1]?.status).toBe("updated");
  });

  it("caps to maxProducts", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      ean: `EAN${i}`,
      tenantId: "t1",
    }));
    const { db } = makeMockDb(rows);
    vi.mocked(searchCatalog).mockResolvedValue({ products: [] });

    const result = await runBolFeedSyncJob({
      db,
      bolClient: {} as RunBolFeedSyncOptions["bolClient"],
      batchDelayMs: 0,
      maxProducts: 5,
    });

    expect(result.productsScanned).toBe(5);
  });
});
