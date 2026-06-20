import { describe, expect, it, vi } from "vitest";
import { listTransactions as listAffiliateTransactions } from "../affiliate.js";
import { searchCatalog } from "../catalog.js";
import { BolClient } from "../client.js";
import { BolAuthError, BolError } from "../types.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(opts: {
  fetchImpl: typeof fetch;
  now?: () => number;
  maxAttempts?: number;
}): BolClient {
  return new BolClient({
    credentials: { clientId: "id", clientSecret: "secret" },
    fetchImpl: opts.fetchImpl,
    now: opts.now,
    retry: {
      maxAttempts: opts.maxAttempts ?? 2,
      decide: () => ({ retry: true, delayMs: 0 }),
    },
  });
}

describe("BolClient token lifecycle", () => {
  it("fetches a token on first request and reuses it on the second", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/token")) {
        expect(init?.method).toBe("POST");
        expect((init?.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
        return jsonResponse(200, {
          access_token: "tok_abc",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok_abc");
      return jsonResponse(200, { products: [], totalResultSize: 0 });
    });

    const client = makeClient({ fetchImpl });
    await searchCatalog(client, { searchTerm: "wandelschoenen" });
    await searchCatalog(client, { searchTerm: "regenjas" });

    const calls = fetchImpl.mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : c[0].toString(),
    );
    expect(calls.filter((u) => u.includes("/token"))).toHaveLength(1);
    expect(calls.filter((u) => u.includes("/products/search"))).toHaveLength(2);
  });

  it("refreshes the token after it expires", async () => {
    let nowMs = 1_000_000;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/token")) {
        return jsonResponse(200, {
          access_token: `tok_${nowMs}`,
          token_type: "Bearer",
          expires_in: 120, // 2 minutes
        });
      }
      return jsonResponse(200, { products: [] });
    });
    const client = makeClient({ fetchImpl, now: () => nowMs });
    await searchCatalog(client, { searchTerm: "x" });
    nowMs += 130_000; // advance past expiry (incl. leeway)
    await searchCatalog(client, { searchTerm: "y" });
    const tokenCalls = fetchImpl.mock.calls.filter((c) =>
      (typeof c[0] === "string" ? c[0] : c[0].toString()).endsWith("/token"),
    );
    expect(tokenCalls).toHaveLength(2);
  });

  it("collapses concurrent token fetches into a single network round trip", async () => {
    let tokenFetches = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/token")) {
        tokenFetches++;
        // Simulate latency so the second caller arrives while the first is in flight.
        await new Promise((r) => setTimeout(r, 20));
        return jsonResponse(200, {
          access_token: "tok",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      return jsonResponse(200, { products: [] });
    });
    const client = makeClient({ fetchImpl });
    await Promise.all([
      searchCatalog(client, { searchTerm: "a" }),
      searchCatalog(client, { searchTerm: "b" }),
      searchCatalog(client, { searchTerm: "c" }),
    ]);
    expect(tokenFetches).toBe(1);
  });

  it("throws BolAuthError on 403 to the token endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(403, { title: "forbidden" }));
    const client = makeClient({ fetchImpl, maxAttempts: 1 });
    await expect(searchCatalog(client, { searchTerm: "x" })).rejects.toBeInstanceOf(BolAuthError);
  });
});

