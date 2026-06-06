// Phase 4.4 — ISR cache tags for public pages.
//
// Public pages are rendered with ISR (revalidate = 24h) and their data reads
// are tagged so a publish/edit can invalidate exactly the affected page and
// tenant on demand (revalidateTag), rather than waiting out the 24h window.
//
// Pure string helpers only — safe to import from both the renderer and server
// actions. The actual revalidateTag() calls live in the server actions.

/** Default ISR window for public pages: 24h. */
export const PUBLIC_PAGE_REVALIDATE_SECONDS = 86_400;

/** Tag covering everything rendered for a tenant. */
export function tenantTag(tenantSlug: string): string {
  return `tenant:${tenantSlug}`;
}

/** Tag covering a single public page (scoped by tenant + full path). */
export function pageTag(tenantSlug: string, fullPath: string): string {
  return `page:${tenantSlug}:${fullPath}`;
}
