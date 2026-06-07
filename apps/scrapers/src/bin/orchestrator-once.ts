#!/usr/bin/env node
// Cron + on-demand entrypoint for the weekly portfolio orchestrator (Phase 6.1).
//
// Hetzner runs this Mon 06:00 NL (systemd timer). Produces a report and posts
// to Slack/Discord if SLACK_WEBHOOK_URL or DISCORD_WEBHOOK_URL is set.
// Outputs structured JSON to stdout so systemd / a log aggregator can ingest it.
//
//   node dist/bin/orchestrator-once.js

import { getServiceDb } from "@nichefinder/db";
import { runOrchestratorJob } from "../jobs/orchestrator.js";

async function main(): Promise<void> {
  const db = getServiceDb();
  const monthlyBudgetEur = Number(process.env.CLAUDE_MONTHLY_BUDGET_EUR ?? 200);
  const perCallCapEur = Number(process.env.CLAUDE_PER_CALL_CAP_EUR ?? 10);

  const result = await runOrchestratorJob({
    db,
    runtime: { db, monthlyBudgetEur, perCallCapEur },
    claudeBudgetEur: monthlyBudgetEur,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
  });

  process.stdout.write(
    `${JSON.stringify({ event: "orchestrator_job.done", ...result }, null, 2)}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(
    `orchestrator-once failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
