// Phase 3.1 — admin niche detail.
//
// One niche, its current state, and the test pages the Content Agent drafted
// for it. Operator reviews each draft, then approves so the page becomes
// publicly renderable on /sites/[tenant]/test/[niche]/[page_slug].

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "../../../../../lib/auth";
import { getServiceRoleSupabase } from "../../../../../lib/supabase";
import { approvePageAction, rejectPageAction } from "./actions";

interface RouteParams {
  id: string;
}

interface NicheRow {
  id: string;
  topic: string;
  topic_slug: string;
  state: string;
  approved_for_validation_at: string | null;
  validation_started_at: string | null;
  kill_reason: string | null;
  notes: string | null;
  tenant: { slug: string; hostname: string | null } | null;
}

interface PageRow {
  id: string;
  slug: string;
  full_path: string;
  kind: string;
  title: string;
  state: string;
  approved_at: string | null;
  approved_by_email: string | null;
  created_at: string;
}

async function load(id: string): Promise<{ niche: NicheRow; pages: PageRow[] } | null> {
  const supabase = getServiceRoleSupabase();

  const { data: niche, error: nErr } = await supabase
    .from("niches")
    .select(
      "id, topic, topic_slug, state, approved_for_validation_at, validation_started_at, kill_reason, notes, tenant_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (nErr || !niche) return null;

  let tenant: { slug: string; hostname: string | null } | null = null;
  if (niche.tenant_id) {
    const { data: t } = await supabase
      .from("tenants")
      .select("slug, hostname")
      .eq("id", niche.tenant_id)
      .maybeSingle();
    tenant = t ?? null;
  }

  const { data: pages } = await supabase
    .from("pages")
    .select("id, slug, full_path, kind, title, state, approved_at, approved_by_email, created_at")
    .eq("niche_id", id)
    .order("created_at", { ascending: true });

  return {
    niche: { ...niche, tenant } as NicheRow,
    pages: (pages ?? []) as PageRow[],
  };
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" });
}

function StateBadge({ state }: { state: string }) {
  const colours: Record<string, string> = {
    draft: "#f59e0b",
    pending_review: "#3b82f6",
    approved: "#10b981",
    published: "#059669",
    rejected: "#ef4444",
    archived: "#6b7280",
  };
  const c = colours[state] ?? "#525252";
  return (
    <span
      style={{
        background: c,
        color: "white",
        padding: "0.125rem 0.5rem",
        borderRadius: "0.25rem",
        fontSize: "0.75rem",
        fontWeight: 500,
      }}
    >
      {state}
    </span>
  );
}

export default async function AdminNicheDetailPage({ params }: { params: Promise<RouteParams> }) {
  await requireAdmin();
  const { id } = await params;
  const data = await load(id);
  if (!data) notFound();
  const { niche, pages } = data;

  return (
    <article>
      <Link href="/admin/niches" style={{ fontSize: "0.875rem" }}>
        ← Alle niches
      </Link>

      <header style={{ margin: "1rem 0 1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", marginBottom: "0.25rem" }}>{niche.topic}</h1>
        <p style={{ color: "#525252", fontSize: "0.875rem" }}>
          <code>{niche.topic_slug}</code> · staat: <strong>{niche.state}</strong>
          {niche.tenant ? (
            <>
              {" "}
              · tenant: <code>{niche.tenant.slug}</code>
            </>
          ) : null}
        </p>
      </header>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Tijdlijn</h2>
        <dl
          style={{
            fontSize: "0.875rem",
            display: "grid",
            gridTemplateColumns: "12rem 1fr",
            gap: "0.25rem",
          }}
        >
          <dt>Approved for validation</dt>
          <dd>{fmtDate(niche.approved_for_validation_at)}</dd>
          <dt>Validation started</dt>
          <dd>{fmtDate(niche.validation_started_at)}</dd>
          {niche.kill_reason ? (
            <>
              <dt>Kill reason</dt>
              <dd>{niche.kill_reason}</dd>
            </>
          ) : null}
        </dl>
        {niche.notes ? (
          <p style={{ fontSize: "0.875rem", marginTop: "0.5rem", color: "#525252" }}>
            {niche.notes}
          </p>
        ) : null}
      </section>

      <section>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Test-pagina's ({pages.length})</h2>
        {pages.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "#525252" }}>
            Nog geen drafts. De cron <code>test-page-draft-once</code> draait elke 15 minuten en
            pakt deze niche op zodra hij in <code>approved_for_validation</code> staat.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {pages.map((p) => (
              <li
                key={p.id}
                style={{
                  border: "1px solid #e5e5e5",
                  borderRadius: "0.375rem",
                  padding: "0.75rem 1rem",
                  marginBottom: "0.5rem",
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: "1rem",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <StateBadge state={p.state} />
                    <strong>{p.title}</strong>
                  </div>
                  <p style={{ fontSize: "0.75rem", color: "#737373", marginTop: "0.25rem" }}>
                    <code>{p.full_path}</code> · {p.kind} · gemaakt {fmtDate(p.created_at)}
                    {p.approved_at ? (
                      <>
                        {" "}
                        · approved {fmtDate(p.approved_at)} door {p.approved_by_email}
                      </>
                    ) : null}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {(p.state === "approved" || p.state === "published") && niche.tenant ? (
                    <Link
                      href={`/sites/${niche.tenant.slug}${p.full_path}`}
                      target="_blank"
                      style={{ fontSize: "0.75rem" }}
                    >
                      Preview ↗
                    </Link>
                  ) : null}
                  {p.state === "draft" || p.state === "rejected" ? (
                    <form
                      action={async () => {
                        "use server";
                        await approvePageAction(p.id);
                      }}
                    >
                      <button type="submit" style={btnApprove}>
                        Approve
                      </button>
                    </form>
                  ) : null}
                  {p.state === "draft" ? (
                    <form
                      action={async () => {
                        "use server";
                        await rejectPageAction(p.id);
                      }}
                    >
                      <button type="submit" style={btnReject}>
                        Reject
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

const btnBase = {
  fontSize: "0.75rem",
  padding: "0.25rem 0.625rem",
  borderRadius: "0.25rem",
  border: "1px solid",
  cursor: "pointer",
} as const;
const btnApprove = { ...btnBase, background: "#10b981", color: "white", borderColor: "#059669" };
const btnReject = { ...btnBase, background: "white", color: "#ef4444", borderColor: "#ef4444" };
