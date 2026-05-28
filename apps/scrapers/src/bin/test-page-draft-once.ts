#!/usr/bin/env node
// Cron entrypoint for the test-page draft sweep (Phase 3.1).
//
// Hetzner runs this on a short interval (e.g. every 15 min) — newly-approved
// niches surface their first draft pages within minutes of operator approval.

import { getServiceDb } from "@nichefinder/db";
import { runTestPageDraftSweep } from "../jobs/test-page-draft-sweep.js";

async function main(): Promise<void> {
  const db = getServiceDb();
  const monthlyBudgetEur = Number(process.env.CLAUDE_MONTHLY_BUDGET_EUR ?? 200);
  const perCallCapEur = Number(process.env.CLAUDE_PER_CALL_CAP_EUR ?? 0.5);

  const result = await runTestPageDraftSweep({
    db,
    runtime: { db, monthlyBudgetEur, perCallCapEur },
    limit: Number(process.env.TEST_PAGE_DRAFT_LIMIT ?? 5),
  });

  process.stdout.write(
    `${JSON.stringify({ event: "test_page_draft_sweep.done", ...result }, null, 2)}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(
    `test-page-draft-once failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
