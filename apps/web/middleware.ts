// Edge middleware — runs on every request before any route handler.
// Three concerns, in order:
//  1. Skip Next.js internals, static assets, and webhook/redirect/api routes
//  2. Resolve tenant by hostname (+ for main authority, by first path segment)
//  3. Rewrite to the internal /sites/[tenant_slug] route, leaving the visible URL untouched
//
// Tenant lookup is cached in KV with 60s TTL (see lib/tenants.ts), so the
// per-request cost is negligible after the first hit per cache window.

import { buildPromotedRedirectTarget } from "@nichefinder/shared";
import { type NextRequest, NextResponse } from "next/server";
import {
  getRedirectForSubfolder,
  getSubfolderTenantForPath,
  getTenantByHostname,
} from "./lib/tenants";

// Paths the middleware never touches: Next internals, static, admin (handled
// by its own auth gate), webhooks (must be reachable without tenant context),
// and the affiliate redirect + api routes.
const PASSTHROUGH_PREFIXES = [
  "/_next",
  "/admin",
  "/auth",
  "/api",
  "/r/",
  "/webhooks",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  for (const p of PASSTHROUGH_PREFIXES) {
    if (pathname === p || pathname.startsWith(p)) {
      return NextResponse.next();
    }
  }

  const hostname = request.headers.get("host") ?? "";
  const tenant = await getTenantByHostname(hostname);

  if (!tenant) {
    // Unknown hostname → render the root fallback page (which suggests fixing env)
    return NextResponse.next();
  }

  // CASE A: a promoted-niche dedicated domain → rewrite straight through
  if (tenant.kind === "promoted_niche") {
    const url = request.nextUrl.clone();
    url.pathname = `/sites/${tenant.slug}${pathname}`;
    return NextResponse.rewrite(url);
  }

  // CASE B: main authority — check first path segment for a subfolder tenant
  if (tenant.kind === "main_authority") {
    const seg = pathname.split("/").filter(Boolean)[0];
    const prefix = seg ? `/${seg}` : null;

    // Phase 5.5.3: if the subfolder niche has been promoted to its own domain,
    // issue a permanent redirect before any rewrite. The redirect target is the
    // niche's own hostname with the remainder of the path preserved.
    if (prefix) {
      const redirect = await getRedirectForSubfolder(prefix);
      if (redirect) {
        // Preserve the path remainder AND the query string across the 308
        // (a permanent redirect is browser-cached, so a dropped query is lost
        // for good — see @nichefinder/shared/promotedRedirect).
        const target = buildPromotedRedirectTarget({
          hostname: redirect.hostname,
          pathname,
          prefix,
          search: request.nextUrl.search,
        });
        return NextResponse.redirect(target, 308);
      }
    }

    const sub = await getSubfolderTenantForPath(pathname);
    if (sub) {
      const url = request.nextUrl.clone();
      const trimmed = pathname.slice(sub.path_prefix?.length ?? 0) || "/";
      url.pathname = `/sites/${sub.slug}${trimmed}`;
      return NextResponse.rewrite(url);
    }
    // No subfolder match — render the main tenant's own pages
    const url = request.nextUrl.clone();
    url.pathname = `/sites/${tenant.slug}${pathname}`;
    return NextResponse.rewrite(url);
  }

  // CASE C: subfolder-niche row reached directly (unusual; treat as main flow)
  const url = request.nextUrl.clone();
  url.pathname = `/sites/${tenant.slug}${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Run on everything except Next internals + static files
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js)$).*)"],
};
