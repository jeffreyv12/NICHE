// Phase 3.1 — admin niche detail.
//
// One niche, its current state, and the test pages the Content Agent drafted
// for it. Operator reviews each draft, then approves so the page becomes
// publicly renderable on /sites/[tenant]/test/[niche]/[page_slug].

import { type ClaimVerificationResult, verifyClaims } from "@nichefinder/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "../../../../../lib/auth";
import { loadClaimsByPage } from "../../../../../lib/claims";
import { getServiceRoleSupabase } from "../../../../../lib/supabase";
import { approvePageAction, confirmValidationAction, rejectPageAction } from "./actions";

type ValidationDecision = "go" | "pivot" | "kill";

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
  operator_todos: string[] | null;
}

interface ValidationKeyMetrics {
  sessions: number;
  affiliate_clicks: number;
  affiliate_conversions: number;
  affiliate_revenue_eur: number;
  email_signups: number;
  avg_time_on_page_seconds: number;
  ctr_to_affiliate: number;
}

interface ValidationEvalRow {
  id: string;
  evaluated_at: string;
  window_days: number;
  decision: ValidationDecision;
  confidence: string;
  model_decision: ValidationDecision;
  safeguard_reason: string | null;
  rationale: string;
  key_metrics: ValidationKeyMetrics | null;
  next_actions: string[] | null;
  confirmed_at: string | null;
  confirmed_by_email: string | null;
  resulting_state: string | null;
}

