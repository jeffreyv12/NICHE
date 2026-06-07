// Admin operational dashboard — Phase 6 MVP.
//
// One screen shows everything that needs operator attention today:
// niche pipeline state, pending approvals, recent kill flags, MTD Claude spend,
// and active/failed migrations.

import Link from "next/link";
import { getServiceRoleSupabase } from "../../../lib/supabase";

export const dynamic = "force-dynamic";

interface DashboardData {
  nicheCounts: Record<string, number>;
  pendingPages: number;
  openKillFlags: number;
  pendingMigrations: number;
  failedMigrations: number;
  mtdSpendEur: number;
  budgetEur: number;
  agentRunsToday: number;
  promotionReady: number;
}

async function loadDashboard(): Promise<DashboardData> {
  const supabase = getServiceRoleSupabase();
  const budgetEur = Number(process.env.CLAUDE_MONTHLY_BUDGET_EUR ?? 200);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [nichesRes, pendingPagesRes, killFlagsRes, migrationsRes, spendRes, runsRes, promotionRes] =
    await Promise.all([
      supabase.from("niches").select("state"),
      supabase.from("pages").select("id", { count: "exact", head: true }).eq("state", "draft"),
      supabase
        .from("kill_flags")
        .select("id", { count: "exact", head: true })
        .is("confirmed_at", null)
        .is("dismissed_at", null),
      supabase.from("promotion_migrations").select("status"),
      supabase.from("agent_runs").select("cost_eur").gte("started_at", startOfMonth.toISOString()),
      supabase
        .from("agent_runs")
        .select("id", { count: "exact", head: true })
        .gte("started_at", startOfDay.toISOString()),
      supabase
        .from("promotion_evaluations")
        .select("id", { count: "exact", head: true })
        .eq("result", "ready"),
    ]);

  const nicheCounts: Record<string, number> = {};
  for (const row of nichesRes.data ?? []) {
    nicheCounts[row.state] = (nicheCounts[row.state] ?? 0) + 1;
  }

  const migrations = migrationsRes.data ?? [];
  const pendingMigrations = migrations.filter(
    (m) => m.status === "pending" || m.status === "running",
  ).length;
  const failedMigrations = migrations.filter((m) => m.status === "failed").length;

  const mtdSpendEur = (spendRes.data ?? []).reduce((sum, r) => sum + (r.cost_eur ?? 0), 0);

  return {
    nicheCounts,
    pendingPages: pendingPagesRes.count ?? 0,
    openKillFlags: killFlagsRes.count ?? 0,
    pendingMigrations,
    failedMigrations,
    mtdSpendEur,
    budgetEur,
    agentRunsToday: runsRes.count ?? 0,
    promotionReady: promotionRes.count ?? 0,
  };
}

const NICHE_STATE_ORDER = ["discovery", "validating", "building", "mature", "promoted", "killed"];

const NICHE_STATE_COLOR: Record<string, string> = {
  discovery: "#3b82f6",
  validating: "#f59e0b",
  building: "#8b5cf6",
  mature: "#22c55e",
  promoted: "#06b6d4",
  killed: "#ef4444",
};

export default async function AdminDashboard() {
  const d = await loadDashboard();
  const spendPct = Math.min(100, Math.round((d.mtdSpendEur / d.budgetEur) * 100));
  const spendColor = spendPct >= 80 ? "#ef4444" : spendPct >= 60 ? "#f59e0b" : "#22c55e";

  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1.25rem" }}>Dashboard</h1>

      {/* Alerts row */}
      {(d.openKillFlags > 0 || d.failedMigrations > 0 || spendPct >= 80) && (
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
          {d.openKillFlags > 0 && (
            <Alert
              color="#ef4444"
              label={`${d.openKillFlags} open kill flag${d.openKillFlags > 1 ? "s" : ""}`}
              href="/admin/niches"
            />
          )}
          {d.failedMigrations > 0 && (
            <Alert
              color="#ef4444"
              label={`${d.failedMigrations} failed migration${d.failedMigrations > 1 ? "s" : ""}`}
              href="/admin/migrations"
            />
          )}
          {spendPct >= 80 && (
            <Alert
              color="#f59e0b"
              label={`Claude spend at ${spendPct}% of monthly budget`}
              href="/admin/costs"
            />
          )}
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        <StatCard label="Pending page approvals" value={d.pendingPages} href="/admin/tests" />
        <StatCard label="Promotion ready" value={d.promotionReady} href="/admin/promotions" />
        <StatCard label="Active migrations" value={d.pendingMigrations} href="/admin/migrations" />
        <StatCard label="Agent runs today" value={d.agentRunsToday} />
      </div>

      {/* Claude spend */}
      <div
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: "0.5rem",
          padding: "1rem",
          marginBottom: "1.25rem",
          maxWidth: 400,
        }}
      >
        <p style={{ fontSize: "0.8125rem", color: "#737373", marginBottom: "0.5rem" }}>
          Claude spend — MTD
        </p>
        <p
          style={{ fontSize: "1.5rem", fontWeight: 700, color: spendColor, marginBottom: "0.4rem" }}
        >
          €{d.mtdSpendEur.toFixed(2)}{" "}
          <span style={{ fontSize: "0.875rem", color: "#737373", fontWeight: 400 }}>
            / €{d.budgetEur} ({spendPct}%)
          </span>
        </p>
        <div style={{ background: "#f5f5f5", borderRadius: "9999px", height: "6px" }}>
          <div
            style={{
              background: spendColor,
              width: `${spendPct}%`,
              height: "6px",
              borderRadius: "9999px",
            }}
          />
        </div>
      </div>

      {/* Niche pipeline */}
      <div
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: "0.5rem",
          padding: "1rem",
          maxWidth: 560,
        }}
      >
        <p style={{ fontSize: "0.8125rem", color: "#737373", marginBottom: "0.75rem" }}>
          Niche pipeline
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {NICHE_STATE_ORDER.map((state) => {
            const count = d.nicheCounts[state] ?? 0;
            if (count === 0) return null;
            return (
              <Link
                key={state}
                href={`/admin/niches?state=${state}`}
                style={{ textDecoration: "none" }}
              >
                <div
                  style={{
                    background: `${NICHE_STATE_COLOR[state]}18`,
                    border: `1px solid ${NICHE_STATE_COLOR[state]}`,
                    borderRadius: "0.375rem",
                    padding: "0.4rem 0.75rem",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: "1.25rem",
                      fontWeight: 700,
                      color: NICHE_STATE_COLOR[state],
                    }}
                  >
                    {count}
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "#525252" }}>{state}</div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href?: string;
}) {
  const inner = (
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: "0.5rem",
        padding: "0.875rem 1rem",
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: "0.75rem", color: "#737373" }}>{label}</div>
      <div style={{ fontSize: "1.75rem", fontWeight: 600, color: value > 0 ? "#111" : "#d4d4d4" }}>
        {value}
      </div>
    </div>
  );
  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none" }}>
        {inner}
      </Link>
    );
  }
  return inner;
}

function Alert({ color, label, href }: { color: string; label: string; href: string }) {
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      <div
        style={{
          background: `${color}12`,
          border: `1px solid ${color}`,
          borderRadius: "0.375rem",
          padding: "0.4rem 0.875rem",
          fontSize: "0.8125rem",
          color,
          fontWeight: 600,
        }}
      >
        ⚠ {label}
      </div>
    </Link>
  );
}
