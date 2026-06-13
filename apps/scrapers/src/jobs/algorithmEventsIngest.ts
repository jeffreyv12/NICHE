// Promotion-gate criterion 6 INGEST job (migrations 0011 + 0012).
//
// Fetches the Google Search Status feed, keeps the Ranking-affecting incidents
// (core / spam / reviews / helpful-content updates and ranking disruptions), and
// UPSERTs them into `algorithm_events` keyed on (source, external_id). The read
// path (selectAlgorithmEvents30d, used by promotion.ts + orchestrator.ts) then
// blocks promotion whenever an update window overlaps the trailing 30 days.
//
// Idempotent by construction: re-running re-fetches the full feed and upserts,
// so an ongoing core update gets its `ended_at` filled once Google closes it,
// and no row is ever duplicated. Hand-seeded rows (external_id NULL) are never
// touched. Run DAILY, before promotion-once (see RUNBOOK).
//
// The fetch+map lives in the source wrapper / shared helper; this is the I/O
// shell. Injected db + injectable fetcher make it unit-testable without the live
// feed or a DB. Mirrors nicheMonthlyMetrics.ts.

import { type ServiceDb, algorithmEvents } from "@nichefinder/db";
import type { AlgorithmEventInsert } from "@nichefinder/shared";
import { sql } from "drizzle-orm";
import { SearchStatusClient } from "../sources/google-search-status/index.js";

export interface RunAlgorithmEventsIngestOptions {
  db: ServiceDb;
  /**
   * Injectable fetcher returning mapped ranking events. Defaults to a live
   * SearchStatusClient hitting status.search.google.com/incidents.json.
   */
  fetchRankingEvents?: () => Promise<AlgorithmEventInsert[]>;
}

export interface RunAlgorithmEventsIngestResult {
  /** Ranking-affecting events returned by the feed after mapping. */
  rankingEvents: number;
  /** Rows sent to the idempotent upsert. */
  rowsUpserted: number;
}

export async function runAlgorithmEventsIngestJob(
  opts: RunAlgorithmEventsIngestOptions,
): Promise<RunAlgorithmEventsIngestResult> {
  const fetchRankingEvents =
    opts.fetchRankingEvents ?? (() => new SearchStatusClient().fetchRankingEvents());

  const events = await fetchRankingEvents();
  if (events.length === 0) {
    // Empty feed (or no ranking incidents) is the safe default — leave the table
    // as-is. The gate reads "no overlapping event ⇒ criterion passes".
    return { rankingEvents: 0, rowsUpserted: 0 };
  }

  const rows = events.map((e) => ({
    kind: e.kind,
    name: e.name,
    startedAt: new Date(e.startedAt),
    endedAt: e.endedAt ? new Date(e.endedAt) : null,
    source: e.source,
    externalId: e.externalId,
  }));

  await opts.db
    .insert(algorithmEvents)
    .values(rows)
    .onConflictDoUpdate({
      target: [algorithmEvents.source, algorithmEvents.externalId],
      set: {
        // The feed is authoritative for this incident id, so each field takes
        // the freshly-fetched value (this is how an ongoing rollout's ended_at
        // gets filled in once Google closes it).
        kind: sql`excluded.kind`,
        name: sql`excluded.name`,
        startedAt: sql`excluded.started_at`,
        endedAt: sql`excluded.ended_at`,
      },
    });

  return { rankingEvents: events.length, rowsUpserted: rows.length };
}
