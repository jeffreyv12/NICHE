import { describe, expect, it } from "vitest";
import { EuipoClient, EuipoError } from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okFetch(body: unknown) {
  return async () =>
    ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    }) as Response;
}

function errorFetch(status: number, body = "Bad Request") {
  return async () =>
    ({
      ok: false,
      status,
      text: async () => body,
    }) as Response;
}

function makeClient(fetchImpl: typeof fetch) {
  return new EuipoClient({ baseUrl: "https://euipo.test", fetchImpl });
}

const HIT = {
  applicationNumber: "EU123",
  markVerbalElement: "Coolblue",
  status: "Registered",
};

// ---------------------------------------------------------------------------
// EuipoError
// ---------------------------------------------------------------------------

describe("EuipoError", () => {
  it("carries httpStatus, endpoint, and detail properties", () => {
    const err = new EuipoError(404, "/trademarks/results", "not found");
    expect(err.httpStatus).toBe(404);
    expect(err.endpoint).toBe("/trademarks/results");
    expect(err.detail).toBe("not found");
  });

  it("has name EuipoError", () => {
    expect(new EuipoError(500, "/endpoint").name).toBe("EuipoError");
  });

  it("message includes status and endpoint", () => {
    const msg = new EuipoError(429, "/trademarks/results").message;
    expect(msg).toContain("429");
    expect(msg).toContain("/trademarks/results");
  });
});

// ---------------------------------------------------------------------------
// searchTrademarks
// ---------------------------------------------------------------------------

describe("EuipoClient.searchTrademarks", () => {
  it("returns parsed trademarks on a successful response", async () => {
    const client = makeClient(okFetch({ total: 1, tradeMarks: [HIT] }) as never);
    const result = await client.searchTrademarks({ basicSearch: "Coolblue" });
    expect(result.total).toBe(1);
    expect(result.tradeMarks).toHaveLength(1);
    expect(result.tradeMarks[0]?.markVerbalElement).toBe("Coolblue");
  });

  it("returns empty tradeMarks when API returns an empty list", async () => {
    const client = makeClient(okFetch({ total: 0, tradeMarks: [] }) as never);
    const result = await client.searchTrademarks({ basicSearch: "koffiemolen" });
    expect(result.tradeMarks).toEqual([]);
  });

  it("defaults tradeMarks to [] when field is missing from response", async () => {
    const client = makeClient(okFetch({ total: 0 }) as never);
    const result = await client.searchTrademarks({ basicSearch: "koffiemolen" });
    expect(result.tradeMarks).toEqual([]);
  });

  it("throws EuipoError on HTTP error response", async () => {
    const client = makeClient(errorFetch(429, "Rate limit exceeded") as never);
    await expect(client.searchTrademarks({ basicSearch: "test" })).rejects.toBeInstanceOf(
      EuipoError,
    );
  });

  it("thrown EuipoError has the HTTP status code", async () => {
    const client = makeClient(errorFetch(403) as never);
    try {
      await client.searchTrademarks({ basicSearch: "test" });
    } catch (e) {
      expect((e as EuipoError).httpStatus).toBe(403);
    }
  });

  it("throws EuipoError when response body is not valid JSON", async () => {
    const badFetch = async () =>
      ({ ok: true, status: 200, text: async () => "not json" }) as Response;
    const client = makeClient(badFetch as never);
    await expect(client.searchTrademarks({ basicSearch: "test" })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// hasActiveMatch
// ---------------------------------------------------------------------------

describe("EuipoClient.hasActiveMatch", () => {
  it("returns hit=true when total > 0", async () => {
    const client = makeClient(okFetch({ total: 3, tradeMarks: [HIT] }) as never);
    const result = await client.hasActiveMatch("Coolblue");
    expect(result.hit).toBe(true);
    expect(result.total).toBe(3);
  });

  it("returns hit=false when total is 0", async () => {
    const client = makeClient(okFetch({ total: 0, tradeMarks: [] }) as never);
    const result = await client.hasActiveMatch("koffiemolen");
    expect(result.hit).toBe(false);
    expect(result.total).toBe(0);
  });

  it("falls back to tradeMarks.length when total field is absent", async () => {
    // API response without `total` — client should use tradeMarks.length.
    const client = makeClient(okFetch({ tradeMarks: [HIT, HIT] }) as never);
    const result = await client.hasActiveMatch("SomeBrand");
    expect(result.hit).toBe(true);
    expect(result.total).toBe(2);
  });

  it("returns hit=false when both total is absent and tradeMarks is empty", async () => {
    const client = makeClient(okFetch({ tradeMarks: [] }) as never);
    const result = await client.hasActiveMatch("unknown");
    expect(result.hit).toBe(false);
    expect(result.total).toBe(0);
  });
});
