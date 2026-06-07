// Phase 4.4.3 — IndexNow URL submission to Bing.
//
// Called fire-and-forget after a page is approved/published. Only fires when
// BING_INDEXNOW_KEY is set. Failures are logged but never bubble up to the
// user — the operator action must succeed regardless of search-engine pings.
//
// IndexNow protocol: GET https://www.bing.com/indexnow?url=<page>&key=<key>
// A 200 means Bing accepted the ping. Any other status is silent.

const INDEXNOW_ENDPOINT = "https://www.bing.com/indexnow";

/**
 * Submits a canonical public URL to Bing IndexNow.
 * No-op when BING_INDEXNOW_KEY is not set.
 * Must be called fire-and-forget — never await at a gate.
 */
export async function pingIndexNow(canonicalUrl: string): Promise<void> {
  const key = process.env.BING_INDEXNOW_KEY;
  if (!key) return;

  const ping = `${INDEXNOW_ENDPOINT}?url=${encodeURIComponent(canonicalUrl)}&key=${encodeURIComponent(key)}`;
  try {
    await fetch(ping, { method: "GET", signal: AbortSignal.timeout(5_000) });
  } catch {
    // Network error or timeout — silent; IndexNow is best-effort.
  }
}

/**
 * Build the canonical public URL for a page on a tenant site.
 * Falls back to a relative path when NEXT_PUBLIC_ROOT_DOMAIN is not set.
 */
export function buildCanonicalUrl(tenantSlug: string, fullPath: string): string {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  if (!rootDomain) return fullPath;
  // Multi-tenant: tenant is a subdirectory on the root domain.
  // e.g. https://nichefinder.nl/[tenant_slug]/test/niche/page
  return `https://${rootDomain}/sites/${tenantSlug}${fullPath}`;
}
