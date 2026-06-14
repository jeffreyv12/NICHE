// Phase 4.4.3 — per-tenant sitemap.xml.
//
// Served at /sitemap.xml on each tenant host (middleware rewrites the hostname
// to /sites/<slug>/...). Lists only PUBLISHED, non-test pages: test pages are
// robots-noindex during validation and must not be advertised. The page read is
// ISR-cached and tagged tenant:<slug>, so a publish busts it via the same
// revalidateTag the approval flow already calls.
//
// IndexNow / GSC submission (the push half of 4.4.3) is deferred — it needs the
// IndexNow key + outward calls, better wired with operator config.

import { buildSitemapXml } from "@nichefinder/shared";
import { unstable_cache } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { PUBLIC_PAGE_REVALIDATE_SECONDS, tenantTag } from "../../../../lib/cache";
import { getServiceRoleSupabase } from "../../../../lib/supabase";

export const revalidate = 86_400;
export const runtime = "nodejs";

interface SitemapRow {
  full_path: string;
  updated_at: string | null;
}

async function loadPublishedPathsUncached(tenantSlug: string): Promise<SitemapRow[]> {
  const supabase = getServiceRoleSupabase();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .eq("is_active", true)
    .maybeSingle();
  if (!tenant) return [];

  const { data } = (await supabase
    .from("pages")
    .select("full_path, updated_at")
    .eq("tenant_id", tenant.id)
    .eq("state", "published")
    .neq("kind", "test_page")
    .order("updated_at", { ascending: false })) as { data: SitemapRow[] | null };
  return data ?? [];
}

function loadPublishedPaths(tenantSlug: string): Promise<SitemapRow[]> {
  return unstable_cache(() => loadPublishedPathsUncached(tenantSlug), ["sitemap", tenantSlug], {
    tags: [tenantTag(tenantSlug)],
    revalidate: PUBLIC_PAGE_REVALIDATE_SECONDS,
  })();
}

interface RouteContext {
  params: Promise<{ tenant_slug: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { tenant_slug } = await context.params;
  const origin = new URL(request.url).origin;
  const rows = await loadPublishedPaths(tenant_slug);

  const body = buildSitemapXml(
    origin,
    rows.map((r) => ({ path: r.full_path, lastmod: r.updated_at })),
  );

  return new NextResponse(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=86400",
    },
  });
}
