import { describe, expect, it, vi } from "vitest";
import type { EuipoClient } from "../../sources/euipo/index.js";
import type { WikipediaClient } from "../../sources/wikipedia/index.js";
import {
  type AffiliateSignalAdapter,
  type KeywordSignalAdapter,
  buildDefaultPrefetch,
} from "../prefetch.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<{ topic: string; relatedKeywords: string[] }>) {
  return {
    candidate: {
      topic: overrides?.topic ?? "koffiemolen",
      topic_slug: "koffiemolen",
      language: "nl" as const,
      related_keywords: overrides?.relatedKeywords ?? ["espressomolen"],
      source: "wikipedia",
      score: null,
    },
    asOf: "2026-06-01T12:00:00.000Z",
  };
}

function noopAffiliate(): AffiliateSignalAdapter {
  return {
    fetch: async () => ({ bol: [], awin: [] }) as never,
  };
}

function noopKeyword(): KeywordSignalAdapter {
  return {
    fetch: async () =>
      ({
        keywords: [],
        serp: [],
        trends: undefined,
      }) as never,
  };
}

function stubWiki(views: number[]): WikipediaClient {
  return {
    pageviews: vi.fn(async () => ({
      items: views.map((v, i) => ({
        project: "nl.wikipedia",
        article: "koffiemolen",
        granularity: "daily" as const,
        timestamp: `20260${String(i + 1).padStart(2, "0")}0100`,
        views: v,
      })),
    })),
    topPages: vi.fn(async () => []),
  } as unknown as WikipediaClient;
}

function clearEuipo(): EuipoClient {
  return {
    searchTrademarks: vi.fn(async () => ({ total: 0, tradeMarks: [] })),
    hasActiveMatch: vi.fn(async () => ({ hit: false, total: 0 })),
  } as unknown as EuipoClient;
}

