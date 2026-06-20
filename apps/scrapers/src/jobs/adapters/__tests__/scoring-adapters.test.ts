import { describe, expect, it, vi } from "vitest";
import type { PrefetchContext } from "../../prefetch.js";
import {
  buildBolAwinAffiliateAdapter,
  buildDataForSeoKeywordAdapter,
} from "../scoring-adapters.js";

// ---------------------------------------------------------------------------
// Shared test context
// ---------------------------------------------------------------------------

const CTX: PrefetchContext = {
  candidate: {
    id: "cand-001",
    topic: "Koffiezetapparaten",
    topic_slug: "koffiezetapparaten",
    related_keywords: ["espressomachine", "filterkoffie"],
    language: "nl",
  },
  asOf: "2026-06-20T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// DataForSEO keyword adapter
// ---------------------------------------------------------------------------

describe("buildDataForSeoKeywordAdapter", () => {
  function makeClient(overviewItems: object[] = [], serpItems: object[] = []) {
    return {
      post: vi.fn().mockImplementation((endpoint: string) => {
        if (endpoint.includes("keyword_overview")) {
          return Promise.resolve({
            tasks: [{ status_code: 20000, result: overviewItems }],
          });
        }
        if (endpoint.includes("organic/task_post")) {
          return Promise.resolve({
            tasks: [{ id: "task-1", status_code: 20100 }],
          });
        }
        if (endpoint.includes("task_get")) {
          return Promise.resolve({
            tasks: [{ status_code: 20000, result: [{ items: serpItems }] }],
          });
        }
        return Promise.resolve({ tasks: [{ status_code: 20000, result: [] }] });
      }),
    };
  }

  const fakeCache = {
    get: async () => null,
    set: async () => {},
  };

  it("returns empty keywords and serp when no data comes back", async () => {
    const adapter = buildDataForSeoKeywordAdapter(makeClient() as never, fakeCache);
    const result = await adapter.fetch(CTX);
    expect(result.keywords.keyword_count).toBe(0);
    expect(result.keywords.top_keyword).toBeUndefined();
    expect(result.serp.pct_top10_templated).toBeUndefined();
  });

  it("aggregates keyword volume and picks the top keyword", async () => {
    const items = [
      {
        keyword: "koffiezetapparaten",
        location_code: 2528,
        language_code: "nl",
        search_volume: 5000,
        competition: 0.6,
        search_intent_info: { main_intent: "commercial" },
      },
      {
        keyword: "beste espressomachine",
        location_code: 2528,
        language_code: "nl",
        search_volume: 2000,
        competition: 0.4,
        search_intent_info: { main_intent: "commercial" },
      },
      {
        keyword: "hoe werkt een espressomachine",
        location_code: 2528,
        language_code: "nl",
        search_volume: 800,
        competition: 0.1,
        search_intent_info: { main_intent: "informational" },
      },
    ];
    const adapter = buildDataForSeoKeywordAdapter(makeClient(items) as never, fakeCache);
    const result = await adapter.fetch(CTX);

    expect(result.keywords.keyword_count).toBe(3);
    // Only commercial + transactional count toward totalVolumeCommercial
    expect(result.keywords.total_volume_intent_commercial).toBe(7000);
    expect(result.keywords.top_keyword).toBe("koffiezetapparaten");
    // avg competition: (0.6 + 0.4 + 0.1) / 3 * 100 ≈ 37
    expect(result.keywords.avg_keyword_difficulty).toBeCloseTo(36.7, 0);
  });

  it("detects templated NL titles in SERP results", async () => {
    const serpItems = [
      { type: "organic", rank_absolute: 1, domain: "a.nl", title: "Beste koffiezetapparaten 2026" },
      { type: "organic", rank_absolute: 2, domain: "b.nl", title: "Vergelijking espressomachines" },
      { type: "organic", rank_absolute: 3, domain: "c.nl", title: "Philips HD7769 review" },
      { type: "organic", rank_absolute: 4, domain: "d.nl", title: "Koffie blog — recepten" },
    ];
    const items = [
      {
        keyword: "koffiezetapparaten",
        location_code: 2528,
        language_code: "nl",
        search_volume: 5000,
        competition: 0.5,
      },
    ];
    const adapter = buildDataForSeoKeywordAdapter(makeClient(items, serpItems) as never, fakeCache);
    const result = await adapter.fetch(CTX);

    // 3 of 4 titles match the NL commercial template pattern
    expect(result.serp.pct_top10_templated).toBeCloseTo(0.75, 2);
    expect(result.serp.unique_domains_avg).toBe(4);
  });

  it("returns empty signals gracefully when the client throws", async () => {
    const brokenClient = {
      post: vi.fn().mockRejectedValue(new Error("Network error")),
    };
    const adapter = buildDataForSeoKeywordAdapter(brokenClient as never, fakeCache);
    const result = await adapter.fetch(CTX);

    expect(result.keywords.keyword_count).toBe(0);
    expect(result.serp.pct_top10_templated).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Bol + Awin affiliate adapter
// ---------------------------------------------------------------------------

describe("buildBolAwinAffiliateAdapter", () => {
  function makeBolClient(totalResultSize: number) {
    return {
      request: vi.fn().mockResolvedValue({ products: [], totalResultSize }),
    };
  }

  function makeAwinClient(programmes: object[]) {
    return {
      publisherId: "12345",
      get: vi.fn().mockResolvedValue(programmes),
    };
  }

  it("returns undefined bol/awin when both clients are null", async () => {
    const adapter = buildBolAwinAffiliateAdapter(null, null);
    const result = await adapter.fetch(CTX);
    expect(result.bol).toBeUndefined();
    expect(result.awin).toBeUndefined();
    expect(result.median_epc_eur_overall).toBeNull();
  });

  it("returns bol product count when bol client is provided", async () => {
    const adapter = buildBolAwinAffiliateAdapter(makeBolClient(342) as never, null);
    const result = await adapter.fetch(CTX);
    expect(result.bol?.products).toBe(342);
    expect(result.awin).toBeUndefined();
  });

  it("returns awin advertiser count and programme names", async () => {
    const programmes = [
      { id: 1, name: "Coolblue", status: "active" },
      { id: 2, name: "Bol.com", status: "active" },
      { id: 3, name: "MediaMarkt", status: "active" },
    ];
    const adapter = buildBolAwinAffiliateAdapter(null, makeAwinClient(programmes) as never);
    const result = await adapter.fetch(CTX);

    expect(result.awin?.advertisers).toBe(3);
    expect(result.awin?.programs_with_offer).toEqual(["Coolblue", "Bol.com", "MediaMarkt"]);
  });

  it("returns empty awin signal gracefully when awin client throws", async () => {
    const brokenAwin = {
      publisherId: "12345",
      get: vi.fn().mockRejectedValue(new Error("Awin 401")),
    };
    const adapter = buildBolAwinAffiliateAdapter(null, brokenAwin as never);
    const result = await adapter.fetch(CTX);
    expect(result.awin).toBeUndefined();
  });

  it("combines bol and awin signals when both clients are active", async () => {
    const programmes = [{ id: 1, name: "Bol.com" }];
    const adapter = buildBolAwinAffiliateAdapter(
      makeBolClient(150) as never,
      makeAwinClient(programmes) as never,
    );
    const result = await adapter.fetch(CTX);
    expect(result.bol?.products).toBe(150);
    expect(result.awin?.advertisers).toBe(1);
  });
});
