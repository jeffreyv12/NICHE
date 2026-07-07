// Phase 4.1 — Content Engine admin page.
//
// Shows hero and commercial pages across all niches, grouped by niche.
// The operator reviews polished drafts, checks claims, and approves for publish.
// The content-polish job (apps/scrapers/src/jobs/content-polish.ts) runs nightly
// and bumps pages from 'draft' to 'pending_review' after Opus polish.

export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAdmin } from "../../../../lib/auth";
import { getServiceRoleSupabase } from "../../../../lib/supabase";
import { approvePageAction, rejectPageAction } from "../niches/[id]/actions";

// Form actions must return void — strip the result so the type matches.
async function approveVoid(pageId: string): Promise<void> {
  "use server";
  await approvePageAction(pageId);
}
async function rejectVoid(pageId: string): Promise<void> {
  "use server";
  await rejectPageAction(pageId);
}

interface ContentPageRow {
  id: string;
  slug: string;
  full_path: string;
  kind: string;
  title: string;
  state: string;
  ai_assisted: boolean;
  approved_at: string | null;
  created_at: string;
  niche_id: string | null;
  niche_topic: string | null;
  niche_slug: string | null;
  tenant_slug: string | null;
}

const HERO_KINDS = ["hero", "commercial", "review", "comparison"];

async function load(): Promise<ContentPageRow[]> {
  const supabase = getServiceRoleSupabase();

  const { data } = await supabase
    .from("pages")
    .select(
      `id, slug, full_path, kind, title, state, ai_assisted, approved_at, created_at,
       niche_id,
       niches(topic, topic_slug),
       tenants!inner(slug)`,
    )
    .in("kind", HERO_KINDS)
    .in("state", ["draft", "pending_review", "approved", "published"])
    .order("created_at", { ascending: false })
    .limit(200);

  return (data ?? []).map((row) => {
    const nicheRow = row.niches as unknown as { topic: string; topic_slug: string } | null;
    const tenantRow = row.tenants as unknown as { slug: string };
    return {
      id: row.id,
      slug: row.slug,
      full_path: row.full_path,
      kind: row.kind,
      title: row.title,
      state: row.state,
      ai_assisted: row.ai_assisted,
      approved_at: row.approved_at,
      created_at: row.created_at,
      niche_id: row.niche_id,
      niche_topic: nicheRow?.topic ?? null,
      niche_slug: nicheRow?.topic_slug ?? null,
      tenant_slug: tenantRow?.slug ?? null,
    };
  });
}

const STATE_COLOR: Record<string, string> = {
  draft: "#f59e0b",
  pending_review: "#3b82f6",
  approved: "#22c55e",
  published: "#06b6d4",
};

const KIND_LABEL: Record<string, string> = {
  hero: "Hero",
  commercial: "Commercial",
  review: "Review",
  comparison: "Comparison",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("nl-NL", { dateStyle: "short" });
}

