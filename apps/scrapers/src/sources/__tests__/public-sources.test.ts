import { describe, expect, it, vi } from "vitest";
import { EuipoClient, EuipoError } from "../euipo/index.js";
import { WikipediaClient, WikipediaError } from "../wikipedia/index.js";
import { YouTubeClient, YouTubeError } from "../youtube/index.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("YouTubeClient", () => {
  it("sends api key + region + relevance language in the query string", async () => {
    let calledUrl = "";
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      calledUrl = typeof input === "string" ? input : (input as Request).url;
      return jsonResponse(200, {
        items: [{ id: { videoId: "abc" }, snippet: { title: "Test" } }],
        pageInfo: { totalResults: 1 },
      });
    });
    const client = new YouTubeClient({ apiKey: "K", fetchImpl });
    const out = await client.search({
      q: "wandelschoenen",
      regionCode: "NL",
      relevanceLanguage: "nl",
    });
    expect(out.items).toHaveLength(1);
    expect(calledUrl).toContain("key=K");
    expect(calledUrl).toContain("regionCode=NL");
    expect(calledUrl).toContain("relevanceLanguage=nl");
    expect(calledUrl).toContain("q=wandelschoenen");
    expect(calledUrl).toContain("part=snippet");
  });

  it("throws YouTubeError on 403 quota", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(403, { error: { message: "quotaExceeded" } }),
    );
    const client = new YouTubeClient({ apiKey: "K", fetchImpl });
    await expect(client.search({ q: "x" })).rejects.toBeInstanceOf(YouTubeError);
  });
});

describe("WikipediaClient", () => {
  it("builds the per-article pageviews path and URL-encodes the article", async () => {
    let calledUrl = "";
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      calledUrl = typeof input === "string" ? input : (input as Request).url;
      return jsonResponse(200, {
        items: [
          {
            project: "nl.wikipedia",
            article: "Hardlopen",
            granularity: "daily",
            timestamp: "2026010100",
            views: 1234,
          },
        ],
      });
    });
    const client = new WikipediaClient({ fetchImpl });
    const out = await client.pageviews({
      article: "Bergsport",
      start: "20260101",
      end: "20260108",
    });
    expect(out.items[0]?.views).toBe(1234);
    expect(calledUrl).toContain("/metrics/pageviews/per-article/nl.wikipedia/");
    expect(calledUrl).toContain("/Bergsport/daily/20260101/20260108");
  });

  it("encodes spaces as underscores in the article path", async () => {
    let calledUrl = "";
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      calledUrl = typeof input === "string" ? input : (input as Request).url;
      return jsonResponse(200, { items: [] });
    });
    const client = new WikipediaClient({ fetchImpl });
    await client.pageviews({
      article: "Bicycle touring",
      start: "20260101",
      end: "20260108",
    });
    expect(calledUrl).toContain("/Bicycle_touring/");
  });

  it("throws on 404 (article not found)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(404, "Not found"));
    const client = new WikipediaClient({ fetchImpl });
    await expect(
      client.pageviews({ article: "Doesnotexist", start: "20260101", end: "20260108" }),
    ).rejects.toBeInstanceOf(WikipediaError);
  });

  it("topPages returns the articles array for a given day", async () => {
    let calledUrl = "";
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      calledUrl = typeof input === "string" ? input : (input as Request).url;
      return jsonResponse(200, {
        items: [
          {
            articles: [
              { article: "Hardlopen", views: 9000, rank: 1 },
              { article: "Wielrennen", views: 7500, rank: 2 },
            ],
          },
        ],
      });
    });
    const client = new WikipediaClient({ fetchImpl });
    const articles = await client.topPages({ project: "nl.wikipedia", date: "20260601" });
    expect(articles).toHaveLength(2);
    expect(articles[0]?.article).toBe("Hardlopen");
    expect(calledUrl).toContain("/metrics/pageviews/top/nl.wikipedia/all-access/2026/06/01");
  });
});

describe("EuipoClient", () => {
  it("builds the trademarks search URL with default offices NL/BX/EM", async () => {
    let calledUrl = "";
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      calledUrl = typeof input === "string" ? input : (input as Request).url;
      return jsonResponse(200, { total: 0, tradeMarks: [] });
    });
    const client = new EuipoClient({ fetchImpl });
    const out = await client.searchTrademarks({ basicSearch: "Expertgids" });
    expect(out.total).toBe(0);
    expect(calledUrl).toContain("basicSearch=Expertgids");
    expect(calledUrl).toContain("offices=EM%2CBX%2CNL");
    expect(calledUrl).toContain("statuses=Registered%2CFiled");
  });

  it("hasActiveMatch returns true when total > 0", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(200, {
        total: 3,
        tradeMarks: [{ applicationNumber: "EU1", markVerbalElement: "Coolblue" }],
      }),
    );
    const client = new EuipoClient({ fetchImpl });
    const out = await client.hasActiveMatch("Coolblue");
    expect(out.hit).toBe(true);
    expect(out.total).toBe(3);
  });

  it("hasActiveMatch returns false when total is 0", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(200, { total: 0, tradeMarks: [] }),
    );
    const client = new EuipoClient({ fetchImpl });
    const out = await client.hasActiveMatch("Notatrademark12345");
    expect(out.hit).toBe(false);
    expect(out.total).toBe(0);
  });

  it("throws EuipoError on a 503", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(503, "unavailable"));
    const client = new EuipoClient({ fetchImpl });
    await expect(client.searchTrademarks({ basicSearch: "x" })).rejects.toBeInstanceOf(EuipoError);
  });
});
