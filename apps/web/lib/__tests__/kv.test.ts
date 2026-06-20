import { afterEach, describe, expect, it, vi } from "vitest";
import { _clearMemoryKv, kvGet, kvSet } from "../kv.js";

// ---------------------------------------------------------------------------
// Force local-dev path (no Vercel KV) for all tests.
// ---------------------------------------------------------------------------
afterEach(() => {
  vi.unstubAllEnvs();
  _clearMemoryKv();
});

describe("kvGet / kvSet — in-memory fallback (no Vercel KV creds)", () => {
  it("returns null for a key that was never set", async () => {
    expect(await kvGet("missing-key")).toBeNull();
  });

  it("stores and retrieves a value within TTL", async () => {
    await kvSet("user:42", { name: "Jeff" }, 60);
    expect(await kvGet<{ name: string }>("user:42")).toEqual({ name: "Jeff" });
  });

  it("returns null after the TTL has expired", async () => {
    vi.useFakeTimers();
    await kvSet("short-ttl", "hello", 1);
    vi.advanceTimersByTime(1500);
    expect(await kvGet("short-ttl")).toBeNull();
    vi.useRealTimers();
  });

  it("_clearMemoryKv removes all entries", async () => {
    await kvSet("a", 1, 60);
    await kvSet("b", 2, 60);
    _clearMemoryKv();
    expect(await kvGet("a")).toBeNull();
    expect(await kvGet("b")).toBeNull();
  });

  it("stores falsy values correctly (0, false, empty string)", async () => {
    await kvSet("zero", 0, 60);
    await kvSet("flag", false, 60);
    await kvSet("empty", "", 60);
    expect(await kvGet("zero")).toBe(0);
    expect(await kvGet("flag")).toBe(false);
    expect(await kvGet("empty")).toBe("");
  });

  it("overwrites an existing key with a new value", async () => {
    await kvSet("key", "first", 60);
    await kvSet("key", "second", 60);
    expect(await kvGet("key")).toBe("second");
  });
});
