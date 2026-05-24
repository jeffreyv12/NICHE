// Tiny KV abstraction: Vercel KV in production/preview, in-memory Map fallback
// for local dev. The shape mirrors @vercel/kv's get/set with TTL.
//
// Used by lib/tenants.ts to cache hostname→tenant lookups for 60s.

import { kv as vercelKv } from '@vercel/kv';

interface MemoryEntry {
  value: unknown;
  expiresAt: number;
}

const memoryStore = new Map<string, MemoryEntry>();

function hasVercelKv(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export async function kvGet<T>(key: string): Promise<T | null> {
  if (hasVercelKv()) {
    const v = await vercelKv.get<T>(key);
    return v ?? null;
  }
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value as T;
}

export async function kvSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  if (hasVercelKv()) {
    await vercelKv.set(key, value, { ex: ttlSeconds });
    return;
  }
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/** Test/debug only. */
export function _clearMemoryKv(): void {
  memoryStore.clear();
}
