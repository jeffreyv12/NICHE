// Phase 6.1.3 — Orchestrator weekly portfolio review, admin UI.
//
// Shows the most recent report (headline, alerts, action items, portfolio
// state, spend) and a history table of past runs. Read-only: the operator
// acts on the recommendations in the niches/kill-flags pages, not here.

import { requireAdmin } from "../../../../lib/auth";
import { getServiceRoleSupabase } from "../../../../lib/supabase";

export const dynamic = "force-dynamic";

interface AgentRunRow {
  id: string;
  started_at: string;
  status: string;
  cost_eur: string | null;
  output_hash: string | null;
}

// The orchestrator writes its structured output as outputHash; we piggyback
// the full JSON in a separate query via Supabase's JSONB storage if we add it
// later. For now we surface per-run metadata and load the latest report
// separately from the orchestrator_reports view (if it exists) or fall back to
// a stub message.

async function loadRuns(): Promise<AgentRunRow[]> {
  const supabase = getServiceRoleSupabase();
  const { data } = (await supabase
    .from("agent_runs")
    .select("id, started_at, status, cost_eur, output_hash")
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

      <p style={{ fontSize: "0.8125rem", color: "#525252", margin: 0 }}>
        Het volledige rapport (headline, portfolio-staat, aanbevelingen) wordt in een toekomstige
        iteratie rechtstreeks uit de <code>agent_runs</code>-JSONB weergegeven. Gebruik de CLI-
        output (stdout) van <code>orchestrator-once.js</code> om het rapport nu te lezen.
      </p>
    </section>
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
