#!/usr/bin/env node
// Cron + on-demand entrypoint for conversion reconciliation (Phase 3.2.5).
//
// Hetzner runs this via a systemd timer daily (e.g. 05:00 NL), after the
// networks have settled the prior day. Idempotent — safe to re-run.
//
//   node dist/bin/reconciliation-once.js                  # default 3-day window
//   node dist/bin/reconciliation-once.js --days 7         # wider backfill
//
// Networks with missing credentials are skipped, not failed.

import { getServiceDb } from "@nichefinder/db";
import { parseEnv } from "@nichefinder/shared/env";
import { createDefaultReportingAdapter, runReconciliationJob } from "../jobs/reconciliation.js";

function parseDaysArg(argv: string[]): number | undefined {
  const idx = argv.indexOf("--days");
  if (idx !== -1 && argv[idx + 1]) {
    const n = Number(argv[idx + 1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

async function main(): Promise<void> {
  const env = parseEnv();
  const db = getServiceDb();

  const result = await runReconciliationJob({
    db,
    adapter: createDefaultReportingAdapter(env),
    windowDays: parseDaysArg(process.argv.slice(2)),
  });

  process.stdout.write(
    `${JSON.stringify({ event: "reconciliation_job.done", ...result }, null, 2)}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(
    `reconciliation-once failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
