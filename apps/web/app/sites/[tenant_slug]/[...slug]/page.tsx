// Phase 4 — published content catch-all renderer.
//
// Serves any page row with state='published' at its full_path, e.g.:
//   /stofzuigers/beste-stofzuiger-test
//   /staandbureau/goedkoop-staandbureau
//
// More-specific routes (/test/..., /ai-disclosure, sitemap.xml, robots.txt)
// are resolved by Next.js before this catch-all. A defensive prefix guard
// below ensures this route never accidentally serves those paths if routing
// order ever changes.
//
// CLAUDE.md non-negotiables enforced here:
//   #1  Only 'published' state is rendered publicly.
//   #4  AI-assisted badge + JSON-LD on every ai_assisted page.
//   #5  Affiliate disclosure is injected by the tenant layout.

import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AiAssistedBadge } from "../../../../components/AiAssistedBadge";
import { PUBLIC_PAGE_REVALIDATE_SECONDS, pageTag, tenantTag } from "../../../../lib/cache";
import { getServiceRoleSupabase } from "../../../../lib/supabase";

export const revalidate = 86_400;

// Paths that have dedicated routes — never serve them from the catch-all.
const RESERVED_PREFIXES = ["/test/", "/ai-disclosure", "/sitemap.xml", "/robots.txt"];

interface RouteParams {
  tenant_slug: string;
  slug: string[];
}

interface PageRow {
  id: string;
  title: string;
  meta_description: string | null;
  body_md: string;
  schema_jsonld: unknown;
  ai_disclosure_jsonld: unknown;
  ai_assisted: boolean;
  author_name: string;
  state: string;
  full_path: string;
  redirect_to_full_path: string | null;
  tenant_canonical_hostname: string | null;
  tenant_hreflang_active: boolean;
}

async function loadPageUncached(params: RouteParams): Promise<PageRow | null> {
  const fullPath = `/${params.slug.join("/")}`;
  if (RESERVED_PREFIXES.some((p) => fullPath.startsWith(p))) return null;

  const supabase = getServiceRoleSupabase();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, config")
    .eq("slug", params.tenant_slug)
    .eq("is_active", true)
    .maybeSingle();
  if (!tenant) return null;

  const tenantConfig = (tenant.config ?? {}) as Record<string, unknown>;

  const { data } = await supabase
    .from("pages")
    .select(
      "id, title, meta_description, body_md, schema_jsonld, ai_disclosure_jsonld, ai_assisted, author_name, state, full_path, redirect_to_full_path",
    )
    .eq("tenant_id", tenant.id)
    .eq("full_path", fullPath)
    .maybeSingle();

  if (!data) return null;
  return {
    ...(data as Omit<PageRow, "tenant_canonical_hostname" | "tenant_hreflang_active">),
    tenant_canonical_hostname: (tenantConfig.canonicalHostname as string) ?? null,
    tenant_hreflang_active: (tenantConfig.hreflangActive as boolean) ?? false,
  };
}

function loadPage(params: RouteParams): Promise<PageRow | null> {
  const fullPath = `/${params.slug.join("/")}`;
  return unstable_cache(
    () => loadPageUncached(params),
    ["public-page", params.tenant_slug, fullPath],
    {
      tags: [tenantTag(params.tenant_slug), pageTag(params.tenant_slug, fullPath)],
      revalidate: PUBLIC_PAGE_REVALIDATE_SECONDS,
    },
  )();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const resolved = await params;
  const page = await loadPage(resolved);
  if (!page || page.state !== "published") return { title: "Niet gevonden" };

  const canonicalBase = page.tenant_canonical_hostname
    ? `https://${page.tenant_canonical_hostname}`
    : null;
  const canonicalUrl = canonicalBase ? `${canonicalBase}${page.full_path}` : undefined;

  const alternates: Metadata["alternates"] = canonicalUrl ? { canonical: canonicalUrl } : undefined;
  if (canonicalBase && page.tenant_hreflang_active) {
    const url = `${canonicalBase}${page.full_path}`;
    (alternates as NonNullable<Metadata["alternates"]>).languages = {
      "nl-NL": url,
      "nl-BE": url,
      "x-default": url,
    };
  }

  return {
    title: page.title,
    description: page.meta_description ?? undefined,
    robots: { index: true, follow: true },
    alternates,
  };
}

export default async function PublishedPage({ params }: { params: Promise<RouteParams> }) {
  const resolved = await params;
  const page = await loadPage(resolved);

  if (!page) notFound();

  // Hard redirect — DB says this path moved.
  if (page.redirect_to_full_path) {
    const { redirect } = await import("next/navigation");
    redirect(page.redirect_to_full_path);
  }

  if (page.state !== "published") notFound();

  const schemaItems = Array.isArray(page.schema_jsonld) ? page.schema_jsonld : [];
  const aiDisclosure = page.ai_disclosure_jsonld ?? null;

  return (
    <article>
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "2rem", marginBottom: "0.25rem" }}>{page.title}</h1>
        <p style={{ fontSize: "0.875rem", color: "var(--brand-secondary)" }}>
          door {page.author_name} {page.ai_assisted ? <AiAssistedBadge /> : null}
        </p>
      </header>

      <div style={{ lineHeight: 1.65 }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.body_md}</ReactMarkdown>
      </div>

      {schemaItems.map((item, idx) => (
        <script
          // biome-ignore lint/suspicious/noArrayIndexKey: stable order from DB
          key={`schema-${idx}`}
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON.stringify is safe
          dangerouslySetInnerHTML={{ __html: JSON.stringify(item) }}
        />
      ))}
      {aiDisclosure ? (
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON.stringify is safe
          dangerouslySetInnerHTML={{ __html: JSON.stringify(aiDisclosure) }}
        />
      ) : null}
    </article>
  );
}
