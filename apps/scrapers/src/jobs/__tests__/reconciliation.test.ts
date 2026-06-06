import * as shared from "@nichefinder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ReportingAdapter,
  normalizeAwinTransaction,
  normalizeBolTransaction,
  normalizeDaisyconTransaction,
  runReconciliationJob,
} from "../reconciliation.js";

// Real normalizers (and moneyToCents/toIso) are exercised directly; only the
// ingestion sink is mocked so the job's fetch → ingest → tally loop is the
// unit under test.
vi.mock("@nichefinder/shared", async () => {
  const actual = await vi.importActual<typeof import("@nichefinder/shared")>("@nichefinder/shared");
  return { ...actual, ingestConversion: vi.fn() };
});

const mockedIngest = vi.mocked(shared.ingestConversion);
const fakeDb = {} as Parameters<typeof runReconciliationJob>[0]["db"];

beforeEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------
// Normalizers
// -----------------------------------------------------------------------------

describe("normalizeBolTransaction", () => {
  it("maps commission to cents and orderDate to ISO; amount unknown → 0", () => {
    const n = normalizeBolTransaction({
      id: 991,
      subId: "t:p:c",
      commission: 2.5,
      orderDate: "2026-06-01",
      status: "open",
      productEan: "8712345678901",
    });
    expect(n).toMatchObject({
      networkTransactionId: "991",
      subid: "t:p:c",
      amountCents: 0,
      commissionCents: 250,
      rawStatus: "open",
      productExternalId: "8712345678901",
    });
    expect(n.occurredAt).toBe("2026-06-01T00:00:00.000Z");
  });
});

describe("normalizeAwinTransaction", () => {
  it("reads subid from clickRefs.clickRef and nested sale/commission amounts", () => {
    const n = normalizeAwinTransaction({
      id: "AW-1",
      saleAmount: { amount: 49.99, currency: "EUR" },
      commissionAmount: { amount: 5 },
      commissionStatus: "approved",
      transactionDate: "2026-05-20T10:00:00Z",
      clickRefs: { clickRef: "expertgids:airfryer:organic" },
    });
    expect(n).toMatchObject({
      networkTransactionId: "AW-1",
      subid: "expertgids:airfryer:organic",
      amountCents: 4999,
      commissionCents: 500,
      currency: "EUR",
      rawStatus: "approved",
    });
  });

  it("yields a null subid when clickRef is absent", () => {
    const n = normalizeAwinTransaction({ id: "AW-2" });
    expect(n.subid).toBeNull();
    expect(n.amountCents).toBe(0);
  });
});

describe("normalizeDaisyconTransaction", () => {
  it("maps snake_case revenue/commission and sale_date", () => {
    const n = normalizeDaisyconTransaction({
      id: 5,
      sub_id: "t:p:c",
      revenue_total: 30,
      commission_total: 3,
      status: "approved",
      sale_date: "2026-05-19",
    });
    expect(n).toMatchObject({
      networkTransactionId: "5",
      subid: "t:p:c",
      amountCents: 3000,
      commissionCents: 300,
      rawStatus: "approved",
    });
  });
});

// -----------------------------------------------------------------------------
// Job
// -----------------------------------------------------------------------------

function adapterReturning(
  byNetwork: Partial<Record<string, shared.NormalizedConversion[]>>,
): ReportingAdapter {
  return {
    fetchTransactions: vi.fn(async (network) => byNetwork[network] ?? []),
  };
}

function txn(id: string): shared.NormalizedConversion {
  return {
    networkTransactionId: id,
    subid: "t:p:c",
    amountCents: 1000,
    commissionCents: 100,
    currency: "EUR",
    occurredAt: "2026-06-01T00:00:00.000Z",
    rawStatus: "approved",
    raw: {},
  };
}

describe("runReconciliationJob", () => {
  it("tallies inserted / updated / unlinked per network", async () => {
    const adapter = adapterReturning({ bol: [txn("b1"), txn("b2"), txn("b3")] });
    mockedIngest
      .mockResolvedValueOnce({ status: "stored", action: "inserted", pageId: "p" })
      .mockResolvedValueOnce({ status: "stored", action: "updated", pageId: "p" })
      .mockResolvedValueOnce({ status: "unlinked", reason: "unknown_subid" });

    const result = await runReconciliationJob({
      db: fakeDb,
      adapter,
      networks: ["bol"],
      asOf: "2026-06-05T00:00:00.000Z",
    });

    expect(result.byNetwork.bol).toEqual({ fetched: 3, inserted: 1, updated: 1, unlinked: 1 });
    expect(result.failures).toEqual([]);
  });

  it("computes the reporting window from asOf + windowDays", async () => {
    const adapter = adapterReturning({});
    await runReconciliationJob({
      db: fakeDb,
      adapter,
      networks: ["awin"],
      windowDays: 3,
      asOf: "2026-06-05T12:00:00.000Z",
    });
    expect(adapter.fetchTransactions).toHaveBeenCalledWith("awin", {
      startDate: "2026-06-02",
      endDate: "2026-06-05",
    });
  });

  it("isolates a per-network failure without aborting the batch", async () => {
    const adapter: ReportingAdapter = {
      fetchTransactions: vi.fn(async (network) => {
        if (network === "bol") throw new Error("bol 500");
        return [txn("a1")];
      }),
    };
    mockedIngest.mockResolvedValue({ status: "stored", action: "inserted", pageId: "p" });

    const result = await runReconciliationJob({
      db: fakeDb,
      adapter,
      networks: ["bol", "awin"],
      asOf: "2026-06-05T00:00:00.000Z",
    });

    expect(result.failures).toEqual([{ network: "bol", error: "bol 500" }]);
    expect(result.byNetwork.bol).toEqual({ fetched: 0, inserted: 0, updated: 0, unlinked: 0 });
    expect(result.byNetwork.awin).toEqual({ fetched: 1, inserted: 1, updated: 0, unlinked: 0 });
  });
});