function matchEuipo(marks: string[]): EuipoClient {
  return {
    searchTrademarks: vi.fn(async () => ({
      total: marks.length,
      tradeMarks: marks.map((m) => ({
        applicationNumber: "EU1",
        markVerbalElement: m,
        status: "Registered",
      })),
    })),
    hasActiveMatch: vi.fn(async () => ({ hit: true, total: marks.length })),
  } as unknown as EuipoClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildDefaultPrefetch", () => {
  it("returns a bundle with affiliate and keyword fields from injected adapters", async () => {
    const affiliateData = { bol: [{ productId: "p1", commission: 0.04 }], awin: [] };
    const keywordData = {
      keywords: [{ keyword: "beste koffiemolen", search_volume: 3000 }],
      serp: [{ url: "https://example.nl", position: 1 }],
    };

    const prefetch = buildDefaultPrefetch({
      affiliate: { fetch: async () => affiliateData as never },
      keyword: { fetch: async () => keywordData as never },
      wikipedia: stubWiki([]),
      euipo: clearEuipo(),
    });

    const bundle = await prefetch.fetchBundle(makeCtx());
    expect(bundle.affiliate_availability).toEqual(affiliateData);
    expect(bundle.dataforseo_keywords).toEqual(keywordData.keywords);
    expect(bundle.dataforseo_serp_top5).toEqual(keywordData.serp);
  });

  it("kill_list_match is null for a clean topic", async () => {
    const prefetch = buildDefaultPrefetch({
      affiliate: noopAffiliate(),
      keyword: noopKeyword(),
      wikipedia: stubWiki([]),
      euipo: clearEuipo(),
    });
    const bundle = await prefetch.fetchBundle(makeCtx({ topic: "koffiemolen" }));
    expect(bundle.kill_list_match).toBeNull();
    expect(bundle.ymyl_match).toBe(false);
  });

  it("kill_list_match is set for a kill-list topic (supplements)", async () => {
    const prefetch = buildDefaultPrefetch({
      affiliate: noopAffiliate(),
      keyword: noopKeyword(),
      wikipedia: stubWiki([]),
      euipo: clearEuipo(),
    });
    // "afslankpillen" should match the weight-loss kill category.
    const bundle = await prefetch.fetchBundle(
      makeCtx({ topic: "afslankpillen", relatedKeywords: ["vetverbrander kopen"] }),
    );
    expect(bundle.kill_list_match).not.toBeNull();
  });

  it("trademark clear when EUIPO returns no matches", async () => {
    const prefetch = buildDefaultPrefetch({
      affiliate: noopAffiliate(),
      keyword: noopKeyword(),
      wikipedia: stubWiki([]),
      euipo: clearEuipo(),
    });
    const bundle = await prefetch.fetchBundle(makeCtx());
    expect(bundle.trademark?.euipo_tmview).toBe("clear");
  });

  it("trademark match when EUIPO returns a Registered mark", async () => {
    const prefetch = buildDefaultPrefetch({
      affiliate: noopAffiliate(),
      keyword: noopKeyword(),
      wikipedia: stubWiki([]),
      euipo: matchEuipo(["Coolblue"]),
    });
    const bundle = await prefetch.fetchBundle(makeCtx({ topic: "Coolblue" }));
    expect(bundle.trademark?.euipo_tmview).toBe("match");
    expect((bundle.trademark as { matched_marks: string[] }).matched_marks).toContain("Coolblue");
  });

  it("trademark unknown when EUIPO throws", async () => {
    const brokenEuipo = {
      searchTrademarks: vi.fn(async () => {
        throw new Error("EUIPO unavailable");
      }),
    } as unknown as EuipoClient;

    const prefetch = buildDefaultPrefetch({
      affiliate: noopAffiliate(),
      keyword: noopKeyword(),
      wikipedia: stubWiki([]),
      euipo: brokenEuipo,
    });
    const bundle = await prefetch.fetchBundle(makeCtx());
    expect(bundle.trademark?.euipo_tmview).toBe("unknown");
  });

  it("wikipedia slope is undefined when fewer than 9 datapoints", async () => {
    const prefetch = buildDefaultPrefetch({
      affiliate: noopAffiliate(),
      keyword: noopKeyword(),
      wikipedia: stubWiki([100, 110, 105]),
      euipo: clearEuipo(),
    });
    const bundle = await prefetch.fetchBundle(makeCtx());
    // Slope computation returns undefined, so wikipedia field is absent.
    expect(bundle.wikipedia).toBeUndefined();
  });

  it("wikipedia positive slope for growing interest", async () => {
    // 12 daily datapoints: first third ~100, last third ~200 → slope ≈ 1.0
    const views = [90, 95, 100, 110, 120, 130, 150, 170, 185, 190, 195, 200];
    const prefetch = buildDefaultPrefetch({
      affiliate: noopAffiliate(),
      keyword: noopKeyword(),
      wikipedia: stubWiki(views),
      euipo: clearEuipo(),
    });
    const bundle = await prefetch.fetchBundle(makeCtx());
    expect(bundle.wikipedia?.pageview_90d_slope).toBeGreaterThan(0);
  });

  it("wikipedia error is swallowed — bundle still returns without wikipedia field", async () => {
    const brokenWiki = {
      pageviews: vi.fn(async () => {
        throw new Error("Wikipedia unreachable");
      }),
    } as unknown as WikipediaClient;

    const prefetch = buildDefaultPrefetch({
      affiliate: noopAffiliate(),
      keyword: noopKeyword(),
      wikipedia: brokenWiki,
      euipo: clearEuipo(),
    });
    const bundle = await prefetch.fetchBundle(makeCtx());
    expect(bundle.wikipedia).toBeUndefined();
  });

  it("operator_interest defaults to 50", async () => {
    const prefetch = buildDefaultPrefetch({
      affiliate: noopAffiliate(),
      keyword: noopKeyword(),
      wikipedia: stubWiki([]),
      euipo: clearEuipo(),
    });
    const bundle = await prefetch.fetchBundle(makeCtx());
    expect(bundle.operator_interest).toBe(50);
  });

  it("operator_interest override is passed through", async () => {
    const prefetch = buildDefaultPrefetch({
      affiliate: noopAffiliate(),
      keyword: noopKeyword(),
      wikipedia: stubWiki([]),
      euipo: clearEuipo(),
      operatorInterest: 80,
    });
    const bundle = await prefetch.fetchBundle(makeCtx());
    expect(bundle.operator_interest).toBe(80);
  });
});
