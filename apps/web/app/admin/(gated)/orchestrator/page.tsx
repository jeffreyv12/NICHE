// Phase 6.1.3 — Orchestrator weekly portfolio review, admin UI.
//
// Shows the most recent report (headline, alerts, action items, portfolio
// state, spend) and a history table of past runs. Read-only: the operator
// acts on the recommendations in the niches/kill-flags pages, not here.

import { requireAdmin } from "../../../../lib/auth";
import { getServiceRoleSupabase } from "../../../../lib/supabase";

export const dynamic = "force-dynamic";

interface OrchestratorOutput {
  week_of?: string;
  headline?: string;
  portfolio_state?: {
    candidate_count?: number;
    validating?: number;
    building?: number;
    mature?: number;
    promoted?: number;
    killed_lifetime?: number;
    kill_rate_12m?: number;
    promotion_rate_12m?: number;
  };
  spend?: {
    claude_mtd_eur?: number;
    affiliate_mtd_eur?: number;
  };
  kills_recommended?: string[];
  promotions_pending_operator?: string[];
  alerts?: { severity: string; message: string }[];
  operator_action_items?: string[];
}

interface AgentRunRow {
  id: string;
  started_at: string;
  status: string;
  cost_eur: string | null;
  output_json: OrchestratorOutput | null;
}

async function loadRuns(): Promise<AgentRunRow[]> {
  const supabase = getServiceRoleSupabase();
  const { data } = (await supabase
    .from("agent_runs")
    .select("id, started_at, status, cost_eur, output_json")
    .eq("agent", "orchestrator")
    .order("started_at", { ascending: false })
    .limit(20)) as { data: AgentRunRow[] | null };
  return data ?? [];
}

