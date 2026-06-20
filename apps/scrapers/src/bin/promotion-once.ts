#!/usr/bin/env node
// Cron + on-demand entrypoint for the weekly promotion evaluation (Phase 5.4).
//
// Hetzner runs this Sun 04:00 NL (systemd timer). Evaluates every niche in
// `building` or `mature` state that hasn't been evaluated in 7 days.
// Outputs structured JSON to stdout for log ingestion.
//
// NEVER auto-promotes. Writes promotion_evaluations rows only; the operator
// acts via the admin UI "Ready to promote" card (CLAUDE.md #1 + #10).
//
//   node dist/bin/promotion-once.js

import { getServiceDb } from "@nichefinder/db";
import { runPromotionJob } from "../jobs/promotion.js";
import { tryCreateRegistrarDomainAdapter } from "../registrars/domainAdapter.js";

async function main(): Promise<void> {
  const db = getServiceDb();
  const monthlyBudgetEur = Number(process.env.CLAUDE_MONTHLY_BUDGET_EUR ?? 200);
  const perCallCapEur = Number(process.env.CLAUDE_PER_CALL_CAP_EUR ?? 10);

  const domainAdapter = await tryCreateRegistrarDomainAdapter();

  const result = await runPromotionJob({
    db,
    runtime: { db, monthlyBudgetEur, perCallCapEur },
    domainAdapter,
  });

  process.stdout.write(`${JSON.stringify({ event: "promotion_job.done", ...result }, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(
    `promotion-once failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
