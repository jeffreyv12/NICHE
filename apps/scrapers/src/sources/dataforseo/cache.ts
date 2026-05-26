import { createHash } from "node:crypto";

// In-memory query cache. The plan in DATA_SOURCES.md is to back this with
// Postgres later (see `claim_sources`-style table), but the public surface
// here is a deliberately tiny KV interface so the swap is a one-file change.

export interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}

// Stable JSON: sorts object keys recursively so {a:1,b:2} and {b:2,a:1} hash
// the same. Tracking params like our internal `tag` would mutate keys
// arbitrarily — strip them at the call site, not here.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function cacheKey(endpoint: string, body: unknown): string {
  const hash = createHash("sha256").update(stableStringify(body)).digest("hex");
  return `dfs:${endpoint}:${hash.slice(0, 32)}`;
}

interface MemEntry {
  value: string;
  expiresAt: number;
}

export class MemoryCache implements CacheBackend {
  private store = new Map<string, MemEntry>();

  async get(key: string): Promise<string | null> {
    const e = this.store.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return e.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Wraps any async fn with a cache-aside read-through.
export async function withCache<T>(
  backend: CacheBackend,
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = await backend.get(key);
  if (cached !== null) return JSON.parse(cached) as T;
  const fresh = await fetcher();
  await backend.set(key, JSON.stringify(fresh), ttlMs);
  return fresh;
}
