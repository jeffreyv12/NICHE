#!/usr/bin/env node
// Cron + on-demand entrypoint for the validation job (Phase 3.3.2).
//
// Hetzner runs this via a systemd timer at Fri 18:00 NL (scheduled review).
// Operators trigger a single niche on demand with `--niche <uuid>`.
//
//   node dist/bin/validation-once.js                 # all niches in `validating`
//   node dist/bin/validation-once.js --niche <uuid>  # one niche
//
// Sessions/bounce/paid-spend come from Plausible in production; until that
// adapter is wired (Phase 3.2+) the job falls back to the zero adapter, and
// the agent reflects the thin data in its `confidence`.

import { getServiceDb } from "@nichefinder/db";
import { runValidationJob } from "../jobs/validation.js";

function parseNicheArg(argv: string[]): string | undefined {
  const idx = argv.indexOf("--niche");
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return undefined;
}

async function main(): Promise<void> {
  const db = getServiceDb();

  const monthlyBudgetEur = Number(process.env.CLAUDE_MONTHLY_BUDGET_EUR ?? 200);
  const perCallCapEur = Number(process.env.CLAUDE_PER_CALL_CAP_EUR ?? 0.5);

  const result = await runValidationJob({
    db,
    runtime: { db, monthlyBudgetEur, perCallCapEur },
    nicheId: parseNicheArg(process.argv.slice(2)),
    limit: Number(process.env.VALIDATION_BATCH_LIMIT ?? 25),
    windowDays: Number(process.env.VALIDATION_WINDOW_DAYS ?? 14),
  });

  process.stdout.write(`${JSON.stringify({ event: "validation_job.done", ...result }, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(
    `validation-once failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
