// Phase 5.5 — Promotion migration monitor.
//
// Shows all promotion_migrations rows so the operator can see which step
// each migration is on and whether any have failed. Running migrations are
// kicked off by `node dist/bin/migration-once.js <migrationId>` on Hetzner.

export const dynamic = "force-dynamic";

import { requireAdmin } from "../../../../lib/auth";
import { getServiceRoleSupabase } from "../../../../lib/supabase";

interface MigrationRow {
  id: string;
  niche_id: string;
  domain_registration_id: string | null;
  status: string;
  current_step: number | null;
  step_logs: Array<{
    step: number;
    name: string;
    status: string;
    started_at: string;
    error?: string;
  }>;
  operator_email: string | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  failed_step: number | null;
  created_at: string;
  niche_topic: string | null;
  hostname: string | null;
}

const STEP_NAMES: Record<number, string> = {
  0: "freeze_edits",
  1: "snapshot_export",
  2: "register_domain",
  3: "dns_setup",
  4: "vercel_attach",
  5: "ssl_poll",
  6: "canonical_tags",
  7: "301_redirects",
  8: "hreflang",
  9: "sitemap_indexnow",
  10: "gsc_property",
  11: "promote_niche_state",
  12: "schedule_monitoring",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b",
  running: "#3b82f6",
  done: "#22c55e",
  failed: "#ef4444",
};

async function load(): Promise<MigrationRow[]> {
  const supabase = getServiceRoleSupabase();

  const { data } = await supabase
    .from("promotion_migrations")
    .select(
      `id, niche_id, domain_registration_id, status, current_step, step_logs,
       operator_email, started_at, completed_at, failed_at, failed_step, created_at,
       niches!inner(topic),
       domain_registrations(hostname)`,
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return (data ?? []).map((row) => {
    const nicheRow = row.niches as unknown as { topic: string };
    const drRow = row.domain_registrations as unknown as { hostname: string } | null;
    return {
      id: row.id,
      niche_id: row.niche_id,
      domain_registration_id: row.domain_registration_id,
      status: row.status,
      current_step: row.current_step,
      step_logs: (row.step_logs ?? []) as MigrationRow["step_logs"],
      operator_email: row.operator_email,
      started_at: row.started_at,
      completed_at: row.completed_at,
      failed_at: row.failed_at,
      failed_step: row.failed_step,
      created_at: row.created_at,
      niche_topic: nicheRow?.topic ?? null,
      hostname: drRow?.hostname ?? null,
    };
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" });
}

export default async function MigrationsPage() {
  await requireAdmin();
  const rows = await load();

  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>
        Promotion Migrations
      </h1>
      <p style={{ color: "#525252", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Run a migration manually on Hetzner:{" "}
        <code>node dist/bin/migration-once.js &lt;migrationId&gt;</code>
      </p>

      {rows.length === 0 && (
        <p style={{ color: "#737373" }}>
          No migrations yet. Confirm a domain in Promotions to start one.
        </p>
      )}

      {rows.map((row) => (
        <MigrationCard key={row.id} row={row} />
      ))}
    </div>
  );
}

function MigrationCard({ row }: { row: MigrationRow }) {
  const color = STATUS_COLORS[row.status] ?? "#737373";
  const totalSteps = 13;
  const pct = Math.round(((row.current_step ?? 0) / totalSteps) * 100);

  return (
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: "0.5rem",
        padding: "1.25rem",
        marginBottom: "1rem",
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "0.75rem",
        }}
      >
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.2rem" }}>
            {row.niche_topic ?? row.niche_id}
          </h2>
          <p style={{ fontSize: "0.8125rem", color: "#737373" }}>
            {row.hostname ?? "—"} · <code style={{ fontSize: "0.75rem" }}>{row.id}</code>
          </p>
        </div>
        <span
          style={{
            background: `${color}22`,
            color,
            border: `1px solid ${color}`,
            borderRadius: "9999px",
            padding: "0.2rem 0.65rem",
            fontSize: "0.75rem",
            fontWeight: 600,
            textTransform: "uppercase",
          }}
        >
          {row.status}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: "0.75rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "0.75rem",
            color: "#737373",
            marginBottom: "0.25rem",
          }}
        >
          <span>
            Step {row.current_step ?? 0}/{totalSteps}
            {row.current_step != null && STEP_NAMES[row.current_step]
              ? ` — ${STEP_NAMES[row.current_step]}`
              : ""}
          </span>
          <span>{pct}%</span>
        </div>
        <div style={{ background: "#f5f5f5", borderRadius: "9999px", height: "6px" }}>
          <div
            style={{
              background: color,
              width: `${pct}%`,
              height: "6px",
              borderRadius: "9999px",
              transition: "width 0.3s",
            }}
          />
        </div>
      </div>

      {/* Timestamps */}
      <div
        style={{
          display: "flex",
          gap: "1.5rem",
          fontSize: "0.8125rem",
          color: "#737373",
          marginBottom: "0.75rem",
        }}
      >
        <span>Created: {formatDate(row.created_at)}</span>
        {row.completed_at && <span>Completed: {formatDate(row.completed_at)}</span>}
        {row.failed_at && (
          <span style={{ color: "#ef4444" }}>
            Failed at step {row.failed_step} ({STEP_NAMES[row.failed_step ?? -1] ?? "unknown"}):
            {formatDate(row.failed_at)}
          </span>
        )}
      </div>

      {/* Step log table */}
      {row.step_logs.length > 0 && (
        <details>
          <summary
            style={{
              cursor: "pointer",
              fontSize: "0.8125rem",
              color: "#525252",
              marginBottom: "0.5rem",
            }}
          >
            Step log ({row.step_logs.length} entries)
          </summary>
          <table style={{ width: "100%", fontSize: "0.75rem", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e5e5" }}>
                <th style={{ textAlign: "left", padding: "0.2rem 0.5rem" }}>#</th>
                <th style={{ textAlign: "left", padding: "0.2rem 0.5rem" }}>Step</th>
                <th style={{ textAlign: "left", padding: "0.2rem 0.5rem" }}>Status</th>
                <th style={{ textAlign: "left", padding: "0.2rem 0.5rem" }}>Started</th>
                <th style={{ textAlign: "left", padding: "0.2rem 0.5rem" }}>Error</th>
              </tr>
            </thead>
            <tbody>
              {row.step_logs.map((log) => (
                <tr key={log.step} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "0.2rem 0.5rem" }}>{log.step}</td>
                  <td style={{ padding: "0.2rem 0.5rem", fontFamily: "monospace" }}>{log.name}</td>
                  <td
                    style={{
                      padding: "0.2rem 0.5rem",
                      color:
                        log.status === "done"
                          ? "#22c55e"
                          : log.status === "failed"
                            ? "#ef4444"
                            : "#f59e0b",
                    }}
                  >
                    {log.status}
                  </td>
                  <td style={{ padding: "0.2rem 0.5rem" }}>{formatDate(log.started_at)}</td>
                  <td
                    style={{
                      padding: "0.2rem 0.5rem",
                      color: "#ef4444",
                      maxWidth: "20rem",
                      wordBreak: "break-all",
                    }}
                  >
                    {log.error ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
