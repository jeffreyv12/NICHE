// Phase: Admin job trigger queue — Hetzner dispatcher.
//
// Polls `job_triggers` every 30 s for queued rows and spawns the matching
// scraper bin as a child process. Only job_ids in ALLOWED_JOBS can be
// triggered — unknown ids are immediately marked failed (no injection path).
//
// Meant to run as a persistent systemd service alongside the cron timers.
// The web server action (apps/web/.../jobs/actions.ts) INSERTs the row;
// this dispatcher does the actual work.

import { spawn } from "node:child_process";
import path from "node:path";
import { type ServiceDb, jobTriggers } from "@nichefinder/db";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Allowlist — only these job_ids can be triggered from the admin UI.
// Must match the `id` field in the JOBS catalogue in apps/web/.../jobs/page.tsx.
// ---------------------------------------------------------------------------

const ALLOWED_JOBS = new Set([
  "discovery",
  "scoring",
  "validation",
  "kill-scan",
  "niche-monthly-metrics",
  "algorithm-events-ingest",
  "promotion",
  "gsc-pull",
  "reconciliation",
  "bol-feed-sync",
  "orchestrator",
  "test-page-draft",
  "content-polish",
  // migration and migration-dry-run are intentionally excluded:
  // they require a migrationId argument and run via the admin Migrations UI.
]);

// Root of the compiled scrapers dist. Override with SCRAPERS_BIN_DIR env var.
const BIN_DIR =
  process.env.SCRAPERS_BIN_DIR ??
  path.join(process.env.NICHEFINDER_ROOT ?? "/opt/nichefinder", "apps/scrapers/dist/bin");

// ---------------------------------------------------------------------------
// Single poll cycle
// ---------------------------------------------------------------------------

export async function pollOnce(db: ServiceDb): Promise<void> {
  // Find the oldest queued trigger.
  const rows = await db
    .select()
    .from(jobTriggers)
    .where(eq(jobTriggers.status, "queued"))
    .orderBy(jobTriggers.queuedAt)
    .limit(1);

  const trigger = rows[0];
  if (!trigger) return;

  // Validate against allowlist before touching anything.
  if (!ALLOWED_JOBS.has(trigger.jobId)) {
    await db
      .update(jobTriggers)
      .set({
        status: "failed",
        error: `Unknown job_id: ${trigger.jobId}`,
        finishedAt: new Date(),
      })
      .where(eq(jobTriggers.id, trigger.id));
    return;
  }

  // Mark running.
  await db
    .update(jobTriggers)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(jobTriggers.id, trigger.id));

  const binPath = path.join(BIN_DIR, `${trigger.jobId}-once.js`);
  let outputBuf = "";
  let exitCode = 0;

  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, [binPath], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout.on("data", (chunk: Buffer) => {
        outputBuf += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        outputBuf += chunk.toString();
      });

      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });
  } catch (err) {
    exitCode = 1;
    outputBuf += `\nSpawn error: ${err instanceof Error ? err.message : String(err)}`;
  }

  const status = exitCode === 0 ? "done" : "failed";

  await db
    .update(jobTriggers)
    .set({
      status,
      exitCode,
      finishedAt: new Date(),
      // Keep last 4 000 chars — enough to diagnose failures without blowing up the DB.
      output: outputBuf.slice(-4_000) || null,
      error:
        exitCode !== 0
          ? (outputBuf.split("\n").find((l) => l.trim()) ?? "non-zero exit").slice(0, 500)
          : null,
    })
    .where(eq(jobTriggers.id, trigger.id));
}

// ---------------------------------------------------------------------------
// Polling loop (called by the bin entrypoint)
// ---------------------------------------------------------------------------

export async function runDispatcher(db: ServiceDb, intervalMs = 30_000): Promise<never> {
  process.stdout.write(
    `[dispatcher] started — polling every ${intervalMs / 1_000}s, bin dir: ${BIN_DIR}\n`,
  );

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await pollOnce(db);
    } catch (err) {
      process.stderr.write(
        `[dispatcher] poll error: ${err instanceof Error ? err.stack : String(err)}\n`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
