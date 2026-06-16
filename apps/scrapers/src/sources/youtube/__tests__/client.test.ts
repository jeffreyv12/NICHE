import { describe, expect, it } from "vitest";
import { YouTubeClient, YouTubeError } from "../index.js";

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

function errorFetch(status: number, body = "Forbidden") {
  return async () =>
    ({
      ok: false,
      status,
      text: async () => body,
    }) as Response;
}

function makeClient(fetchImpl: typeof fetch) {
  return new YouTubeClient({ apiKey: "test-key", baseUrl: "https://yt.test", fetchImpl });
}

const SEARCH_ITEM = {
  id: { kind: "youtube#video", videoId: "abc123" },
  snippet: {
    title: "Beste Koffiemolen 2026",
    channelTitle: "KoffieTube NL",
    publishedAt: "2026-01-01T00:00:00Z",
  },
};

// ---------------------------------------------------------------------------
// YouTubeError
// ---------------------------------------------------------------------------

describe("YouTubeError", () => {
  it("carries httpStatus, endpoint, and optional detail", () => {
    const err = new YouTubeError(403, "/search", "quota exceeded");
    expect(err.httpStatus).toBe(403);
    expect(err.endpoint).toBe("/search");
    expect(err.detail).toBe("quota exceeded");
  });

  it("has name YouTubeError", () => {
    expect(new YouTubeError(403, "/search").name).toBe("YouTubeError");
  });

  it("message includes status and endpoint", () => {
    const msg = new YouTubeError(403, "/search").message;
    expect(msg).toContain("403");
    expect(msg).toContain("/search");
  });
});

// ---------------------------------------------------------------------------
// YouTubeClient.search
// ---------------------------------------------------------------------------

describe("YouTubeClient.search", () => {
  it("returns parsed search items on a successful response", async () => {
    const body = { items: [SEARCH_ITEM], pageInfo: { totalResults: 1 } };
    const client = makeClient(okFetch(body) as never);
    const result = await client.search({ q: "beste koffiemolen" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.snippet?.title).toBe("Beste Koffiemolen 2026");
  });

  it("returns empty items array when API returns no results", async () => {
    const client = makeClient(okFetch({ items: [] }) as never);
    const result = await client.search({ q: "niche-zonder-videos" });
    expect(result.items).toEqual([]);
  });

  it("defaults items to [] when field is absent", async () => {
    const client = makeClient(okFetch({}) as never);
    const result = await client.search({ q: "test" });
    expect(result.items).toEqual([]);
  });

  it("throws YouTubeError on HTTP 403 (quota exceeded / bad key)", async () => {
    const client = makeClient(errorFetch(403) as never);
    await expect(client.search({ q: "test" })).rejects.toBeInstanceOf(YouTubeError);
  });

  it("thrown YouTubeError carries the HTTP status", async () => {
    const client = makeClient(errorFetch(403, "quota") as never);
    try {
      await client.search({ q: "test" });
    } catch (e) {
      expect((e as YouTubeError).httpStatus).toBe(403);
    }
  });

  it("appends regionCode to the request URL when provided", async () => {
    let capturedUrl = "";
    const captureFetch = async (url: string) => {
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => '{"items":[]}' } as Response;
    };
    const client = makeClient(captureFetch as never);
    await client.search({ q: "koffiemolen", regionCode: "NL" });
    expect(capturedUrl).toContain("regionCode=NL");
  });

  it("appends relevanceLanguage to the request URL when provided", async () => {
    let capturedUrl = "";
    const captureFetch = async (url: string) => {
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => '{"items":[]}' } as Response;
    };
    const client = makeClient(captureFetch as never);
    await client.search({ q: "koffiemolen", relevanceLanguage: "nl" });
    expect(capturedUrl).toContain("relevanceLanguage=nl");
  });

  it("does not include optional params in URL when not provided", async () => {
    let capturedUrl = "";
    const captureFetch = async (url: string) => {
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => '{"items":[]}' } as Response;
    };
    const client = makeClient(captureFetch as never);
    await client.search({ q: "test" });
    expect(capturedUrl).not.toContain("regionCode");
    expect(capturedUrl).not.toContain("relevanceLanguage");
  });
});
