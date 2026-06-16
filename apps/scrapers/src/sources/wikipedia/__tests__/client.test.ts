import { describe, expect, it } from "vitest";
import { WikipediaClient, WikipediaError } from "../index.js";

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

function errorFetch(status: number, body = "Service Unavailable") {
  return async () =>
    ({
      ok: false,
      status,
      text: async () => body,
    }) as Response;
}

function makeClient(fetchImpl: typeof fetch) {
  return new WikipediaClient({ baseUrl: "https://wiki.test", fetchImpl });
}

const PAGEVIEW_ITEM = {
  project: "nl.wikipedia",
  article: "Koffiemolen",
  granularity: "daily",
  timestamp: "2026060100",
  views: 3200,
};

const TOP_ARTICLE = { article: "Koffiemolen", views: 3200, rank: 1 };

// ---------------------------------------------------------------------------
// WikipediaError
// ---------------------------------------------------------------------------

describe("WikipediaError", () => {
  it("carries httpStatus, endpoint, and optional detail", () => {
    const err = new WikipediaError(503, "/metrics/pageviews", "overload");
    expect(err.httpStatus).toBe(503);
    expect(err.endpoint).toBe("/metrics/pageviews");
    expect(err.detail).toBe("overload");
  });

  it("has name WikipediaError", () => {
    expect(new WikipediaError(404, "/endpoint").name).toBe("WikipediaError");
  });
});

// ---------------------------------------------------------------------------
// pageviews
// ---------------------------------------------------------------------------

describe("WikipediaClient.pageviews", () => {
  const ARGS = {
    article: "Koffiemolen",
    start: "20260101",
    end: "20260131",
  };

  it("returns parsed pageview items on a successful response", async () => {
    const client = makeClient(okFetch({ items: [PAGEVIEW_ITEM] }) as never);
    const result = await client.pageviews(ARGS);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.views).toBe(3200);
    expect(result.items[0]?.article).toBe("Koffiemolen");
  });

  it("returns empty items when API returns an empty list", async () => {
    const client = makeClient(okFetch({ items: [] }) as never);
    const result = await client.pageviews(ARGS);
    expect(result.items).toEqual([]);
  });

  it("defaults items to [] when field is missing", async () => {
    const client = makeClient(okFetch({}) as never);
    const result = await client.pageviews(ARGS);
    expect(result.items).toEqual([]);
  });

  it("throws WikipediaError on HTTP error response", async () => {
    const client = makeClient(errorFetch(503) as never);
    await expect(client.pageviews(ARGS)).rejects.toBeInstanceOf(WikipediaError);
  });

  it("thrown WikipediaError carries the HTTP status", async () => {
    const client = makeClient(errorFetch(429) as never);
    try {
      await client.pageviews(ARGS);
    } catch (e) {
      expect((e as WikipediaError).httpStatus).toBe(429);
    }
  });

  it("URL-encodes article spaces as underscores", async () => {
    let capturedUrl = "";
    const captureFetch = async (url: string) => {
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => '{"items":[]}' } as Response;
    };
    const client = makeClient(captureFetch as never);
    await client.pageviews({ article: "koffie molen", start: "20260101", end: "20260131" });
    expect(capturedUrl).toContain("koffie_molen");
  });
});

// ---------------------------------------------------------------------------
// topPages
// ---------------------------------------------------------------------------

describe("WikipediaClient.topPages", () => {
  it("returns articles from the first items entry", async () => {
    const client = makeClient(okFetch({ items: [{ articles: [TOP_ARTICLE] }] }) as never);
    const result = await client.topPages({ date: "20260601" });
    expect(result).toHaveLength(1);
    expect(result[0]?.article).toBe("Koffiemolen");
  });

  it("returns empty array when articles list is empty", async () => {
    const client = makeClient(okFetch({ items: [{ articles: [] }] }) as never);
    const result = await client.topPages({ date: "20260601" });
    expect(result).toEqual([]);
  });

  it("returns empty array when items is empty", async () => {
    const client = makeClient(okFetch({ items: [] }) as never);
    const result = await client.topPages({ date: "20260601" });
    expect(result).toEqual([]);
  });

  it("throws WikipediaError on HTTP error", async () => {
    const client = makeClient(errorFetch(404) as never);
    await expect(client.topPages({ date: "20260601" })).rejects.toBeInstanceOf(WikipediaError);
  });
});
