// Phase 3.1 — public test-page renderer.
//
// Serves a `pages` row drafted by the Content Agent for a niche in
// validation. Test pages MUST be in state=approved or state=published —
// drafts are admin-only (CLAUDE.md non-negotiable #1).
//
// AffiliateDisclosure is injected by the tenant layout. AI-assisted badge
// + AI disclosure JSON-LD are rendered here per CLAUDE.md non-negotiable #4.

import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AiAssistedBadge } from "../../../../../../components/AiAssistedBadge";
import { PUBLIC_PAGE_REVALIDATE_SECONDS, pageTag, tenantTag } from "../../../../../../lib/cache";
import { getServiceRoleSupabase } from "../../../../../../lib/supabase";

// ISR: a published test page is served from cache and refreshed at most daily;
// a publish/edit busts its tag immediately (see approvePageAction).
export const revalidate = 86_400;

interface RouteParams {
  tenant_slug: string;
  niche_slug: string;
  page_slug: string;
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
}

const VISIBLE_STATES = new Set(["approved", "published"]);

async function loadPageUncached(params: RouteParams): Promise<PageRow | null> {
  const supabase = getServiceRoleSupabase();

  // Resolve tenant first so the query is tenant-scoped (defence-in-depth even
  // though full_path includes the niche slug).
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", params.tenant_slug)
    .eq("is_active", true)
    .maybeSingle();
  if (!tenant) return null;

  const fullPath = `/test/${params.niche_slug}/${params.page_slug}`;
  const { data, error } = await supabase
    .from("pages")
    .select(
      "id, title, meta_description, body_md, schema_jsonld, ai_disclosure_jsonld, ai_assisted, author_name, state, full_path",
    )
    .eq("tenant_id", tenant.id)
    .eq("full_path", fullPath)
    .maybeSingle();

  if (error || !data) return null;
  return data as PageRow;
}

/** ISR-cached page read, tagged so a publish/edit can invalidate it on demand. */
function loadPage(params: RouteParams): Promise<PageRow | null> {
  const fullPath = `/test/${params.niche_slug}/${params.page_slug}`;
  return unstable_cache(
    () => loadPageUncached(params),
    ["public-test-page", params.tenant_slug, fullPath],
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
  if (!page || !VISIBLE_STATES.has(page.state)) return { title: "Niet gevonden" };
  return {
    title: page.title,
    description: page.meta_description ?? undefined,
    // Test pages must not bleed into Google before they're real (CLAUDE.md
    // doesn't ban it, but indexing a /test/ URL is operationally noisy).
    robots: { index: false, follow: true },
  };
}

export default async function TestPage({ params }: { params: Promise<RouteParams> }) {
  const resolved = await params;
  const page = await loadPage(resolved);
  if (!page || !VISIBLE_STATES.has(page.state)) notFound();

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
