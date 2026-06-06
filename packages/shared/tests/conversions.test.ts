import { describe, expect, it } from "vitest";
import type { AffiliateNetwork } from "../src/constants";
import {
  type ConversionLinks,
  type ConversionStore,
  type ConversionUpsert,
  type NormalizedConversion,
  ingestConversion,
  moneyToCents,
  parsePostback,
  toIso,
} from "../src/conversions";

// -----------------------------------------------------------------------------
// money + date coercion
// -----------------------------------------------------------------------------

describe("moneyToCents", () => {
  it("converts euro numbers and strings to integer cents", () => {
    expect(moneyToCents(12.5)).toBe(1250);
    expect(moneyToCents("12.50")).toBe(1250);
    expect(moneyToCents("0")).toBe(0);
  });

  it("accepts NL comma decimals", () => {
    expect(moneyToCents("9,99")).toBe(999);
  });

  it("returns 0 for missing/garbage", () => {
    expect(moneyToCents(undefined)).toBe(0);
    expect(moneyToCents("")).toBe(0);
    expect(moneyToCents("abc")).toBe(0);
  });
});

describe("toIso", () => {
  it("passes through ISO date strings", () => {
    expect(toIso("2026-06-01T10:00:00.000Z")).toBe("2026-06-01T10:00:00.000Z");
  });

  it("converts unix seconds and millis", () => {
    expect(toIso(1_700_000_000)).toBe(new Date(1_700_000_000_000).toISOString());
    expect(toIso(1_700_000_000_000)).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("returns '' for missing/unparseable", () => {
    expect(toIso(undefined)).toBe("");
    expect(toIso("not-a-date")).toBe("");
  });
});

// -----------------------------------------------------------------------------
// parsePostback
// -----------------------------------------------------------------------------

describe("parsePostback", () => {
  it("maps Awin postback fields (clickRef → subid, commissionAmount → commission)", () => {
    const n = parsePostback("awin", {
      transactionId: "TX-1",
      clickRef: "expertgids:beste-airfryer:organic",
      saleAmount: "49.99",
      commissionAmount: "5.00",
      commissionStatus: "pending",
      transactionDate: "2026-06-01T12:00:00Z",
      currency: "EUR",
    });
    expect(n).toMatchObject({
      networkTransactionId: "TX-1",
      subid: "expertgids:beste-airfryer:organic",
      amountCents: 4999,
      commissionCents: 500,
      rawStatus: "pending",
      currency: "EUR",
    });
    expect(n?.occurredAt).toBe("2026-06-01T12:00:00.000Z");
  });

  it("maps Daisycon snake_case fields", () => {
    const n = parsePostback("daisycon", {
      id: "D-9",
      sub_id: "t:p:c",
      revenue_total: 30,
      commission_total: 3,
      status: "approved",
      sale_date: "2026-05-20",
    });
    expect(n).toMatchObject({
      networkTransactionId: "D-9",
      subid: "t:p:c",
      amountCents: 3000,
      commissionCents: 300,
      rawStatus: "approved",
    });
  });

  it("returns null when the transaction id is absent (→ 400)", () => {
    expect(parsePostback("bol", { subId: "t:p:c", commission: 1 })).toBeNull();
  });

  it("defaults currency to EUR and subid to null when omitted", () => {
    const n = parsePostback("other", { transactionId: "X", amount: 10 });
    expect(n?.currency).toBe("EUR");
    expect(n?.subid).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// ingestConversion — link resolution + idempotency, via an in-memory store
// -----------------------------------------------------------------------------

const RECEIVED_AT = "2026-06-05T00:00:00.000Z";

function makeStore(links: ConversionLinks | null) {
  const rows = new Map<string, ConversionUpsert>();
  const resolveCalls: Array<{ network: AffiliateNetwork; subid: string }> = [];
  const store: ConversionStore = {
    async resolveLinks(network, subid) {
      resolveCalls.push({ network, subid });
      return links;
    },
    async upsertConversion(row) {
      const key = `${row.network}:${row.networkTransactionId}`;
      const action = rows.has(key) ? "updated" : "inserted";
      rows.set(key, row);
      return { action };
    },
  };
  return { store, rows, resolveCalls };
}

const linked: ConversionLinks = {
  tenantId: "tenant-1",
  affiliateLinkId: "link-1",
  clickId: "click-1",
  pageId: "page-1",
};

function normalized(over: Partial<NormalizedConversion> = {}): NormalizedConversion {
  return {
    networkTransactionId: "TX-1",
    subid: "t:p:c",
    amountCents: 4999,
    commissionCents: 500,
    currency: "EUR",
    occurredAt: "2026-06-01T12:00:00.000Z",
    rawStatus: "pending",
    raw: {},
    ...over,
  };
}

describe("ingestConversion", () => {
  it("stores a linked conversion and carries the page id", async () => {
    const { store, rows } = makeStore(linked);
    const r = await ingestConversion({
      store,
      network: "awin",
      normalized: normalized(),
      receivedAt: RECEIVED_AT,
    });
    expect(r).toEqual({ status: "stored", action: "inserted", pageId: "page-1" });
    const row = rows.get("awin:TX-1");
    expect(row).toMatchObject({
      tenantId: "tenant-1",
      affiliateLinkId: "link-1",
      clickId: "click-1",
      pageId: "page-1",
      commissionCents: 500,
      status: "pending",
    });
  });

  it("is idempotent on (network, transaction id): second call updates", async () => {
    const { store } = makeStore(linked);
    const first = await ingestConversion({
      store,
      network: "awin",
      normalized: normalized(),
      receivedAt: RECEIVED_AT,
    });
    const second = await ingestConversion({
      store,
      network: "awin",
      normalized: normalized({ rawStatus: "approved" }),
      receivedAt: RECEIVED_AT,
    });
    expect(first.status === "stored" && first.action).toBe("inserted");
    expect(second.status === "stored" && second.action).toBe("updated");
  });

  it("returns unlinked (no write) when the subid is missing", async () => {
    const { store, rows } = makeStore(linked);
    const r = await ingestConversion({
      store,
      network: "bol",
      normalized: normalized({ subid: null }),
      receivedAt: RECEIVED_AT,
    });
    expect(r).toEqual({ status: "unlinked", reason: "no_subid" });
    expect(rows.size).toBe(0);
  });

  it("returns unlinked (no write) when the subid is unknown", async () => {
    const { store, rows } = makeStore(null);
    const r = await ingestConversion({
      store,
      network: "bol",
      normalized: normalized(),
      receivedAt: RECEIVED_AT,
    });
    expect(r).toEqual({ status: "unlinked", reason: "unknown_subid" });
    expect(rows.size).toBe(0);
  });

  it("falls back to receivedAt when the payload has no sale date", async () => {
    const { store, rows } = makeStore(linked);
    await ingestConversion({
      store,
      network: "awin",
      normalized: normalized({ occurredAt: "" }),
      receivedAt: RECEIVED_AT,
    });
    expect(rows.get("awin:TX-1")?.occurredAt).toBe(RECEIVED_AT);
  });
});
