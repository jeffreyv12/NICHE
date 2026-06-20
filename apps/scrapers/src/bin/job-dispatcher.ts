#!/usr/bin/env node
// Persistent entrypoint for the admin job-trigger dispatcher (Phase: job queue).
//
// Runs as a systemd service on Hetzner (Type=simple, Restart=on-failure).
// Polls `job_triggers` every 30 s and spawns queued bins as child processes.
//
//   node dist/bin/job-dispatcher.js
//
// Optional env overrides:
//   DISPATCHER_INTERVAL_MS  — poll interval in ms (default 30 000)
//   SCRAPERS_BIN_DIR        — path to compiled bin dir (default /opt/nichefinder/apps/scrapers/dist/bin)

import { getServiceDb } from "@nichefinder/db";
import { runDispatcher } from "../jobs/dispatcher.js";

const db = getServiceDb();
const intervalMs = Number(process.env.DISPATCHER_INTERVAL_MS ?? 30_000);

runDispatcher(db, intervalMs).catch((err) => {
  process.stderr.write(`job-dispatcher fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
