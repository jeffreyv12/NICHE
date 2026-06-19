// Phase 6 — Admin jobs panel.
//
// Shows every background cron job: last-run status + cost for Claude agent jobs
// (tracked in agent_runs), static schedule + CLI command for all 15 jobs.
// Read-only; triggering happens via Hetzner CLI (see RUNBOOK.md §5).

import { requireAdmin } from "../../../../lib/auth";
import { getServiceRoleSupabase } from "../../../../lib/supabase";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Job catalogue (source of truth for schedule + CLI trigger)
// ---------------------------------------------------------------------------

type AgentName = "discovery" | "scoring" | "validation" | "content" | "promotion" | "orchestrator";

interface JobMeta {
  id: string;
  label: string;
  agent: AgentName | null; // null = data-only job, not tracked in agent_runs
  bin: string;
  schedule: string;
}

const JOBS: JobMeta[] = [
  {
    id: "discovery",
    label: "Discovery",
    agent: "discovery",
    bin: "discovery-once.js",
    schedule: "Dagelijks 01:00",
  },
  {
    id: "scoring",
    label: "Scoring",
    agent: "scoring",
    bin: "scoring-once.js",
    schedule: "Dagelijks 02:00",
  },
  {
    id: "validation",
    label: "Validation",
    agent: "validation",
    bin: "validation-once.js",
    schedule: "Dagelijks 02:30",
  },
  {
    id: "kill-scan",
    label: "Kill scan",
    agent: null,
    bin: "kill-scan-once.js",
    schedule: "Dagelijks 03:00",
  },
  {
    id: "niche-monthly-metrics",
    label: "Niche metrics",
    agent: null,
    bin: "niche-monthly-metrics-once.js",
    schedule: "Dagelijks 03:00",
  },
  {
    id: "algorithm-events-ingest",
    label: "Algorithm events",
    agent: null,
    bin: "algorithm-events-ingest-once.js",
    schedule: "Dagelijks 03:30",
  },
  {
    id: "promotion",
    label: "Promotion eval",
    agent: "promotion",
    bin: "promotion-once.js",
    schedule: "Zondag 04:00",
  },
  {
    id: "gsc-pull",
    label: "GSC pull",
    agent: null,
    bin: "gsc-pull-once.js",
    schedule: "Dagelijks 04:00",
  },
  {
    id: "reconciliation",
    label: "Reconciliation",
    agent: null,
    bin: "reconciliation-once.js",
    schedule: "Dagelijks 05:00",
  },
  {
    id: "bol-feed-sync",
    label: "Bol feed sync",
    agent: null,
    bin: "bol-feed-sync-once.js",
    schedule: "Dagelijks 06:00",
  },
  {
    id: "orchestrator",
    label: "Orchestrator",
    agent: "orchestrator",
    bin: "orchestrator-once.js",
    schedule: "Maandag 06:00",
  },
  {
    id: "test-page-draft",
    label: "Page draft",
    agent: "content",
    bin: "test-page-draft-once.js",
    schedule: "Handmatig",
  },
  {
    id: "content-polish",
    label: "Content polish",
    agent: "content",
    bin: "content-polish-once.js",
    schedule: "Handmatig",
  },
  {
    id: "migration",
    label: "Site migration",
    agent: null,
    bin: "migration-once.js",
    schedule: "Handmatig",
  },
  {
    id: "migration-dry-run",
    label: "Migration dry-run",
    agent: null,
    bin: "migration-dry-run-once.js",
    schedule: "Handmatig",
  },
];

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

interface LastRun {
  status: string;
  startedAt: string;
  finishedAt: string | null;
  costEur: string | null;
}

