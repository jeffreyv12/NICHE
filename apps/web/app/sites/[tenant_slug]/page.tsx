// Tenant homepage — Koopgids.nl style
// Professional landing page with hero, category cards, and article list.

import { unstable_cache } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { tenantTag } from "../../../lib/cache";
import { getServiceRoleSupabase } from "../../../lib/supabase";

export const revalidate = 3_600;

interface PageProps {
  params: Promise<{ tenant_slug: string }>;
}

interface NicheRow {
  topic: string;
  topic_slug: string;
}

interface PageRow {
  title: string;
  full_path: string;
  kind: string;
  niche_id: string | null;
  niches: NicheRow | NicheRow[] | null;
}

interface TenantData {
  brandName: string;
  tagline: string;
  groups: Array<{
    nicheId: string | null;
    nicheTopic: string | null;
    nicheSlug: string | null;
    pages: Array<{ title: string; full_path: string; kind: string }>;
  }>;
}

const KIND_LABEL: Record<string, string> = {
  product_review: "Review",
  comparison: "Vergelijking",
  buying_guide: "Koopgids",
  informational: "Artikel",
  faq: "FAQ",
};

const NICHE_ICONS: Record<string, string> = {
  airfryers: "🍟",
  koffiezetapparaten: "☕",
  robotstofzuigers: "🤖",
};

async function loadUncached(tenantSlug: string): Promise<TenantData | null> {
  const supabase = getServiceRoleSupabase();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, config")
    .eq("slug", tenantSlug)
    .eq("is_active", true)
    .maybeSingle();
  if (!tenant) return null;

  const config = (tenant.config ?? {}) as Record<string, unknown>;
  const brand = (config.brand ?? {}) as Record<string, string>;
  const brandName = brand.name ?? tenantSlug;
  const tagline = brand.tagline ?? "Onafhankelijke productgidsen";

  const { data: rows } = await supabase
    .from("pages")
    .select("title, full_path, kind, niche_id, niches(topic, topic_slug)")
    .eq("tenant_id", tenant.id)
    .eq("state", "published")
    .not("full_path", "like", "/test/%")
    .order("full_path");

  const groupMap = new Map<string | null, TenantData["groups"][0]>();
  for (const row of (rows ?? []) as unknown as PageRow[]) {
    const niche = Array.isArray(row.niches) ? (row.niches[0] ?? null) : (row.niches ?? null);
    const key = row.niche_id ?? "__ungrouped__";
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        nicheId: row.niche_id,
        nicheTopic: niche?.topic ?? null,
        nicheSlug: niche?.topic_slug ?? null,
        pages: [],
      });
    }
    groupMap.get(key)?.pages.push({ title: row.title, full_path: row.full_path, kind: row.kind });
  }

  const groups = [...groupMap.values()].sort((a, b) => {
    if (!a.nicheTopic) return 1;
    if (!b.nicheTopic) return -1;
    return a.nicheTopic.localeCompare(b.nicheTopic, "nl");
  });

  return { brandName, tagline, groups };
}

function loadTenant(tenantSlug: string): Promise<TenantData | null> {
  return unstable_cache(() => loadUncached(tenantSlug), ["tenant-hub", tenantSlug], {
    tags: [tenantTag(tenantSlug)],
    revalidate: 3_600,
  })();
}

