// Phase 6.3.2 — Claude cost dashboard.
//
// Month-to-date spend, projected month-end, cache-hit ratio and batch share,
// rolled up from agent_runs by the shared summarizeCosts aggregator. The budget
// alert (CLAUDE.md #7) keys off the same numbers; the hard pause itself lives in
// the agent-sdk cost guard.

import { type AgentRunCost, type CostAlertLevel, summarizeCosts } from "@nichefinder/shared";
import { requireAdmin } from "../../../../lib/auth";
import { getServiceRoleSupabase } from "../../../../lib/supabase";

export const dynamic = "force-dynamic";

interface RunRow {
  agent: string;
  model: string;
  cost_eur: string | null;
  input_tokens: number | null;
  cache_read_tokens: number | null;
  is_batch: boolean;
}

async function loadMonthRuns(sinceIso: string): Promise<AgentRunCost[]> {
  const supabase = getServiceRoleSupabase();
  const { data } = (await supabase
    .from("agent_runs")
    .select("agent, model, cost_eur, input_tokens, cache_read_tokens, is_batch")
    .gte("started_at", sinceIso)
    .limit(100_000)) as { data: RunRow[] | null };

  return (data ?? []).map((r) => ({
    agent: r.agent,
    model: r.model,
    costEur: r.cost_eur ? Number(r.cost_eur) : 0,
    inputTokens: r.input_tokens ?? 0,
    cacheReadTokens: r.cache_read_tokens ?? 0,
    isBatch: r.is_batch,
  }));
}

function eur(n: number): string {
  return `€${n.toFixed(2).replace(".", ",")}`;
}
function pct(n: number): string {
  return `${n.toFixed(0)}%`;
}

const ALERT_STYLE: Record<
  CostAlertLevel,
  { bg: string; border: string; fg: string; label: string }
> = {
  ok: { bg: "#ecfdf5", border: "#a7f3d0", fg: "#065f46", label: "Binnen budget" },
  warn: { bg: "#fffbeb", border: "#fde68a", fg: "#92400e", label: "Let op — richting 80%+" },
  over: { bg: "#fef2f2", border: "#fecaca", fg: "#991b1b", label: "Over budget" },
};

export default async function AdminCostsPage() {
  await requireAdmin();

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const sinceIso = new Date(Date.UTC(year, month, 1)).toISOString();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const budgetEur = Number(process.env.CLAUDE_MONTHLY_BUDGET_EUR ?? 200);

  const runs = await loadMonthRuns(sinceIso);
  const s = summarizeCosts(runs, { budgetEur, dayOfMonth, daysInMonth });
  const alert = ALERT_STYLE[s.alertLevel];

  return (
    <article style={{ maxWidth: "56rem" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Claude-kosten (deze maand)</h1>

      <div
        style={{
          background: alert.bg,
          border: `1px solid ${alert.border}`,
          color: alert.fg,
          borderRadius: "0.5rem",
          padding: "0.75rem 1rem",
          marginBottom: "1.25rem",
          fontSize: "0.875rem",
        }}
      >
        <strong>{alert.label}.</strong> {eur(s.mtdSpendEur)} van {eur(budgetEur)} (
        {pct(s.pctOfBudget)}) · prognose maandeinde {eur(s.projectedMonthEndEur)} (
        {pct(s.projectedPctOfBudget)}).
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        <Stat label="MTD-uitgaven" value={eur(s.mtdSpendEur)} />
        <Stat label="Prognose maandeinde" value={eur(s.projectedMonthEndEur)} />
        <Stat label="% van budget" value={pct(s.pctOfBudget)} />
        <Stat label="Cache-hit ratio" value={pct(s.cacheHitRatio * 100)} />
        <Stat label="Batch-aandeel" value={pct(s.batchSharePct)} />
        <Stat label="Agent-runs" value={String(s.runCount)} />
      </div>

      <CostTable title="Per model" buckets={s.byModel} />
      <CostTable title="Per agent" buckets={s.byAgent} />

      <p style={{ fontSize: "0.75rem", color: "#737373", marginTop: "1rem" }}>
        Doelverdeling (CLAUDE.md #7): Haiku ~60% · Sonnet ~35% · Opus ~5%. Cache-hit-doel ≥30%.
      </p>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #e5e5e5", borderRadius: "0.5rem", padding: "0.75rem 1rem" }}>
      <div style={{ fontSize: "0.75rem", color: "#737373" }}>{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function CostTable({
  title,
  buckets,
}: {
  title: string;
  buckets: Record<string, { costEur: number; runs: number }>;
}) {
  const rows = Object.entries(buckets).sort((a, b) => b[1].costEur - a[1].costEur);
  return (
    <section style={{ marginBottom: "1.25rem" }}>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>{title}</h2>
      {rows.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#525252" }}>Nog geen runs deze maand.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#737373" }}>
              <th style={{ padding: "0.25rem 0" }}>Naam</th>
              <th style={{ padding: "0.25rem 0", textAlign: "right" }}>Runs</th>
              <th style={{ padding: "0.25rem 0", textAlign: "right" }}>Kosten</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, b]) => (
              <tr key={name} style={{ borderTop: "1px solid #f0f0f0" }}>
                <td style={{ padding: "0.25rem 0" }}>
                  <code>{name}</code>
                </td>
                <td style={{ padding: "0.25rem 0", textAlign: "right" }}>{b.runs}</td>
                <td style={{ padding: "0.25rem 0", textAlign: "right" }}>{eur(b.costEur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
