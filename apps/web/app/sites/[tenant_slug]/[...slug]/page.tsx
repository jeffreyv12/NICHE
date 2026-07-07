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
import type React from "react";
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

function estimateReadingTime(md: string): number {
  return Math.max(1, Math.ceil(md.split(/\s+/).length / 200));
}

function categoryFromPath(fullPath: string): string | null {
  const seg = fullPath.split("/")[1];
  if (!seg) return null;
  return seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Custom ReactMarkdown component renderers
const mdComponents = {
  // Wrap tables for horizontal scroll on mobile
  table: ({ children, ...props }: React.ComponentPropsWithoutRef<"table">) => (
    <div
      style={{
        overflowX: "auto",
        margin: "1.5em 0",
        borderRadius: "0.5rem",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", margin: 0 }} {...props}>
        {children}
      </table>
    </div>
  ),
  // Headings with anchor IDs for TOC / in-page links
  h2: ({ children, ...props }: React.ComponentPropsWithoutRef<"h2">) => {
    const id = String(children)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    return (
      <h2 id={id} {...props}>
        {children}
      </h2>
    );
  },
  h3: ({ children, ...props }: React.ComponentPropsWithoutRef<"h3">) => {
    const id = String(children)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    return (
      <h3 id={id} {...props}>
        {children}
      </h3>
    );
  },
  // External links open in new tab
  a: ({ href, children, ...props }: React.ComponentPropsWithoutRef<"a">) => {
    const isExternal = href?.startsWith("http");
    return (
      <a
        href={href}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
        {...props}
      >
        {children}
      </a>
    );
  },
};

export default async function PublishedPage({ params }: { params: Promise<RouteParams> }) {
  const resolved = await params;
  const page = await loadPage(resolved);

  if (!page) notFound();

  if (page.redirect_to_full_path) {
    const { redirect } = await import("next/navigation");
    redirect(page.redirect_to_full_path);
  }

  if (page.state !== "published") notFound();

  const schemaItems = Array.isArray(page.schema_jsonld) ? page.schema_jsonld : [];
  const aiDisclosure = page.ai_disclosure_jsonld ?? null;
  const readingTime = estimateReadingTime(page.body_md);
  const category = categoryFromPath(page.full_path);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: "2rem",
        maxWidth: 860,
        margin: "0 auto",
      }}
    >
      {/* Breadcrumb */}
      {category && (
        <nav
          aria-label="Breadcrumb"
          style={{
            fontSize: "0.8125rem",
            color: "#94a3b8",
            display: "flex",
            gap: "0.375rem",
            alignItems: "center",
          }}
        >
          <a href="/" style={{ color: "#64748b", textDecoration: "none" }}>
            Home
          </a>
          <span aria-hidden>›</span>
          <span style={{ color: "#1e293b", fontWeight: 500 }}>{category}</span>
        </nav>
      )}

      <article>
        {/* Article Header */}
        <header
          style={{
            marginBottom: "2rem",
            paddingBottom: "1.5rem",
            borderBottom: "2px solid #e2e8f0",
          }}
        >
          <h1
            style={{
              fontFamily: "var(--font-heading, Rubik, sans-serif)",
              fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
              fontWeight: 700,
              lineHeight: 1.2,
              color: "#0f172a",
              margin: "0 0 1rem",
              letterSpacing: "-0.02em",
            }}
          >
            {page.title}
          </h1>

          {/* Meta bar */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "0.75rem",
              fontSize: "0.875rem",
              color: "#64748b",
            }}
          >
            {/* Author chip */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #2563eb, #3b82f6)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                {page.author_name.charAt(0).toUpperCase()}
              </span>
              <span style={{ fontWeight: 500, color: "#334155" }}>{page.author_name}</span>
            </div>

            <span aria-hidden style={{ color: "#cbd5e1" }}>
              ·
            </span>

            {/* Reading time */}
            <span style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {readingTime} min leestijd
            </span>

            {/* AI badge */}
            {page.ai_assisted && (
              <>
                <span aria-hidden style={{ color: "#cbd5e1" }}>
                  ·
                </span>
                <AiAssistedBadge />
              </>
            )}
          </div>
        </header>

        {/* Article body */}
        <div className="prose" style={{ maxWidth: "none" }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            // biome-ignore lint/suspicious/noExplicitAny: react-markdown types
            components={mdComponents as any}
          >
            {page.body_md}
          </ReactMarkdown>
        </div>

        {/* Trust signal footer */}
        <footer
          style={{
            marginTop: "3rem",
            paddingTop: "1.5rem",
            borderTop: "1px solid #e2e8f0",
            background: "#f8fafc",
            borderRadius: "0.75rem",
            padding: "1.25rem 1.5rem",
            display: "flex",
            gap: "0.75rem",
            alignItems: "flex-start",
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#2563eb"
            strokeWidth="2"
            style={{ flexShrink: 0, marginTop: 2 }}
            aria-hidden="true"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <div style={{ fontSize: "0.8125rem", color: "#475569", lineHeight: 1.6 }}>
            <strong
              style={{ color: "#1e293b", fontFamily: "var(--font-heading, Rubik, sans-serif)" }}
            >
              Onafhankelijk advies
            </strong>
            <p style={{ margin: "0.25rem 0 0" }}>
              Wij vergelijken producten op basis van objectieve criteria. Onze redactie wordt niet
              betaald door fabrikanten om producten aan te bevelen. Commissies via affiliate links
              helpen ons deze vergelijkingen gratis aan te bieden.
            </p>
          </div>
        </footer>
      </article>

      {/* JSON-LD structured data */}
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
    </div>
  );
}
