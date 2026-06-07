#!/usr/bin/env node
// Cron + on-demand entrypoint for the kill-list automation scan (Phase 6.2.1).
//
// Hetzner runs this daily (Sun 04:30 NL). It only ever writes recommendations;
// the operator confirms/dismisses in the admin UI (CLAUDE.md #2 + #13).
//
//   node dist/bin/kill-scan-once.js                # all live niches
//   node dist/bin/kill-scan-once.js --niche <uuid> # one niche

import { getServiceDb } from "@nichefinder/db";
import { runKillScanJob } from "../jobs/killScan.js";

function parseNicheArg(argv: string[]): string | undefined {
  const idx = argv.indexOf("--niche");
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return undefined;
}

async function main(): Promise<void> {
  const db = getServiceDb();
  const result = await runKillScanJob({ db, nicheId: parseNicheArg(process.argv.slice(2)) });
  process.stdout.write(`${JSON.stringify({ event: "kill_scan_job.done", ...result }, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(
    `kill-scan-once failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
