#!/usr/bin/env node
// Cron + on-demand entrypoint for the Google Search Status ingestion
// (promotion-gate criterion 6 support, migrations 0011 + 0012). Fetches the
// official incidents feed, keeps Ranking-affecting updates, and upserts them
// into `algorithm_events`.
//
// Run it DAILY, BEFORE promotion-once (Sun 04:00 NL), so the gate's "no active
// Google update window" check reads a fresh feed.
//
//   node dist/bin/algorithm-events-ingest-once.js

import { getServiceDb } from "@nichefinder/db";
import { runAlgorithmEventsIngestJob } from "../jobs/algorithmEventsIngest.js";

async function main(): Promise<void> {
  const db = getServiceDb();
  const result = await runAlgorithmEventsIngestJob({ db });
  process.stdout.write(
    `${JSON.stringify({ event: "algorithm_events_ingest_job.done", ...result }, null, 2)}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(
    `algorithm-events-ingest-once failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
