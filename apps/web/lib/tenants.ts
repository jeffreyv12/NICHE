// Tenant lookup: by hostname (own-domain tenants) or by hostname+path-prefix
// (subfolder tenants on the main authority domain).
//
// Cached in KV (Vercel KV in prod, in-memory in local dev) with 60s TTL so
// we don't hit Supabase on every request.

import { getServiceRoleSupabase } from './supabase';
import { kvGet, kvSet } from './kv';

export interface Tenant {
  id: string;
  slug: string;
  kind: 'main_authority' | 'subfolder_niche' | 'promoted_niche';
  hostname: string | null;
  path_prefix: string | null;
  is_active: boolean;
  is_promoted: boolean;
  config: Record<string, unknown>;
}

const TTL_SECONDS = 60;
const cacheKey = (hostname: string) => `tenant:host:${hostname.toLowerCase()}`;

/**
 * Resolve the tenant for an incoming hostname.
 *
 * Lookup order:
 *   1. Cache hit on hostname
 *   2. tenants WHERE lower(hostname) = lower(host) AND is_active
 *
 * Returns null on no-match — the middleware decides whether that means 404 or
 * "main authority domain with no subfolder match".
 */
export async function getTenantByHostname(hostname: string): Promise<Tenant | null> {
  if (!hostname) return null;
  // Strip port (host header may be "expertgids.local:3000")
  const host = hostname.split(':')[0]!.toLowerCase();

  const cached = await kvGet<Tenant | { __miss: true }>(cacheKey(host));
  if (cached) {
    return '__miss' in cached ? null : cached;
  }

  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('tenants')
    .select('id, slug, kind, hostname, path_prefix, is_active, is_promoted, config')
    .eq('hostname', host)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('[tenants] lookup error', error);
    return null;
  }

  if (!data) {
    // Cache the miss too so we don't hammer Supabase for unknown hosts
    await kvSet(cacheKey(host), { __miss: true }, TTL_SECONDS);
    return null;
  }

  const tenant = data as unknown as Tenant;
  await kvSet(cacheKey(host), tenant, TTL_SECONDS);
  return tenant;
}

/**
 * For a main-authority tenant, find the subfolder tenant whose path_prefix
 * matches the start of the request path. Returns null if none.
 */
export async function getSubfolderTenantForPath(path: string): Promise<Tenant | null> {
  // Subfolders are short identifiers like /koffie, /fietsen, /test/[slug]/...
  // Look at the first path segment.
  const seg = path.split('/').filter(Boolean)[0];
  if (!seg) return null;
  const prefix = `/${seg}`;

  const cacheKeyPath = `tenant:path:${prefix}`;
  const cached = await kvGet<Tenant | { __miss: true }>(cacheKeyPath);
  if (cached) return '__miss' in cached ? null : cached;

  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('tenants')
    .select('id, slug, kind, hostname, path_prefix, is_active, is_promoted, config')
    .eq('path_prefix', prefix)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('[tenants] subfolder lookup error', error);
    return null;
  }

  if (!data) {
    await kvSet(cacheKeyPath, { __miss: true }, TTL_SECONDS);
    return null;
  }
  const tenant = data as unknown as Tenant;
  await kvSet(cacheKeyPath, tenant, TTL_SECONDS);
  return tenant;
}
