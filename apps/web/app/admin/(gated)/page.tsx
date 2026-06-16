// Admin operational dashboard — Phase 6 MVP.
//
// One screen shows everything that needs operator attention today:
// niche pipeline state, pending approvals, recent kill flags, MTD Claude spend,
// and active/failed migrations.

import Link from "next/link";
import { getServiceRoleSupabase } from "../../../lib/supabase";

export const dynamic = "force-dynamic";

interface NicheRow {
  id: string;
  topic: string;
  state: string;
  score: number | null;
  updated_at: string;
}

interface DashboardData {
  niches: NicheRow[];
  killFlagNicheIds: Set<string>;
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
      supabase
        .from("niches")
        .select("id, topic, state, score, updated_at")
        .order("updated_at", { ascending: false }),
      supabase.from("pages").select("id", { count: "exact", head: true }).eq("state", "draft"),
      supabase
        .from("kill_flags")
        .select("niche_id")
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

  const killFlagNicheIds = new Set<string>(
    (killFlagsRes.data ?? []).map((r) => r.niche_id as string).filter(Boolean),
  );

  const migrations = migrationsRes.data ?? [];
  const pendingMigrations = migrations.filter(
    (m) => m.status === "pending" || m.status === "running",
  ).length;
  const failedMigrations = migrations.filter((m) => m.status === "failed").length;

  const mtdSpendEur = (spendRes.data ?? []).reduce((sum, r) => sum + (r.cost_eur ?? 0), 0);

  return {
    niches: (nichesRes.data ?? []) as NicheRow[],
    killFlagNicheIds,
    pendingPages: pendingPagesRes.count ?? 0,
    openKillFlags: killFlagNicheIds.size,
    pendingMigrations,
    failedMigrations,
    mtdSpendEur,
    budgetEur,
    agentRunsToday: runsRes.count ?? 0,
    promotionReady: promotionRes.count ?? 0,
  };
}

// States shown as kanban columns (with niche cards); "killed" is count-only.
const KANBAN_STATES = ["discovery", "validating", "building", "mature", "promoted"] as const;

const NICHE_STATE_COLOR: Record<string, string> = {
  discovery: "#3b82f6",
  validating: "#f59e0b",
  building: "#8b5cf6",
  mature: "#22c55e",
  promoted: "#06b6d4",
  killed: "#ef4444",
};

function daysAgo(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
}

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
        <StatCard label="Pending page approvals" value={d.pendingPages} href="/admin/content" />
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

      {/* Niche pipeline kanban */}
      <div>
        <p style={{ fontSize: "0.8125rem", color: "#737373", marginBottom: "0.75rem" }}>
          Niche pipeline
        </p>
        <div
          style={{ display: "flex", gap: "0.75rem", overflowX: "auto", paddingBottom: "0.5rem" }}
        >
          {KANBAN_STATES.map((state) => {
            const niches = d.niches.filter((n) => n.state === state);
            const color = NICHE_STATE_COLOR[state] ?? "#737373";
            return (
              <div
                key={state}
                style={{
                  minWidth: 180,
                  maxWidth: 220,
                  flexShrink: 0,
                  background: "#fafafa",
                  border: "1px solid #e5e5e5",
                  borderRadius: "0.5rem",
                  overflow: "hidden",
                }}
              >
                {/* Column header */}
                <Link href={`/admin/niches?state=${state}`} style={{ textDecoration: "none" }}>
                  <div
                    style={{
                      background: `${color}14`,
                      borderBottom: `2px solid ${color}`,
                      padding: "0.5rem 0.75rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color,
                        textTransform: "capitalize",
                      }}
                    >
                      {state}
                    </span>
                    <span
                      style={{
                        background: color,
                        color: "#fff",
                        borderRadius: "9999px",
                        fontSize: "0.6875rem",
                        fontWeight: 700,
                        padding: "0 0.4rem",
                        lineHeight: "1.4rem",
                      }}
                    >
                      {niches.length}
                    </span>
                  </div>
                </Link>

                {/* Cards */}
                <div
                  style={{
                    padding: "0.5rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.375rem",
                  }}
                >
                  {niches.length === 0 && (
                    <p
                      style={{
                        fontSize: "0.75rem",
                        color: "#a3a3a3",
                        textAlign: "center",
                        padding: "0.75rem 0",
                      }}
                    >
                      —
                    </p>
                  )}
                  {niches.map((niche) => {
                    const hasKillFlag = d.killFlagNicheIds.has(niche.id);
                    const days = daysAgo(niche.updated_at);
                    const cardBorder = hasKillFlag ? "1px solid #f59e0b" : "1px solid #e5e5e5";
                    return (
                      <Link
                        key={niche.id}
                        href={`/admin/niches/${niche.id}`}
                        style={{ textDecoration: "none" }}
                      >
                        <div
                          style={{
                            background: "#fff",
                            border: cardBorder,
                            borderRadius: "0.375rem",
                            padding: "0.5rem 0.625rem",
                          }}
                        >
                          {/* Topic + kill-flag dot */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: "0.25rem",
                              marginBottom: "0.25rem",
                            }}
                          >
                            {hasKillFlag && (
                              <span
                                style={{
                                  color: "#f59e0b",
                                  fontSize: "0.625rem",
                                  lineHeight: "1.4",
                                  flexShrink: 0,
                                }}
                              >
                                ●
                              </span>
                            )}
                            <span
                              style={{
                                fontSize: "0.8125rem",
                                fontWeight: 600,
                                color: "#111",
                                lineHeight: 1.3,
                                wordBreak: "break-word",
                              }}
                            >
                              {niche.topic}
                            </span>
                          </div>
                          {/* Score + age badges */}
                          <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                            {niche.score !== null && (
                              <span
                                style={{
                                  background: "#f5f5f5",
                                  border: "1px solid #e5e5e5",
                                  borderRadius: "0.25rem",
                                  fontSize: "0.6875rem",
                                  color: "#525252",
                                  padding: "0 0.3rem",
                                }}
                              >
                                {niche.score}/100
                              </span>
                            )}
                            <span
                              style={{
                                background: days > 14 ? "#fef3c7" : "#f5f5f5",
                                border: `1px solid ${days > 14 ? "#fbbf24" : "#e5e5e5"}`,
                                borderRadius: "0.25rem",
                                fontSize: "0.6875rem",
                                color: days > 14 ? "#92400e" : "#737373",
                                padding: "0 0.3rem",
                              }}
                            >
                              {days}d
                            </span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Killed — count only, not a full column */}
        {(() => {
          const killedCount = d.niches.filter((n) => n.state === "killed").length;
          if (killedCount === 0) return null;
          return (
            <div style={{ marginTop: "0.75rem" }}>
              <Link href="/admin/niches?state=killed" style={{ textDecoration: "none" }}>
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "#ef4444",
                    border: "1px solid #ef444440",
                    borderRadius: "0.375rem",
                    padding: "0.25rem 0.625rem",
                    background: "#ef444408",
                  }}
                >
                  {killedCount} killed
                </span>
              </Link>
            </div>
          );
        })()}
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
