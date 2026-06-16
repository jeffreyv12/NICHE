import { describe, expect, it, vi } from "vitest";
import { serpOrganic } from "../serp.js";
import { DataForSeoError, DataForSeoTimeoutError } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function neverCache() {
  return { get: async () => null, set: async () => {} };
}

const ORGANIC_ITEM = {
  type: "organic",
  rank_group: 1,
  rank_absolute: 1,
  url: "https://example.nl/beste-koffiemolen",
  title: "Beste Koffiemolen 2026",
  description: "Overzicht van de beste koffiemolens.",
};

const FEATURED_ITEM = {
  type: "featured_snippet",
  url: "https://featured.nl",
  title: "Featured",
};

function serpEnvelope(items: unknown[]) {
  return {
    tasks: [{ status_code: 20000, result: [{ items }] }],
  };
}

const LIVE_REQ = {
  keyword: "beste koffiemolen",
  location_code: 2528 as const,
  language_code: "nl" as const,
  depth: 10,
  mode: "live" as const,
};

const QUEUE_REQ = {
  keyword: "beste koffiemolen",
  location_code: 2528 as const,
  language_code: "nl" as const,
  depth: 10,
  mode: "standard" as const,
};

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------

describe("serpOrganic — live mode", () => {
  it("returns organic items from a live response", async () => {
    const client = { post: vi.fn(async () => serpEnvelope([ORGANIC_ITEM])) };
    const result = await serpOrganic(client as never, neverCache(), LIVE_REQ);
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toBe("https://example.nl/beste-koffiemolen");
  });

  it("filters out non-organic item types", async () => {
    const client = {
      post: vi.fn(async () => serpEnvelope([ORGANIC_ITEM, FEATURED_ITEM])),
    };
    const result = await serpOrganic(client as never, neverCache(), LIVE_REQ);
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("organic");
  });

  it("throws DataForSeoError when task status_code indicates an error", async () => {
    const client = {
      post: vi.fn(async () => ({
        tasks: [{ status_code: 40401, status_message: "Not Found." }],
      })),
    };
    await expect(serpOrganic(client as never, neverCache(), LIVE_REQ)).rejects.toBeInstanceOf(
      DataForSeoError,
    );
  });

  it("returns cached result and skips the HTTP call on second request", async () => {
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
    const client = { post: vi.fn(async () => serpEnvelope([ORGANIC_ITEM])) };
    await serpOrganic(client as never, backend, LIVE_REQ);
    await serpOrganic(client as never, backend, LIVE_REQ);
    expect(client.post).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Queue (standard_quality) mode
// ---------------------------------------------------------------------------

describe("serpOrganic — queue mode", () => {
  it("posts a task and polls until status 20000, then returns items", async () => {
    const sleep = vi.fn(async () => {});
    let pollCalls = 0;
    const client = {
      post: vi.fn(async (endpoint: string) => {
        if (endpoint.includes("task_post")) {
          return { tasks: [{ id: "task-xyz", status_code: 20100 }] };
        }
        // First poll: in queue; second poll: done.
        pollCalls++;
        if (pollCalls === 1) {
          return { tasks: [{ status_code: 40601, status_message: "Task in Queue." }] };
        }
        return serpEnvelope([ORGANIC_ITEM]);
      }),
    };

    const result = await serpOrganic(client as never, neverCache(), QUEUE_REQ, {
      intervalMs: 0,
      maxWaitMs: 60_000,
      sleep,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.url).toBe("https://example.nl/beste-koffiemolen");
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("throws DataForSeoError when task_post returns a non-20100 status", async () => {
    const client = {
      post: vi.fn(async () => ({
        tasks: [{ id: "t1", status_code: 40000, status_message: "Bad Request." }],
      })),
    };
    await expect(
      serpOrganic(client as never, neverCache(), QUEUE_REQ, { sleep: async () => {} }),
    ).rejects.toBeInstanceOf(DataForSeoError);
  });

  it("throws DataForSeoTimeoutError when maxWaitMs is 0", async () => {
    const client = {
      post: vi.fn(async (endpoint: string) => {
        if (endpoint.includes("task_post")) {
          return { tasks: [{ id: "task-xyz", status_code: 20100 }] };
        }
        return { tasks: [{ status_code: 40601 }] };
      }),
    };
    await expect(
      serpOrganic(client as never, neverCache(), QUEUE_REQ, {
        intervalMs: 0,
        maxWaitMs: 0,
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(DataForSeoTimeoutError);
  });

  it("throws DataForSeoError on unexpected poll status code", async () => {
    const client = {
      post: vi.fn(async (endpoint: string) => {
        if (endpoint.includes("task_post")) {
          return { tasks: [{ id: "task-xyz", status_code: 20100 }] };
        }
        return { tasks: [{ status_code: 40401, status_message: "Not Found." }] };
      }),
    };
    await expect(
      serpOrganic(client as never, neverCache(), QUEUE_REQ, {
        sleep: async () => {},
        maxWaitMs: 60_000,
      }),
    ).rejects.toBeInstanceOf(DataForSeoError);
  });
});
