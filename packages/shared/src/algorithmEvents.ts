// Promotion Gate criterion 6 support — "no active Google update window"
// (docs/PROMOTION_GATE.md #6). Pure + I/O-free: the job loads algorithm_events
// rows (migration 0011) and this selects the ones overlapping the trailing 30
// days, mapped to the shape both the Promotion Agent and the Orchestrator Agent
// expect. Mirrors the other shared rollups (gscPageMetrics, nicheMonthlyMetrics).
//
// "Overlapping the last 30 days" = the rollout was active at some point in
// [asOf-30d, asOf]: it started on/before asOf AND (it is still ongoing — ended_at
// NULL — OR it ended on/after the window opened). A core update typically rolls
// for 2-3 weeks, so an ongoing one that began before the window still counts.

const THIRTY_DAYS_MS = 30 * 86_400_000;

/** One algorithm_events row as loaded from the DB (Dates) or a fixture (ISO). */
export interface AlgorithmEventRow {
  kind: string;
  startedAt: string | Date;
  /** NULL while the rollout is still in progress. */
  endedAt: string | Date | null;
}

/** The shape both agents consume (PromotionInput / OrchestratorInput). */
export interface AlgorithmEventForAgent {
  kind: string;
  started_at: string;
  ended_at: string | null;
}

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

/**
 * Select algorithm events active within the 30 days ending at `asOf`, mapped to
 * the agent shape and sorted by start ascending. Rows with an unparseable
 * started_at are dropped (defensive — a bad row must not silently widen or
 * shrink the gate's update window).
 */
export function selectAlgorithmEvents30d(
  rows: readonly AlgorithmEventRow[],
  asOf: Date,
): AlgorithmEventForAgent[] {
  const windowOpen = asOf.getTime() - THIRTY_DAYS_MS;

  const selected: Array<{ startedMs: number; event: AlgorithmEventForAgent }> = [];
  for (const r of rows) {
    const started = toDate(r.startedAt);
    if (Number.isNaN(started.getTime())) continue;
    // Not started yet relative to the run.
    if (started.getTime() > asOf.getTime()) continue;

    const ended = r.endedAt === null ? null : toDate(r.endedAt);
    if (ended && Number.isNaN(ended.getTime())) continue;
    // Ended before the window opened → no overlap.
    if (ended && ended.getTime() < windowOpen) continue;

    selected.push({
      startedMs: started.getTime(),
      event: {
        kind: r.kind,
        started_at: started.toISOString(),
        ended_at: ended ? ended.toISOString() : null,
      },
    });
  }

  return selected.sort((a, b) => a.startedMs - b.startedMs).map((s) => s.event);
}
