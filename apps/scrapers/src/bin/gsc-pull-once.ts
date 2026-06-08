#!/usr/bin/env node
// Daily GSC pull — Phase 3.2 / Promotion Gate data feed.
//
// Triggered by nichefinder-gsc-pull.timer (daily 05:30 NL) or manually:
//   node dist/bin/gsc-pull-once.js
//
// Required env:
//   GSC_SERVICE_ACCOUNT_JSON — full JSON of the Google service account
//
// Tenants that don't have `gscSiteUrl` in their config are skipped silently.

import { getServiceDb } from "@nichefinder/db";
import { runGscPullJob } from "../jobs/gscPull.js";
import { serviceAccountJson } from "../sources/gsc/types.js";

async function main(): Promise<void> {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    process.stderr.write("gsc-pull-once: GSC_SERVICE_ACCOUNT_JSON is not set — skipping\n");
    process.exit(0);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stderr.write("gsc-pull-once: GSC_SERVICE_ACCOUNT_JSON is not valid JSON\n");
    process.exit(1);
  }

  const account = serviceAccountJson.safeParse(parsed);
  if (!account.success) {
    process.stderr.write(
      `gsc-pull-once: service account JSON malformed: ${account.error.message}\n`,
    );
    process.exit(1);
  }

  const db = getServiceDb();
  const lookbackDays = process.env.GSC_LOOKBACK_DAYS
    ? Number(process.env.GSC_LOOKBACK_DAYS)
    : undefined;

  const result = await runGscPullJob({ db, serviceAccount: account.data, lookbackDays });

  process.stdout.write(`${JSON.stringify({ event: "gsc_pull.done", ...result }, null, 2)}\n`);

  if (result.errors.length > 0) {
    process.stderr.write(`gsc-pull-once: ${result.errors.length} tenant(s) had errors\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`gsc-pull-once failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