export default async function ContentPage() {
  await requireAdmin();
  const rows = await load();

  // Group by niche
  const byNiche = new Map<string, ContentPageRow[]>();
  const noNicheRows: ContentPageRow[] = [];
  for (const row of rows) {
    const key = row.niche_id ?? "__none__";
    if (!row.niche_id) {
      noNicheRows.push(row);
    } else {
      if (!byNiche.has(key)) byNiche.set(key, []);
      byNiche.get(key)?.push(row);
    }
  }

  const stateSummary = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.state] = (acc[r.state] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "1rem",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>Content</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {Object.entries(stateSummary).map(([state, count]) => (
            <span
              key={state}
              style={{
                background: `${STATE_COLOR[state] ?? "#737373"}18`,
                border: `1px solid ${STATE_COLOR[state] ?? "#737373"}`,
                color: STATE_COLOR[state] ?? "#737373",
                borderRadius: "9999px",
                padding: "0.2rem 0.6rem",
                fontSize: "0.75rem",
                fontWeight: 600,
              }}
            >
              {count} {state}
            </span>
          ))}
        </div>
      </div>
      <p style={{ color: "#525252", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Hero, commercial, review, and comparison pages. The nightly content-polish job (Opus 4.7)
        moves drafts to <em>pending_review</em>. Approve to publish.
      </p>

      {rows.length === 0 && <p style={{ color: "#737373" }}>No hero/commercial pages yet.</p>}

      {Array.from(byNiche.entries()).map(([nicheId, nicheRows]) => {
        const first = nicheRows[0];
        if (!first) return null;
        return (
          <NicheGroup
            key={nicheId}
            nicheId={nicheId}
            nicheTopic={first.niche_topic ?? nicheId}
            nicheSlug={first.niche_slug}
            tenantSlug={first.tenant_slug}
            rows={nicheRows}
          />
        );
      })}

      {noNicheRows.length > 0 && (
        <NicheGroup
          nicheId="__none__"
          nicheTopic="(no niche)"
          nicheSlug={null}
          tenantSlug={null}
          rows={noNicheRows}
        />
      )}
    </div>
  );
}

function NicheGroup({
  nicheId,
  nicheTopic,
  nicheSlug,
  tenantSlug,
  rows,
}: {
  nicheId: string;
  nicheTopic: string;
  nicheSlug: string | null;
  tenantSlug: string | null;
  rows: ContentPageRow[];
}) {
  const pendingCount = rows.filter(
    (r) => r.state === "draft" || r.state === "pending_review",
  ).length;

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}
      >
        <h2 style={{ fontSize: "1rem", fontWeight: 600 }}>
          {nicheId !== "__none__" ? (
            <Link href={`/admin/niches/${nicheId}`} style={{ color: "inherit" }}>
              {nicheTopic}
            </Link>
          ) : (
            nicheTopic
          )}
        </h2>
        {pendingCount > 0 && (
          <span style={{ fontSize: "0.75rem", color: "#f59e0b", fontWeight: 600 }}>
            {pendingCount} awaiting review
          </span>
        )}
      </div>

      <table
        style={{
          width: "100%",
          fontSize: "0.8125rem",
          borderCollapse: "collapse",
          border: "1px solid #e5e5e5",
          borderRadius: "0.375rem",
          overflow: "hidden",
        }}
      >
        <thead style={{ background: "#fafafa" }}>
          <tr>
            <th style={{ textAlign: "left", padding: "0.375rem 0.75rem", fontWeight: 600 }}>
              Title
            </th>
            <th style={{ textAlign: "left", padding: "0.375rem 0.75rem", fontWeight: 600 }}>
              Kind
            </th>
            <th style={{ textAlign: "left", padding: "0.375rem 0.75rem", fontWeight: 600 }}>
              State
            </th>
            <th style={{ textAlign: "left", padding: "0.375rem 0.75rem", fontWeight: 600 }}>
              Created
            </th>
            <th style={{ padding: "0.375rem 0.75rem" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const color = STATE_COLOR[row.state] ?? "#737373";
            const previewHref =
              tenantSlug && nicheSlug ? `/sites/${tenantSlug}${row.full_path}` : undefined;

            return (
              <tr key={row.id} style={{ borderTop: "1px solid #f5f5f5" }}>
                <td style={{ padding: "0.5rem 0.75rem" }}>
                  <span title={row.full_path}>{row.title}</span>
                  {row.ai_assisted && (
                    <span style={{ marginLeft: "0.4rem", fontSize: "0.6875rem", color: "#8b5cf6" }}>
                      AI
                    </span>
                  )}
                </td>
                <td style={{ padding: "0.5rem 0.75rem", color: "#525252" }}>
                  {KIND_LABEL[row.kind] ?? row.kind}
                </td>
                <td style={{ padding: "0.5rem 0.75rem" }}>
                  <span style={{ color, fontWeight: 600 }}>{row.state}</span>
                </td>
                <td style={{ padding: "0.5rem 0.75rem", color: "#737373" }}>
                  {fmtDate(row.created_at)}
                </td>
                <td style={{ padding: "0.5rem 0.75rem" }}>
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    {previewHref && (
                      <Link
                        href={previewHref}
                        target="_blank"
                        style={{ fontSize: "0.75rem", color: "#525252" }}
                      >
                        Preview
                      </Link>
                    )}
                    {(row.state === "draft" || row.state === "pending_review") && (
                      <>
                        <form action={approveVoid.bind(null, row.id)}>
                          <button
                            type="submit"
                            style={{
                              background: "#22c55e",
                              color: "#fff",
                              border: "none",
                              borderRadius: "0.25rem",
                              padding: "0.2rem 0.5rem",
                              fontSize: "0.75rem",
                              cursor: "pointer",
                            }}
                          >
                            Approve
                          </button>
                        </form>
                        <form action={rejectVoid.bind(null, row.id)}>
                          <button
                            type="submit"
                            style={{
                              background: "#ef4444",
                              color: "#fff",
                              border: "none",
                              borderRadius: "0.25rem",
                              padding: "0.2rem 0.5rem",
                              fontSize: "0.75rem",
                              cursor: "pointer",
                            }}
                          >
                            Reject
                          </button>
                        </form>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