async function load(id: string): Promise<{
  niche: NicheRow;
  pages: PageRow[];
  validation: ValidationEvalRow | null;
  claimChecks: Map<string, ClaimVerificationResult>;
} | null> {
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
    .select(
      "id, slug, full_path, kind, title, state, approved_at, approved_by_email, created_at, operator_todos",
    )
    .eq("niche_id", id)
    .order("created_at", { ascending: true });

  const { data: validation } = await supabase
    .from("validation_evaluations")
    .select(
      "id, evaluated_at, window_days, decision, confidence, model_decision, safeguard_reason, rationale, key_metrics, next_actions, confirmed_at, confirmed_by_email, resulting_state",
    )
    .eq("niche_id", id)
    .order("evaluated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Claim Verifier (Phase 4.2): only draft/rejected pages can be approved, so
  // pre-compute their gate verdicts to render the "needs a source" todos.
  const pageRows = (pages ?? []) as PageRow[];
  const checkIds = pageRows
    .filter((p) => p.state === "draft" || p.state === "rejected")
    .map((p) => p.id);
  const claimsByPage = await loadClaimsByPage(checkIds);
  const claimChecks = new Map<string, ClaimVerificationResult>();
  for (const pid of checkIds) {
    claimChecks.set(pid, verifyClaims(claimsByPage.get(pid) ?? []));
  }

  return {
    niche: { ...niche, tenant } as NicheRow,
    pages: pageRows,
    validation: (validation ?? null) as ValidationEvalRow | null,
    claimChecks,
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
  const { niche, pages, validation, claimChecks } = data;

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

      <ValidationSection niche={niche} validation={validation} />

      <section>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Test-pagina's ({pages.length})</h2>
        {pages.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "#525252" }}>
            Nog geen drafts. De cron <code>test-page-draft-once</code> draait elke 15 minuten en
            pakt deze niche op zodra hij in <code>approved_for_validation</code> staat.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {pages.map((p) => {
              const check = claimChecks.get(p.id);
              const blocked = check ? !check.ok : false;
              const canApprove = p.state === "draft" || p.state === "rejected";
              return (
                <li
                  key={p.id}
                  style={{
                    border: "1px solid #e5e5e5",
                    borderRadius: "0.375rem",
                    padding: "0.75rem 1rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  <div
                    style={{
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
                      {canApprove ? (
                        <form
                          action={async () => {
                            "use server";
                            await approvePageAction(p.id);
                          }}
                        >
                          <button
                            type="submit"
                            style={blocked ? btnApproveDisabled : btnApprove}
                            disabled={blocked}
                            title={
                              blocked ? "Bron(nen) toevoegen voordat je kunt goedkeuren" : undefined
                            }
                          >
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
                  </div>
                  {canApprove && check ? <ClaimGate check={check} /> : null}
                  {p.operator_todos && p.operator_todos.length > 0 ? (
                    <PolishTodos todos={p.operator_todos} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </article>
  );
}

const DECISION_COLOURS: Record<ValidationDecision, string> = {
  go: "#059669",
  pivot: "#f59e0b",
  kill: "#ef4444",
};
const DECISION_LABELS: Record<ValidationDecision, string> = {
  go: "GO — bouwen",
  pivot: "PIVOT — bijsturen",
  kill: "KILL — stoppen",
};

function fmtEur(n: number): string {
  return `€${n.toFixed(2).replace(".", ",")}`;
}

function ValidationSection({
  niche,
  validation,
}: {
  niche: NicheRow;
  validation: ValidationEvalRow | null;
}) {
  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Validation</h2>

      {!validation ? (
        <p style={{ fontSize: "0.875rem", color: "#525252" }}>
          Nog geen aanbeveling. De cron <code>validation-once</code> draait wekelijks (vr 18:00 NL)
          op niches in <code>validating</code>, of on-demand via{" "}
          <code>validation-once --niche {niche.id}</code>.
        </p>
      ) : (
        <ValidationCard niche={niche} v={validation} />
      )}
    </section>
  );
}

function ValidationCard({ niche, v }: { niche: NicheRow; v: ValidationEvalRow }) {
  const colour = DECISION_COLOURS[v.decision] ?? "#525252";
  const amended = v.safeguard_reason !== null && v.model_decision !== v.decision;
  const canConfirm = niche.state === "validating" && v.confirmed_at === null;

  return (
    <div style={{ border: `1px solid ${colour}`, borderRadius: "0.5rem", padding: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <span
          style={{
            background: colour,
            color: "white",
            padding: "0.25rem 0.75rem",
            borderRadius: "0.375rem",
            fontWeight: 700,
            fontSize: "0.875rem",
          }}
        >
          {DECISION_LABELS[v.decision] ?? v.decision}
        </span>
        <span style={{ fontSize: "0.8125rem", color: "#525252" }}>
          vertrouwen: <strong>{v.confidence}</strong> · venster {v.window_days}d ·{" "}
          {fmtDate(v.evaluated_at)}
        </span>
      </div>

      {amended ? (
        <p
          style={{
            fontSize: "0.8125rem",
            marginTop: "0.5rem",
            color: "#92400e",
            background: "#fef3c7",
            padding: "0.5rem 0.75rem",
            borderRadius: "0.375rem",
          }}
        >
          Host-safeguard heeft het model-advies <strong>{v.model_decision}</strong> bijgesteld naar{" "}
          <strong>{v.decision}</strong> ({v.safeguard_reason}).
        </p>
      ) : null}

      <p style={{ fontSize: "0.875rem", marginTop: "0.75rem", lineHeight: 1.5 }}>{v.rationale}</p>

      {v.key_metrics ? (
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(8rem, 1fr))",
            gap: "0.5rem 1rem",
            fontSize: "0.8125rem",
            marginTop: "0.75rem",
          }}
        >
          <Metric label="Sessies" value={String(v.key_metrics.sessions)} />
          <Metric label="Aff. clicks" value={String(v.key_metrics.affiliate_clicks)} />
          <Metric label="Conversies" value={String(v.key_metrics.affiliate_conversions)} />
          <Metric label="Omzet" value={fmtEur(v.key_metrics.affiliate_revenue_eur)} />
          <Metric
            label="CTR → aff."
            value={`${(v.key_metrics.ctr_to_affiliate * 100).toFixed(1)}%`}
          />
          <Metric label="E-mail signups" value={String(v.key_metrics.email_signups)} />
        </dl>
      ) : null}

      {v.next_actions && v.next_actions.length > 0 ? (
        <div style={{ marginTop: "0.75rem" }}>
          <strong style={{ fontSize: "0.8125rem" }}>Volgende acties</strong>
          <ul style={{ fontSize: "0.8125rem", margin: "0.25rem 0 0", paddingLeft: "1.25rem" }}>
            {v.next_actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {v.confirmed_at ? (
        <p style={{ fontSize: "0.8125rem", marginTop: "0.75rem", color: "#059669" }}>
          Bevestigd als <strong>{v.resulting_state}</strong> op {fmtDate(v.confirmed_at)} door{" "}
          {v.confirmed_by_email}.
        </p>
      ) : canConfirm ? (
        <div style={{ marginTop: "1rem" }}>
          <p style={{ fontSize: "0.8125rem", color: "#525252", marginBottom: "0.5rem" }}>
            Bevestig de beslissing (jij beslist — de agent adviseert alleen):
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {(["go", "pivot", "kill"] as const).map((d) => (
              <form
                key={d}
                action={async () => {
                  "use server";
                  await confirmValidationAction(v.id, d);
                }}
              >
                <button
                  type="submit"
                  style={{
                    fontSize: "0.8125rem",
                    padding: "0.375rem 0.875rem",
                    borderRadius: "0.375rem",
                    border: `1px solid ${DECISION_COLOURS[d]}`,
                    cursor: "pointer",
                    fontWeight: d === v.decision ? 700 : 400,
                    background: d === v.decision ? DECISION_COLOURS[d] : "white",
                    color: d === v.decision ? "white" : DECISION_COLOURS[d],
                  }}
                >
                  {DECISION_LABELS[d]}
                  {d === v.decision ? " ✓" : ""}
                </button>
              </form>
            ))}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: "0.8125rem", marginTop: "0.75rem", color: "#737373" }}>
          Niet te bevestigen: niche staat in <code>{niche.state}</code> (verwacht{" "}
          <code>validating</code>).
        </p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ color: "#737373" }}>{label}</dt>
      <dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd>
    </div>
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
const btnApproveDisabled = {
  ...btnBase,
  background: "#d1d5db",
  color: "#6b7280",
  borderColor: "#d1d5db",
  cursor: "not-allowed",
} as const;
const btnReject = { ...btnBase, background: "white", color: "#ef4444", borderColor: "#ef4444" };

// Phase 4.1 — operator todos from the Content Agent polish pass (e.g. a
// "[BLOCKER] disclosure missing" advisory). Amber, distinct from the claim gate.
function PolishTodos({ todos }: { todos: string[] }) {
  return (
    <div
      style={{
        marginTop: "0.5rem",
        background: "#fffbeb",
        border: "1px solid #fde68a",
        borderRadius: "0.375rem",
        padding: "0.5rem 0.75rem",
      }}
    >
      <strong style={{ fontSize: "0.75rem", color: "#92400e" }}>
        Polish-pass aandachtspunten ({todos.length})
      </strong>
      <ul
        style={{
          fontSize: "0.75rem",
          color: "#78350f",
          margin: "0.375rem 0 0",
          paddingLeft: "1.25rem",
        }}
      >
        {todos.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

// Phase 4.2 — Claim Verifier status for one draft page: green when every claim
// is sourced, red with the blocking claims as "add a source" todos otherwise.
function ClaimGate({ check }: { check: ClaimVerificationResult }) {
  if (check.total === 0) {
    return (
      <p style={{ fontSize: "0.75rem", color: "#737373", marginTop: "0.5rem" }}>
        Geen claims gemarkeerd op deze pagina.
      </p>
    );
  }
  if (check.ok) {
    return (
      <p style={{ fontSize: "0.75rem", color: "#059669", marginTop: "0.5rem" }}>
        ✓ Alle {check.total} claims hebben een bron.
      </p>
    );
  }
  return (
    <div
      style={{
        marginTop: "0.5rem",
        background: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: "0.375rem",
        padding: "0.5rem 0.75rem",
      }}
    >
      <strong style={{ fontSize: "0.75rem", color: "#b91c1c" }}>
        {check.unsourced.length} van {check.total} claims missen een bron — voeg een bron toe
        voordat je goedkeurt:
      </strong>
      <ul
        style={{
          fontSize: "0.75rem",
          color: "#7f1d1d",
          margin: "0.375rem 0 0",
          paddingLeft: "1.25rem",
        }}
      >
        {check.unsourced.map((u) => (
          <li key={u.claimId}>
            {u.claimText} <span style={{ color: "#9ca3af" }}>({u.claimType})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
