#!/usr/bin/env node
// Cron + on-demand entrypoint for the Content Agent polish pass (Phase 4.1).
//
// Hetzner runs this on a timer to polish hero/commercial drafts; operators
// trigger a single page on demand with `--page <uuid>`.
//
//   node dist/bin/content-polish-once.js                 # scan hero/commercial drafts
//   node dist/bin/content-polish-once.js --page <uuid>   # one page
//
// Writes the polished body back to the page in its pre-approval state — the
// operator still reviews + approves (CLAUDE.md gate #1).

import { getServiceDb } from "@nichefinder/db";
import { runContentPolishJob } from "../jobs/content-polish.js";

function parsePageArg(argv: string[]): string | undefined {
  const idx = argv.indexOf("--page");
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return undefined;
}

async function main(): Promise<void> {
  const db = getServiceDb();

  const monthlyBudgetEur = Number(process.env.CLAUDE_MONTHLY_BUDGET_EUR ?? 200);
  const perCallCapEur = Number(process.env.CLAUDE_PER_CALL_CAP_EUR ?? 2.5);

  const result = await runContentPolishJob({
    db,
    runtime: { db, monthlyBudgetEur, perCallCapEur },
    pageId: parsePageArg(process.argv.slice(2)),
    limit: Number(process.env.CONTENT_POLISH_BATCH_LIMIT ?? 10),
  });

  process.stdout.write(
    `${JSON.stringify({ event: "content_polish_job.done", ...result }, null, 2)}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(
    `content-polish-once failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
