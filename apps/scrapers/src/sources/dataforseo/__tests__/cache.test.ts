import { describe, expect, it, vi } from "vitest";
import { MemoryCache, cacheKey, withCache } from "../cache.js";

describe("cacheKey", () => {
  it("is stable across key order in the body", () => {
    const a = cacheKey("/x", { a: 1, b: 2, nested: { c: 3, d: 4 } });
    const b = cacheKey("/x", { nested: { d: 4, c: 3 }, b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it("changes when the endpoint changes", () => {
    expect(cacheKey("/x", { k: 1 })).not.toBe(cacheKey("/y", { k: 1 }));
  });
});

describe("MemoryCache + withCache", () => {
  it("returns cached value on second call without invoking fetcher", async () => {
    const cache = new MemoryCache();
    const fetcher = vi.fn(async () => ({ n: 1 }));
    const a = await withCache(cache, "k", 10_000, fetcher);
    const b = await withCache(cache, "k", 10_000, fetcher);
    expect(a).toEqual({ n: 1 });
    expect(b).toEqual({ n: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("expires entries after the TTL", async () => {
    vi.useFakeTimers();
    const cache = new MemoryCache();
    let n = 0;
    const fetcher = async () => ({ n: ++n });
    await withCache(cache, "k", 1_000, fetcher);
    vi.advanceTimersByTime(1_500);
    const b = await withCache(cache, "k", 1_000, fetcher);
    expect(b).toEqual({ n: 2 });
    vi.useRealTimers();
  });
});