async function loadLastRuns(): Promise<Map<AgentName, LastRun>> {
  const supabase = getServiceRoleSupabase();
  const AGENT_NAMES: AgentName[] = [
    "discovery",
    "scoring",
    "validation",
    "content",
    "promotion",
    "orchestrator",
  ];

  const results = await Promise.all(
    AGENT_NAMES.map((agent) =>
      supabase
        .from("agent_runs")
        .select("status, started_at, finished_at, cost_eur")
        .eq("agent", agent)
        .order("started_at", { ascending: false })
        .limit(1)
        .then(({ data }) => ({ agent, row: data?.[0] ?? null })),
    ),
  );

  const map = new Map<AgentName, LastRun>();
  for (const { agent, row } of results) {
    if (row) {
      map.set(agent, {
        status: row.status as string,
        startedAt: row.started_at as string,
        finishedAt: (row.finished_at as string | null) ?? null,
        costEur: (row.cost_eur as string | null) ?? null,
      });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function durationMin(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return "—";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return `${Math.round(ms / 60_000)} min`;
}

function statusColor(status: string): string {
  if (status === "done") return "#15803d";
  if (status === "error" || status === "failed") return "#dc2626";
  if (status === "running") return "#d97706";
  return "#737373";
}

function statusBg(status: string): string {
  if (status === "done") return "#f0fdf4";
  if (status === "error" || status === "failed") return "#fef2f2";
  if (status === "running") return "#fffbeb";
  return "#f5f5f5";
}

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m geleden`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}u geleden`;
  return `${Math.floor(hr / 24)}d geleden`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function JobsPage() {
  await requireAdmin();
  const lastRuns = await loadLastRuns();

  // Track which agent names we've already shown a last-run row for.
  // test-page-draft + content-polish both map to agent="content"; the second
  // occurrence falls through to the "data jobs" display mode (CLI + schedule).
  const seenAgents = new Set<AgentName>();

  return (
    <article style={{ maxWidth: 960 }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.25rem" }}>Jobs</h1>
      <p style={{ color: "#737373", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Overzicht van alle achtergrond-jobs. Starten via Hetzner SSH (zie RUNBOOK.md §5).
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e5e5" }}>
            <Th>Job</Th>
            <Th>Schema</Th>
            <Th>Laatste run</Th>
            <Th>Status</Th>
            <Th right>Duur</Th>
            <Th right>Kosten</Th>
            <Th>CLI-commando</Th>
          </tr>
        </thead>
        <tbody>
          {JOBS.map((job) => {
            // Resolve last-run data (agent jobs only, first occurrence per agent).
            let lastRun: LastRun | undefined;
            let neverRun = false;

            if (job.agent !== null) {
              if (!seenAgents.has(job.agent)) {
                seenAgents.add(job.agent);
                lastRun = lastRuns.get(job.agent);
                neverRun = lastRun === undefined;
              }
              // second occurrence of the same agent → lastRun stays undefined,
              // neverRun stays false → falls through to "—" display
            }

            return (
              <tr key={job.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                {/* Job name */}
                <td
                  style={{
                    padding: "0.625rem 0.75rem 0.625rem 0",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  {job.label}
                  {job.agent && (
                    <span
                      style={{
                        fontWeight: 400,
                        color: "#a3a3a3",
                        fontSize: "0.75rem",
                        marginLeft: "0.375rem",
                      }}
                    >
                      ({job.agent})
                    </span>
                  )}
                </td>

                {/* Schedule */}
                <td style={{ padding: "0.625rem 0.75rem", color: "#525252", whiteSpace: "nowrap" }}>
                  {job.schedule}
                </td>

                {/* Laatste run */}
                <td style={{ padding: "0.625rem 0.75rem", whiteSpace: "nowrap" }}>
                  {lastRun ? (
                    <span title={fmtDate(lastRun.startedAt)} style={{ color: "#111" }}>
                      {ago(lastRun.startedAt)}
                    </span>
                  ) : neverRun ? (
                    <span style={{ color: "#a3a3a3" }}>Nog niet gerund</span>
                  ) : (
                    <span style={{ color: "#d4d4d4" }}>—</span>
                  )}
                </td>

                {/* Status badge */}
                <td style={{ padding: "0.625rem 0.75rem" }}>
                  {lastRun ? (
                    <span
                      style={{
                        background: statusBg(lastRun.status),
                        color: statusColor(lastRun.status),
                        border: `1px solid ${statusColor(lastRun.status)}40`,
                        borderRadius: "0.25rem",
                        padding: "0.1rem 0.45rem",
                        fontWeight: 600,
                        fontSize: "0.75rem",
                      }}
                    >
                      {lastRun.status}
                    </span>
                  ) : (
                    <span style={{ color: "#d4d4d4" }}>—</span>
                  )}
                </td>

                {/* Duur */}
                <td
                  style={{
                    padding: "0.625rem 0.75rem",
                    textAlign: "right",
                    color: "#525252",
                    whiteSpace: "nowrap",
                  }}
                >
                  {lastRun ? durationMin(lastRun.startedAt, lastRun.finishedAt) : "—"}
                </td>

                {/* Kosten */}
                <td
                  style={{ padding: "0.625rem 0.75rem", textAlign: "right", whiteSpace: "nowrap" }}
                >
                  {lastRun?.costEur ? (
                    <span style={{ color: "#111" }}>
                      €{Number(lastRun.costEur).toFixed(3).replace(".", ",")}
                    </span>
                  ) : (
                    <span style={{ color: "#d4d4d4" }}>—</span>
                  )}
                </td>

                {/* CLI */}
                <td style={{ padding: "0.625rem 0 0.625rem 0.75rem" }}>
                  <code
                    style={{
                      fontFamily: "monospace",
                      fontSize: "0.75rem",
                      background: "#f5f5f5",
                      border: "1px solid #e5e5e5",
                      borderRadius: "0.25rem",
                      padding: "0.1rem 0.375rem",
                      color: "#1d4ed8",
                      whiteSpace: "nowrap",
                    }}
                  >
                    node dist/bin/{job.bin}
                  </code>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <HetznerBox />
    </article>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      style={{
        padding: `0.5rem 0.75rem 0.5rem ${right ? "0.75rem" : "0"}`,
        fontSize: "0.75rem",
        color: "#737373",
        fontWeight: 600,
        textAlign: right ? "right" : "left",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function HetznerBox() {
  return (
    <section
      style={{
        marginTop: "2rem",
        background: "#fafafa",
        border: "1px solid #e5e5e5",
        borderRadius: "0.5rem",
        padding: "1rem 1.25rem",
        maxWidth: 600,
      }}
    >
      <h2 style={{ fontSize: "0.875rem", margin: "0 0 0.5rem" }}>Alle jobs herstarten (Hetzner)</h2>
      <pre
        style={{ margin: 0, fontSize: "0.8125rem", background: "transparent", overflowX: "auto" }}
      >
        {
          "ssh hetzner\nsystemctl restart nichefinder-scrapers\nsystemctl status  nichefinder-scrapers"
        }
      </pre>
      <p style={{ fontSize: "0.75rem", color: "#737373", margin: "0.5rem 0 0" }}>
        Zie <strong>RUNBOOK.md §5</strong> voor per-job herstart en scheduling.
      </p>
    </section>
  );
}
