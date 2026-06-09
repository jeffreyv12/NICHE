// Tenant topic-hub homepage.
//
// Lists all published pages for this tenant, grouped by niche. Acts as the
// main entry point for visitors — a directory of all live content.
// Falls back gracefully when no pages are published yet (fresh deployment).

import { unstable_cache } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { tenantTag } from "../../../lib/cache";
import { getServiceRoleSupabase } from "../../../lib/supabase";

export const revalidate = 3_600; // Refresh at most hourly; publish busts the tenant tag.

interface PageProps {
  params: Promise<{ tenant_slug: string }>;
}

interface NicheGroup {
  nicheId: string | null;
  nicheTopic: string | null;
  nicheSlug: string | null;
  pages: Array<{ title: string; full_path: string; kind: string }>;
}

interface TenantData {
  brandName: string;
  groups: NicheGroup[];
}

async function loadUncached(tenantSlug: string): Promise<TenantData | null> {
  const supabase = getServiceRoleSupabase();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, config")
    .eq("slug", tenantSlug)
    .eq("is_active", true)
    .maybeSingle();
  if (!tenant) return null;

  const brandName =
    (tenant.config as { brand?: { name?: string } } | null)?.brand?.name ?? tenantSlug;

  // Fetch published pages with their niche info in one join.
  const { data: rows } = await supabase
    .from("pages")
    .select("title, full_path, kind, niche_id, niches(topic, topic_slug)")
    .eq("tenant_id", tenant.id)
    .eq("state", "published")
    .not("full_path", "like", "/test/%")
    .order("full_path");

  // Supabase returns related rows as an array even for belongs-to relations.
  type NicheRel = Array<{ topic: string; topic_slug: string }>;
  type Row = {
    title: string;
    full_path: string;
    kind: string;
    niche_id: string | null;
    niches: NicheRel | null;
  };

  const groupMap = new Map<string | null, NicheGroup>();
  for (const row of (rows ?? []) as unknown as Row[]) {
    const niche = Array.isArray(row.niches) ? (row.niches[0] ?? null) : null;
    const key = row.niche_id ?? "__ungrouped__";
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        nicheId: row.niche_id,
        nicheTopic: niche?.topic ?? null,
        nicheSlug: niche?.topic_slug ?? null,
        pages: [],
      });
    }
    groupMap.get(key)?.pages.push({
      title: row.title,
      full_path: row.full_path,
      kind: row.kind,
    });
  }

  // Sort groups: named niches first (alphabetically), ungrouped last.
  const groups = [...groupMap.values()].sort((a, b) => {
    if (!a.nicheTopic) return 1;
    if (!b.nicheTopic) return -1;
    return a.nicheTopic.localeCompare(b.nicheTopic, "nl");
  });

  return { brandName, groups };
}

function loadTenant(tenantSlug: string): Promise<TenantData | null> {
  return unstable_cache(() => loadUncached(tenantSlug), ["tenant-hub", tenantSlug], {
    tags: [tenantTag(tenantSlug)],
    revalidate: 3_600,
  })();
}

const KIND_LABEL: Record<string, string> = {
  product_review: "Review",
  comparison: "Vergelijking",
  buying_guide: "Koopgids",
  informational: "Artikel",
  faq: "FAQ",
};

export default async function TenantHub({ params }: PageProps) {
  const { tenant_slug } = await params;
  const data = await loadTenant(tenant_slug);
  if (!data) notFound();

  const { brandName, groups } = data;
  const totalPages = groups.reduce((n, g) => n + g.pages.length, 0);

  return (
    <main style={{ maxWidth: "52rem", padding: "2rem 1rem" }}>
      <header style={{ marginBottom: "2.5rem" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "0.5rem" }}>{brandName}</h1>
        {totalPages > 0 ? (
          <p style={{ color: "var(--brand-secondary)", fontSize: "0.9375rem" }}>
            {totalPages} gepubliceerde {totalPages === 1 ? "pagina" : "pagina's"} in{" "}
            {groups.filter((g) => g.nicheTopic).length} onderwerpen
          </p>
        ) : (
          <p style={{ color: "var(--brand-secondary)", fontSize: "0.9375rem" }}>
            Binnenkort — de eerste reviews en koopgidsen worden samengesteld.
          </p>
        )}
      </header>

      {groups.map((group) => (
        <section key={group.nicheId ?? "__ungrouped__"} style={{ marginBottom: "2.5rem" }}>
          {group.nicheTopic && (
            <h2
              style={{
                fontSize: "1.125rem",
                fontWeight: 600,
                marginBottom: "0.75rem",
                paddingBottom: "0.375rem",
                borderBottom: "1px solid #e5e5e5",
              }}
            >
              {group.nicheTopic}
            </h2>
          )}
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            {group.pages.map((page) => (
              <li key={page.full_path}>
                <Link
                  href={page.full_path}
                  style={{
                    textDecoration: "none",
                    display: "flex",
                    alignItems: "baseline",
                    gap: "0.625rem",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.6875rem",
                      color: "var(--brand-secondary)",
                      flexShrink: 0,
                      minWidth: "4.5rem",
                    }}
                  >
                    {KIND_LABEL[page.kind] ?? page.kind}
                  </span>
                  <span style={{ color: "var(--brand-primary)", fontWeight: 500 }}>
                    {page.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