describe("BolClient request behaviour", () => {
  it("drops cached token + re-auths on 401 from a resource endpoint", async () => {
    let tokenCalls = 0;
    let searchCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/token")) {
        tokenCalls++;
        return jsonResponse(200, {
          access_token: `tok_${tokenCalls}`,
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      searchCalls++;
      if (searchCalls === 1) return jsonResponse(401, { title: "expired" });
      return jsonResponse(200, { products: [{ ean: "123" }] });
    });
    const client = makeClient({ fetchImpl, maxAttempts: 3 });
    const res = await searchCatalog(client, { searchTerm: "x" });
    expect(res.products).toHaveLength(1);
    expect(tokenCalls).toBe(2);
  });

  it("retries 5xx and eventually surfaces BolError after exhausting attempts", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/token")) {
        return jsonResponse(200, { access_token: "t", token_type: "Bearer", expires_in: 3600 });
      }
      return jsonResponse(503, { title: "unavailable" });
    });
    const client = makeClient({ fetchImpl, maxAttempts: 3 });
    await expect(searchCatalog(client, { searchTerm: "x" })).rejects.toMatchObject({
      name: "BolError",
      httpStatus: 503,
    });
  });

  it("validates the catalog response with Zod and rejects malformed bodies", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/token")) {
        return jsonResponse(200, { access_token: "t", token_type: "Bearer", expires_in: 3600 });
      }
      // `products` is required to be an array; sending a string forces a Zod fail.
      return jsonResponse(200, { products: "nope" });
    });
    const client = makeClient({ fetchImpl, maxAttempts: 1 });
    await expect(searchCatalog(client, { searchTerm: "x" })).rejects.toBeInstanceOf(BolError);
  });

  it("includes a User-Agent that identifies the bot per CLAUDE.md non-negotiable #3", async () => {
    let seenUA: string | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      seenUA = (init?.headers as Record<string, string>)?.["User-Agent"];
      if (url.endsWith("/token")) {
        return jsonResponse(200, { access_token: "t", token_type: "Bearer", expires_in: 3600 });
      }
      return jsonResponse(200, { products: [] });
    });
    const client = makeClient({ fetchImpl, maxAttempts: 1 });
    await searchCatalog(client, { searchTerm: "x" });
    expect(seenUA).toMatch(/^NicheFinder\/1\.0/);
  });
});

// ---------------------------------------------------------------------------
// Bol Affiliate Reporting API v2 — listTransactions
// ---------------------------------------------------------------------------

function tokenAndAffiliate(affiliateBody: unknown, status = 200): typeof fetch {
  return vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.endsWith("/token")) {
      return new Response(
        JSON.stringify({ access_token: "tok", token_type: "Bearer", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(affiliateBody), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

describe("listAffiliateTransactions", () => {
  it("returns parsed transactions on a successful response", async () => {
    const fetchImpl = tokenAndAffiliate({
      transactions: [
        { id: "txn-1", status: "approved", commission: 4.5 },
        { id: "txn-2", status: "pending", commission: 1.2 },
      ],
    });
    const client = makeClient({ fetchImpl });
    const result = await listAffiliateTransactions(client, {
      startDate: "2026-06-01",
      endDate: "2026-06-07",
    });
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]?.id).toBe("txn-1");
  });

  it("defaults to an empty transactions array when the field is missing", async () => {
    const fetchImpl = tokenAndAffiliate({});
    const client = makeClient({ fetchImpl });
    const result = await listAffiliateTransactions(client, {
      startDate: "2026-06-01",
      endDate: "2026-06-07",
    });
    expect(result.transactions).toEqual([]);
  });

  it("passes date range and sub-id as query params", async () => {
    let capturedUrl = "";
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      capturedUrl = url;
      if (url.endsWith("/token")) {
        return new Response(
          JSON.stringify({ access_token: "t", token_type: "Bearer", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ transactions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = makeClient({ fetchImpl });
    await listAffiliateTransactions(client, {
      startDate: "2026-06-01",
      endDate: "2026-06-07",
      subId: "main:koffie:cohort-a",
    });
    expect(capturedUrl).toContain("/affiliate/reporting/v2/transactions");
    expect(capturedUrl).toContain("start-date=2026-06-01");
    expect(capturedUrl).toContain("end-date=2026-06-07");
    expect(capturedUrl).toContain("sub-id=main");
  });

  it("throws BolError when transactions is not an array", async () => {
    // The schema requires transactions to be an array; a string forces a Zod fail.
    const fetchImpl = tokenAndAffiliate({ transactions: "nope" });
    const client = makeClient({ fetchImpl, maxAttempts: 1 });
    await expect(
      listAffiliateTransactions(client, { startDate: "2026-06-01", endDate: "2026-06-07" }),
    ).rejects.toBeInstanceOf(BolError);
  });
});