function eur(n: number): string {
  return `€${n.toFixed(2).replace(".", ",")}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function OrchestratorPage() {
  await requireAdmin();
  const runs = await loadRuns();
  const latest = runs[0];

  return (
    <article style={{ maxWidth: 800 }}>
      <h1 style={{ marginBottom: "0.25rem" }}>Orchestrator — portfolio review</h1>
      <p style={{ color: "#737373", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Wekelijks rapport (ma 06:00 NL). Lees de aanbevelingen en handel in de niche-pagina&apos;s
        of kill-flags.
      </p>

      {!latest ? (
        <EmptyState />
      ) : (
        <>
          <LatestRunCard run={latest} />
          <RunHistory runs={runs} />
        </>
      )}

      <HowToRunBox />
    </article>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        border: "1px dashed #d4d4d4",
        borderRadius: "0.5rem",
        padding: "2rem",
        textAlign: "center",
        color: "#737373",
        marginBottom: "1.5rem",
      }}
    >
      <p style={{ margin: 0 }}>Nog geen orchestrator-run gevonden.</p>
      <p style={{ margin: "0.5rem 0 0", fontSize: "0.875rem" }}>
        Start de eerste run met het commando hieronder.
      </p>
    </div>
  );
}

function LatestRunCard({ run }: { run: AgentRunRow }) {
  const statusColor =
    run.status === "done" ? "#065f46" : run.status === "error" ? "#991b1b" : "#92400e";
  const report = run.output_json;

  return (
    <section
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: "0.5rem",
        padding: "1.25rem 1.5rem",
        marginBottom: "1.5rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1rem" }}>Laatste run</h2>
        <span
          style={{
            background: "#f5f5f5",
            border: "1px solid #e5e5e5",
            borderRadius: "0.25rem",
            padding: "0.1rem 0.5rem",
            fontSize: "0.75rem",
            color: statusColor,
            fontWeight: 600,
          }}
        >
          {run.status}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(9rem, 1fr))",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        <Stat label="Datum" value={fmtDate(run.started_at)} />
        <Stat label="Run-ID" value={`${run.id.slice(0, 8)}…`} />
        <Stat label="Kosten" value={run.cost_eur ? eur(Number(run.cost_eur)) : "—"} />
      </div>

      {report ? (
        <ReportPanel report={report} />
      ) : (
        <p style={{ fontSize: "0.8125rem", color: "#737373", margin: 0 }}>
          Nog geen rapport-data beschikbaar (run voltooid vóór migratie 0013).
        </p>
      )}
    </section>
  );
}

function ReportPanel({ report }: { report: OrchestratorOutput }) {
  const ps = report.portfolio_state;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Headline */}
      {report.headline && (
        <div
          style={{
            background: "#f9fafb",
            border: "1px solid #e5e5e5",
            borderRadius: "0.375rem",
            padding: "0.75rem 1rem",
          }}
        >
          <p style={{ margin: 0, fontStyle: "italic", fontSize: "0.9375rem", color: "#111" }}>
            &ldquo;{report.headline}&rdquo;
          </p>
          {report.week_of && (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "#a3a3a3" }}>
              Week van {report.week_of}
            </p>
          )}
        </div>
      )}

      {/* Alerts */}
      {report.alerts && report.alerts.length > 0 && (
        <div>
          <h3 style={{ fontSize: "0.875rem", margin: "0 0 0.4rem", color: "#525252" }}>
            Meldingen ({report.alerts.length})
          </h3>
          <ul
            style={{
              margin: 0,
              padding: "0 0 0 1.25rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.25rem",
            }}
          >
            {report.alerts.map((a) => {
              const color =
                a.severity === "critical"
                  ? "#dc2626"
                  : a.severity === "warn"
                    ? "#d97706"
                    : "#2563eb";
              return (
                <li key={`${a.severity}:${a.message}`} style={{ fontSize: "0.8125rem", color }}>
                  <strong>[{a.severity}]</strong> {a.message}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Action items */}
      {report.operator_action_items && report.operator_action_items.length > 0 && (
        <div>
          <h3 style={{ fontSize: "0.875rem", margin: "0 0 0.4rem", color: "#525252" }}>
            Actiepunten operator
          </h3>
          <ol
            style={{
              margin: 0,
              padding: "0 0 0 1.25rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.25rem",
            }}
          >
            {report.operator_action_items.map((item) => (
              <li key={item} style={{ fontSize: "0.8125rem" }}>
                {item}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Portfolio state */}
      {ps && (
        <div>
          <h3 style={{ fontSize: "0.875rem", margin: "0 0 0.4rem", color: "#525252" }}>
            Portfolio-staat
          </h3>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {[
              { label: "Kandidaten", value: ps.candidate_count },
              { label: "Validating", value: ps.validating },
              { label: "Building", value: ps.building },
              { label: "Mature", value: ps.mature },
              { label: "Promoted", value: ps.promoted },
              { label: "Killed (lifetime)", value: ps.killed_lifetime },
            ]
              .filter((s) => s.value !== undefined)
              .map((s) => (
                <div
                  key={s.label}
                  style={{
                    border: "1px solid #e5e5e5",
                    borderRadius: "0.375rem",
                    padding: "0.375rem 0.625rem",
                    fontSize: "0.75rem",
                    minWidth: "5rem",
                  }}
                >
                  <div style={{ color: "#737373" }}>{s.label}</div>
                  <div style={{ fontWeight: 600, fontSize: "1.125rem" }}>{s.value}</div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Kills / promotions recommended */}
      {report.kills_recommended && report.kills_recommended.length > 0 && (
        <div>
          <h3 style={{ fontSize: "0.875rem", margin: "0 0 0.4rem", color: "#dc2626" }}>
            Kill-aanbevelingen ({report.kills_recommended.length})
          </h3>
          <ul style={{ margin: 0, padding: "0 0 0 1.25rem" }}>
            {report.kills_recommended.map((k) => (
              <li key={k} style={{ fontSize: "0.8125rem" }}>
                {k}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.promotions_pending_operator && report.promotions_pending_operator.length > 0 && (
        <div>
          <h3 style={{ fontSize: "0.875rem", margin: "0 0 0.4rem", color: "#059669" }}>
            Promoties wachten op goedkeuring ({report.promotions_pending_operator.length})
          </h3>
          <ul style={{ margin: 0, padding: "0 0 0 1.25rem" }}>
            {report.promotions_pending_operator.map((p) => (
              <li key={p} style={{ fontSize: "0.8125rem" }}>
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RunHistory({ runs }: { runs: AgentRunRow[] }) {
  if (runs.length <= 1) return null;
  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Geschiedenis (20 meest recent)</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#737373" }}>
            <th style={{ padding: "0.25rem 0.5rem 0.25rem 0" }}>Datum</th>
            <th style={{ padding: "0.25rem 0.5rem", textAlign: "right" }}>Status</th>
            <th style={{ padding: "0.25rem 0 0.25rem 0.5rem", textAlign: "right" }}>Kosten</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid #f0f0f0" }}>
              <td
                style={{ padding: "0.25rem 0.5rem 0.25rem 0", fontVariantNumeric: "tabular-nums" }}
              >
                {fmtDate(r.started_at)}
              </td>
              <td style={{ padding: "0.25rem 0.5rem", textAlign: "right" }}>{r.status}</td>
              <td style={{ padding: "0.25rem 0 0.25rem 0.5rem", textAlign: "right" }}>
                {r.cost_eur ? eur(Number(r.cost_eur)) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function HowToRunBox() {
  return (
    <section
      style={{
        background: "#fafafa",
        border: "1px solid #e5e5e5",
        borderRadius: "0.5rem",
        padding: "1rem 1.25rem",
      }}
    >
      <h2 style={{ fontSize: "0.875rem", margin: "0 0 0.5rem" }}>Handmatig starten (Hetzner)</h2>
      <pre
        style={{
          margin: 0,
          fontSize: "0.8125rem",
          overflowX: "auto",
          background: "transparent",
        }}
      >
        {"node dist/bin/orchestrator-once.js"}
      </pre>
      <p style={{ fontSize: "0.75rem", color: "#737373", margin: "0.5rem 0 0" }}>
        Automatisch elke maandag 06:00 NL via systemd-timer. Vereist <code>ANTHROPIC_API_KEY</code>{" "}
        en <code>DATABASE_URL</code>.
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #e5e5e5", borderRadius: "0.5rem", padding: "0.75rem 1rem" }}>
      <div style={{ fontSize: "0.75rem", color: "#737373" }}>{label}</div>
      <div style={{ fontSize: "1rem", fontWeight: 600 }}>{value}</div>
    </div>
  );
}
