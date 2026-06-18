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
import {
  approvePageAction,
  attachClaimTestSourceAction,
  attachClaimUrlSourceAction,
  confirmKillFlagAction,
  confirmValidationAction,
  dismissKillFlagAction,
  rejectPageAction,
} from "./actions";

interface TestOption {
  id: string;
  product_name: string;
}

interface KillFlagRow {
  id: string;
  reasons: string[];
  details: Array<{ reason: string; detail: string }> | null;
  flagged_at: string;
}

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

interface PromotionEvalRow {
  id: string;
  evaluated_at: string;
  result: string;
  recommendation: string | null;
}

async function load(id: string): Promise<{
  niche: NicheRow;
  pages: PageRow[];
  validation: ValidationEvalRow | null;
  promotion: PromotionEvalRow | null;
  claimChecks: Map<string, ClaimVerificationResult>;
  tests: TestOption[];
  killFlag: KillFlagRow | null;
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

  // First-party tests the operator can attach to an unsourced claim (4.3.3).
  let tests: TestOption[] = [];
  if (niche.tenant_id) {
    const { data: testRows } = await supabase
      .from("first_party_tests")
      .select("id, product_name")
      .eq("tenant_id", niche.tenant_id)
      .order("created_at", { ascending: false })
      .limit(100);
    tests = (testRows ?? []) as TestOption[];
  }

  // Open kill recommendation (Phase 6.2), if any.
  const { data: killFlag } = await supabase
    .from("kill_flags")
    .select("id, reasons, details, flagged_at")
    .eq("niche_id", id)
    .is("confirmed_at", null)
    .is("dismissed_at", null)
    .order("flagged_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Latest promotion evaluation (Phase 5.4.4): show "Ready to promote" card.
  const { data: promotion } = await supabase
    .from("promotion_evaluations")
    .select("id, evaluated_at, result, recommendation")
    .eq("niche_id", id)
    .order("evaluated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    niche: { ...niche, tenant } as NicheRow,
    pages: pageRows,
    validation: (validation ?? null) as ValidationEvalRow | null,
    promotion: (promotion ?? null) as PromotionEvalRow | null,
    claimChecks,
    tests,
    killFlag: (killFlag ?? null) as KillFlagRow | null,
  };
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" });
}

function fmtMonth(isoMonth: string): string {
  return new Date(isoMonth).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Monthly metrics (Phase 5.4 / promotion gate C1+C2)
// ---------------------------------------------------------------------------

interface MonthlyMetricRow {
  month: string;
  revenue_eur: string;
  conversions_count: number;
  organic_clicks: number | null;
}

async function loadMonthlyMetrics(nicheId: string): Promise<MonthlyMetricRow[]> {
  const supabase = getServiceRoleSupabase();
  const { data } = await supabase
    .from("niche_monthly_metrics")
    .select("month, revenue_eur, conversions_count, organic_clicks")
    .eq("niche_id", nicheId)
    .order("month", { ascending: false })
    .limit(6);
  return (data ?? []) as MonthlyMetricRow[];
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
  const [data, monthlyMetrics] = await Promise.all([load(id), loadMonthlyMetrics(id)]);
  if (!data) notFound();
  const { niche, pages, validation, promotion, claimChecks, tests, killFlag } = data;

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

      {killFlag ? <KillFlagBanner flag={killFlag} nicheState={niche.state} /> : null}

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

      <MonthlyMetricsPanel rows={monthlyMetrics} />
      <ValidationSection niche={niche} validation={validation} />
      <PromotionSection promotion={promotion} />

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
                  {canApprove && check ? <ClaimGate check={check} tests={tests} /> : null}
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

// Promotion gate thresholds (PROMOTION_GATE.md C1 + C2).
const PROMO_REVENUE_EUR = 150;
const PROMO_CLICKS = 1_500;

function MonthlyMetricsPanel({ rows }: { rows: MonthlyMetricRow[] }) {
  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>Maandelijkse metrics</h2>
      <p style={{ fontSize: "0.75rem", color: "#737373", marginBottom: "0.5rem" }}>
        Drempelwaarden (promotie-gate C1/C2): omzet ≥ €{PROMO_REVENUE_EUR}/mo · organische clicks ≥{" "}
        {PROMO_CLICKS.toLocaleString("nl-NL")}/mo
      </p>

      {rows.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#737373" }}>
          Nog geen maanddata. Het rollup-job (<code>niche-monthly-metrics-once</code>) draait
          dagelijks 03:00 NL.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #e5e5e5" }}>
              <th style={{ padding: "0.25rem 0.75rem 0.375rem 0", fontWeight: 600 }}>Maand</th>
              <th
                style={{ padding: "0.25rem 0.75rem 0.375rem", textAlign: "right", fontWeight: 600 }}
              >
                Omzet
              </th>
              <th
                style={{ padding: "0.25rem 0.75rem 0.375rem", textAlign: "right", fontWeight: 600 }}
              >
                Conversies
              </th>
              <th
                style={{
                  padding: "0.25rem 0 0.375rem 0.75rem",
                  textAlign: "right",
                  fontWeight: 600,
                }}
              >
                Org. clicks
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rev = Number(row.revenue_eur);
              const revOk = rev >= PROMO_REVENUE_EUR;
              const clicksOk = row.organic_clicks !== null && row.organic_clicks >= PROMO_CLICKS;
              return (
                <tr key={row.month} style={{ borderTop: "1px solid #f5f5f5" }}>
                  <td
                    style={{
                      padding: "0.3rem 0.75rem 0.3rem 0",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmtMonth(row.month)}
                  </td>
                  <td
                    style={{
                      padding: "0.3rem 0.75rem",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      color: revOk ? "#059669" : rev > 0 ? "#111" : "#a3a3a3",
                      fontWeight: revOk ? 600 : 400,
                    }}
                  >
                    {revOk ? "✓ " : ""}€{rev.toFixed(2).replace(".", ",")}
                  </td>
                  <td
                    style={{
                      padding: "0.3rem 0.75rem",
                      textAlign: "right",
                      color: "#737373",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {row.conversions_count}
                  </td>
                  <td
                    style={{
                      padding: "0.3rem 0 0.3rem 0.75rem",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      color:
                        row.organic_clicks === null ? "#a3a3a3" : clicksOk ? "#059669" : "#111",
                      fontWeight: clicksOk ? 600 : 400,
                    }}
                  >
                    {row.organic_clicks === null
                      ? "—"
                      : `${clicksOk ? "✓ " : ""}${row.organic_clicks.toLocaleString("nl-NL")}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
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

// Phase 5.4.4 — Promotion evaluation result card.
// Shows when the Promotion Agent has evaluated the niche. When result='ready',
// the card is highlighted green to prompt operator action (CLAUDE.md #1 + #10).
function PromotionSection({ promotion }: { promotion: PromotionEvalRow | null }) {
  if (!promotion) return null;

  const isReady = promotion.result === "ready";
  const borderColor = isReady ? "#059669" : "#e5e5e5";
  const bg = isReady ? "#f0fdf4" : "#fafafa";

  const RESULT_LABELS: Record<string, string> = {
    ready: "✅ Klaar voor promotie",
    not_ready: "Nog niet klaar",
    blocked_by_update_window: "Geblokkeerd — algoritme-update actief",
    blocked_by_single_source: "Geblokkeerd — te weinig affiliate-bronnen",
  };

  return (
    <section
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: "0.5rem",
        padding: "1.25rem 1.5rem",
        background: bg,
        marginBottom: "1.5rem",
      }}
    >
      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Promotie-evaluatie</h2>
      <p style={{ fontSize: "0.875rem", marginBottom: "0.5rem" }}>
        <strong>{RESULT_LABELS[promotion.result] ?? promotion.result}</strong>
        {" — "}
        <span style={{ color: "#737373" }}>
          {new Date(promotion.evaluated_at).toLocaleDateString("nl-NL", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })}
        </span>
      </p>
      {promotion.recommendation ? (
        <p style={{ fontSize: "0.8125rem", color: "#525252", margin: 0, whiteSpace: "pre-wrap" }}>
          {promotion.recommendation}
        </p>
      ) : null}
      {isReady ? (
        <p
          style={{
            marginTop: "0.75rem",
            fontSize: "0.8125rem",
            color: "#065f46",
            fontWeight: 600,
          }}
        >
          Start de promotieprocedure handmatig via <code>promotion-once.js --niche {"{id}"}</code>{" "}
          op de Hetzner-server nadat u de kandidaatdomeinen heeft gecontroleerd en de kosten heeft
          goedgekeurd.
        </p>
      ) : null}
    </section>
  );
}

// Phase 6.2 — open kill recommendation. The operator confirms (→ niche killed)
// or dismisses; the scan only ever recommends (CLAUDE.md #2 + #13).
function KillFlagBanner({ flag, nicheState }: { flag: KillFlagRow; nicheState: string }) {
  const decidable = nicheState !== "killed" && nicheState !== "archived";
  return (
    <section
      style={{
        marginBottom: "1.5rem",
        background: "#fef2f2",
        border: "1px solid #fca5a5",
        borderRadius: "0.5rem",
        padding: "0.875rem 1rem",
      }}
    >
      <strong style={{ color: "#991b1b" }}>Kill-aanbeveling ({flag.reasons.length})</strong>
      <ul
        style={{
          fontSize: "0.8125rem",
          color: "#7f1d1d",
          margin: "0.5rem 0",
          paddingLeft: "1.25rem",
        }}
      >
        {(flag.details ?? []).map((d) => (
          <li key={d.reason}>
            <strong>{d.reason}</strong> — {d.detail}
          </li>
        ))}
      </ul>
      {decidable ? (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <form
            action={async () => {
              "use server";
              await confirmKillFlagAction(flag.id);
            }}
          >
            <button
              type="submit"
              style={{ ...attachBtn, background: "#ef4444", borderColor: "#dc2626" }}
            >
              Bevestig kill
            </button>
          </form>
          <form
            action={async () => {
              "use server";
              await dismissKillFlagAction(flag.id);
            }}
          >
            <button
              type="submit"
              style={{
                ...attachBtn,
                background: "white",
                color: "#525252",
                borderColor: "#d4d4d4",
              }}
            >
              Negeren
            </button>
          </form>
        </div>
      ) : (
        <p style={{ fontSize: "0.8125rem", color: "#737373", margin: 0 }}>
          Niche staat al in <code>{nicheState}</code>.
        </p>
      )}
    </section>
  );
}

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
function ClaimGate({ check, tests }: { check: ClaimVerificationResult; tests: TestOption[] }) {
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
      <ul style={{ listStyle: "none", margin: "0.5rem 0 0", padding: 0 }}>
        {check.unsourced.map((u) => (
          <li key={u.claimId} style={{ marginBottom: "0.5rem" }}>
            <div style={{ fontSize: "0.75rem", color: "#7f1d1d" }}>
              {u.claimText} <span style={{ color: "#9ca3af" }}>({u.claimType})</span>
            </div>
            <ClaimSourceAttach claimId={u.claimId} tests={tests} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const attachField = {
  padding: "0.25rem 0.375rem",
  border: "1px solid #d4d4d4",
  borderRadius: "0.25rem",
  fontSize: "0.75rem",
} as const;
const attachBtn = {
  fontSize: "0.75rem",
  padding: "0.25rem 0.5rem",
  borderRadius: "0.25rem",
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "white",
  cursor: "pointer",
} as const;

// Inline per-claim source-attach widget: a web URL+excerpt, or a logged
// first-party test. Both clear the Claim-Verifier block (4.2.4 / 4.3.3).
function ClaimSourceAttach({ claimId, tests }: { claimId: string; tests: TestOption[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.25rem" }}>
      <form
        action={async (fd) => {
          "use server";
          await attachClaimUrlSourceAction(
            claimId,
            String(fd.get("url") ?? ""),
            String(fd.get("excerpt") ?? ""),
          );
        }}
        style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", alignItems: "center" }}
      >
        <input name="url" placeholder="https://bron…" style={{ ...attachField, width: "12rem" }} />
        <input name="excerpt" placeholder="citaat" style={{ ...attachField, width: "9rem" }} />
        <button type="submit" style={attachBtn}>
          + URL-bron
        </button>
      </form>
      {tests.length > 0 ? (
        <form
          action={async (fd) => {
            "use server";
            await attachClaimTestSourceAction(claimId, String(fd.get("fpt") ?? ""));
          }}
          style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}
        >
          <select name="fpt" style={attachField} defaultValue="">
            <option value="" disabled>
              eigen test…
            </option>
            {tests.map((t) => (
              <option key={t.id} value={t.id}>
                {t.product_name}
              </option>
            ))}
          </select>
          <button type="submit" style={attachBtn}>
            + Test
          </button>
        </form>
      ) : null}
    </div>
  );
}