export default async function TenantHub({ params }: PageProps) {
  const { tenant_slug } = await params;
  const data = await loadTenant(tenant_slug);
  if (!data) notFound();

  const { brandName, tagline, groups } = data;
  const totalPages = groups.reduce((n, g) => n + g.pages.length, 0);
  const totalNiches = groups.filter((g) => g.nicheTopic).length;

  return (
    <div>
      {/* Hero */}
      <section
        style={{
          background: "linear-gradient(135deg, #1e40af 0%, #2563eb 60%, #3b82f6 100%)",
          color: "#fff",
          padding: "3.5rem 1.25rem 3rem",
          marginBottom: "2.5rem",
          borderRadius: "0 0 1.5rem 1.5rem",
        }}
      >
        <div style={{ maxWidth: 760, margin: "0 auto", textAlign: "center" }}>
          <h1
            style={{
              fontFamily: "var(--font-heading, Rubik, sans-serif)",
              fontSize: "clamp(2rem, 5vw, 3rem)",
              fontWeight: 700,
              margin: "0 0 1rem",
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
            }}
          >
            {brandName}
          </h1>
          <p
            style={{
              fontSize: "clamp(1rem, 2.5vw, 1.25rem)",
              opacity: 0.9,
              margin: "0 0 2rem",
              lineHeight: 1.5,
            }}
          >
            {tagline}
          </p>
          <div
            style={{ display: "flex", gap: "1.5rem", justifyContent: "center", flexWrap: "wrap" }}
          >
            {[
              ["📄", `${totalPages} gidsen`],
              ["📂", `${totalNiches} categorieën`],
              ["✅", "Onafhankelijk advies"],
            ].map(([icon, label]) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  fontSize: "0.9375rem",
                  background: "rgba(255,255,255,0.15)",
                  padding: "0.375rem 0.875rem",
                  borderRadius: "9999px",
                }}
              >
                <span>{icon}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Category cards */}
      {groups.filter((g) => g.nicheTopic).length > 0 && (
        <section style={{ marginBottom: "3rem" }}>
          <h2
            style={{
              fontFamily: "var(--font-heading, Rubik, sans-serif)",
              fontSize: "1.25rem",
              fontWeight: 600,
              color: "#0f172a",
              marginBottom: "1.25rem",
            }}
          >
            Categorieën
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: "1rem",
            }}
          >
            {groups
              .filter((g) => g.nicheTopic)
              .map((group) => {
                const icon = group.nicheSlug ? (NICHE_ICONS[group.nicheSlug] ?? "📦") : "📦";
                const firstPage = group.pages[0];
                return (
                  <Link
                    key={group.nicheId}
                    href={firstPage?.full_path ?? "/"}
                    style={{ textDecoration: "none" }}
                  >
                    <div
                      style={{
                        background: "#fff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "0.875rem",
                        padding: "1.5rem",
                        transition: "box-shadow 150ms, transform 150ms",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>{icon}</div>
                      <div
                        style={{
                          fontFamily: "var(--font-heading, Rubik, sans-serif)",
                          fontWeight: 600,
                          fontSize: "1rem",
                          color: "#0f172a",
                          marginBottom: "0.375rem",
                        }}
                      >
                        {group.nicheTopic}
                      </div>
                      <div style={{ fontSize: "0.8125rem", color: "#64748b" }}>
                        {group.pages.length} {group.pages.length === 1 ? "artikel" : "artikelen"}
                      </div>
                    </div>
                  </Link>
                );
              })}
          </div>
        </section>
      )}

      {/* All articles */}
      <section>
        <h2
          style={{
            fontFamily: "var(--font-heading, Rubik, sans-serif)",
            fontSize: "1.25rem",
            fontWeight: 600,
            color: "#0f172a",
            marginBottom: "1.25rem",
          }}
        >
          Alle artikelen
        </h2>

        {totalPages === 0 ? (
          <p style={{ color: "#64748b", fontSize: "0.9375rem" }}>
            Binnenkort — de eerste koopgidsen worden samengesteld.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            {groups.flatMap((group) =>
              group.pages.map((page) => (
                <Link key={page.full_path} href={page.full_path} style={{ textDecoration: "none" }}>
                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "0.625rem",
                      padding: "1rem 1.25rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "1rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.875rem" }}>
                      <span
                        style={{
                          fontSize: "0.6875rem",
                          fontWeight: 600,
                          color: "#2563eb",
                          background: "#eff6ff",
                          padding: "0.2rem 0.6rem",
                          borderRadius: "9999px",
                          flexShrink: 0,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {KIND_LABEL[page.kind] ?? page.kind}
                      </span>
                      <span
                        style={{
                          fontWeight: 500,
                          color: "#0f172a",
                          fontSize: "0.9375rem",
                        }}
                      >
                        {page.title}
                      </span>
                    </div>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#94a3b8"
                      strokeWidth="2"
                      style={{ flexShrink: 0 }}
                      aria-hidden="true"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                </Link>
              )),
            )}
          </div>
        )}
      </section>

      {/* Trust footer */}
      <section
        style={{
          marginTop: "3rem",
          background: "#f1f5f9",
          borderRadius: "1rem",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontSize: "0.875rem",
            color: "#475569",
            lineHeight: 1.7,
            margin: 0,
            maxWidth: 560,
            marginInline: "auto",
          }}
        >
          <strong style={{ color: "#1e293b" }}>Over {brandName}</strong> — Wij schrijven
          onafhankelijke koopgidsen op basis van uitgebreid productonderzoek. We worden niet betaald
          door fabrikanten om producten aan te bevelen. Commissies via affiliate links helpen ons
          deze content gratis aan te bieden.
        </p>
      </section>
    </div>
  );
}
