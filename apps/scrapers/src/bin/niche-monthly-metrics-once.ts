#!/usr/bin/env node
// Cron + on-demand entrypoint for the per-niche monthly-metrics rollup
// (Phase 5.4 support, migration 0009). Recomputes the trailing window of
// monthly revenue closes and upserts them; revenue only (no organic clicks yet).
//
// Run it BEFORE the promotion job (Sun 04:00 NL) so the gate reads fresh closes.
//
//   node dist/bin/niche-monthly-metrics-once.js                # all tracked niches
//   node dist/bin/niche-monthly-metrics-once.js --niche <uuid> # one niche

import { getServiceDb } from "@nichefinder/db";
import { runNicheMonthlyMetricsJob } from "../jobs/nicheMonthlyMetrics.js";

function parseNicheArg(argv: string[]): string | undefined {
  const idx = argv.indexOf("--niche");
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return undefined;
}

async function main(): Promise<void> {
  const db = getServiceDb();
  const result = await runNicheMonthlyMetricsJob({
    db,
    nicheId: parseNicheArg(process.argv.slice(2)),
  });
  process.stdout.write(
    `${JSON.stringify({ event: "niche_monthly_metrics_job.done", ...result }, null, 2)}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(
    `niche-monthly-metrics-once failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
