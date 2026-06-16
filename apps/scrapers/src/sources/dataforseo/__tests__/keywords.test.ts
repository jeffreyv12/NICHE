import { describe, expect, it, vi } from "vitest";
import { keywordOverview, relatedKeywords } from "../keywords.js";
import { DataForSeoError } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function neverCache() {
  return {
    get: async () => null,
    set: async () => {},
  };
}

function makeClient(response: unknown) {
  return { post: vi.fn(async () => response) };
}

function kwOverviewEnvelope(items: unknown[]) {
  return {
    tasks: [{ status_code: 20000, status_message: "Ok.", result: items }],
  };
}

function relatedEnvelope(innerItems: unknown[]) {
  return {
    tasks: [
      {
        status_code: 20000,
        status_message: "Ok.",
        result: [{ items: innerItems }],
      },
    ],
  };
}

const KW_ITEM = {
  keyword: "beste koffiemolen",
  location_code: 2528,
  language_code: "nl",
  search_volume: 3200,
  cpc: 0.45,
  competition: 0.31,
};

const RELATED_ITEM = {
  keyword_data: {
    keyword: "koffiemolen kopen",
    location_code: 2528,
    language_code: "nl",
    search_volume: 1800,
  },
};

const KW_REQ = {
  keywords: ["beste koffiemolen"],
  location_code: 2528 as const,
  language_code: "nl" as const,
};

const RELATED_REQ = {
  keyword: "koffiemolen",
  location_code: 2528 as const,
  language_code: "nl" as const,
  depth: 2,
  limit: 100,
};

// ---------------------------------------------------------------------------
// keywordOverview
// ---------------------------------------------------------------------------

describe("keywordOverview", () => {
  it("returns parsed items from a successful envelope", async () => {
    const client = makeClient(kwOverviewEnvelope([KW_ITEM]));
    const result = await keywordOverview(client as never, neverCache(), KW_REQ);
    expect(result).toHaveLength(1);
    expect(result[0]?.keyword).toBe("beste koffiemolen");
    expect(result[0]?.search_volume).toBe(3200);
  });

  it("throws DataForSeoError when task status_code is not 20000", async () => {
    const client = makeClient({
      tasks: [{ status_code: 40501, status_message: "Task Not Found." }],
    });
    await expect(keywordOverview(client as never, neverCache(), KW_REQ)).rejects.toBeInstanceOf(
      DataForSeoError,
    );
  });

  it("throws DataForSeoError when tasks array is empty", async () => {
    const client = makeClient({ tasks: [] });
    await expect(keywordOverview(client as never, neverCache(), KW_REQ)).rejects.toBeInstanceOf(
      DataForSeoError,
    );
  });

  it("silently skips items that fail Zod validation", async () => {
    const badItem = { keyword: 42 }; // keyword must be string
    const client = makeClient(kwOverviewEnvelope([KW_ITEM, badItem]));
    const result = await keywordOverview(client as never, neverCache(), KW_REQ);
    expect(result).toHaveLength(1);
    expect(result[0]?.keyword).toBe("beste koffiemolen");
  });

  it("returns empty array when result is empty", async () => {
    const client = makeClient(kwOverviewEnvelope([]));
    const result = await keywordOverview(client as never, neverCache(), KW_REQ);
    expect(result).toEqual([]);
  });

  it("returns cached value and skips the HTTP call on second request", async () => {
    const cache = new Map<string, { value: string; expiresAt: number }>();
    const backend = {
      get: async (k: string) => {
        const e = cache.get(k);
        return e && e.expiresAt > Date.now() ? e.value : null;
      },
      set: async (k: string, v: string, ttlMs: number) => {
        cache.set(k, { value: v, expiresAt: Date.now() + ttlMs });
      },
    };
    const client = makeClient(kwOverviewEnvelope([KW_ITEM]));
    await keywordOverview(client as never, backend, KW_REQ);
    await keywordOverview(client as never, backend, KW_REQ);
    expect(client.post).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// relatedKeywords
// ---------------------------------------------------------------------------

describe("relatedKeywords", () => {
  it("extracts nested items from the result array", async () => {
    const client = makeClient(relatedEnvelope([RELATED_ITEM]));
    const result = await relatedKeywords(client as never, neverCache(), RELATED_REQ);
    expect(result).toHaveLength(1);
    expect(result[0]?.keyword_data?.keyword).toBe("koffiemolen kopen");
  });

  it("throws DataForSeoError when task status_code is not 20000", async () => {
    const client = makeClient({
      tasks: [{ status_code: 40501, status_message: "Task Not Found." }],
    });
    await expect(
      relatedKeywords(client as never, neverCache(), RELATED_REQ),
    ).rejects.toBeInstanceOf(DataForSeoError);
  });

  it("returns empty array when result rows have no inner items", async () => {
    const client = makeClient(relatedEnvelope([]));
    const result = await relatedKeywords(client as never, neverCache(), RELATED_REQ);
    expect(result).toEqual([]);
  });

  it("skips result rows missing an items array without throwing", async () => {
    const envelope = {
      tasks: [
        {
          status_code: 20000,
          status_message: "Ok.",
          result: [{ noItems: true }, { items: [RELATED_ITEM] }],
        },
      ],
    };
    const client = makeClient(envelope);
    const result = await relatedKeywords(client as never, neverCache(), RELATED_REQ);
    expect(result).toHaveLength(1);
  });
});
