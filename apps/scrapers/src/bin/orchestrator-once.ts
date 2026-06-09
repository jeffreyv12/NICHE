#!/usr/bin/env node
// Cron + on-demand entrypoint for the weekly portfolio orchestrator (Phase 6.1).
//
// Hetzner runs this Mon 06:00 NL (systemd timer). Produces a report and posts
// to Slack/Discord if SLACK_WEBHOOK_URL or DISCORD_WEBHOOK_URL is set.
// Sends a budget-alert email (Phase 6.3.3) when MTD spend ≥ 80% of budget.
// Outputs structured JSON to stdout so systemd / a log aggregator can ingest it.
//
//   node dist/bin/orchestrator-once.js

import { getServiceDb } from "@nichefinder/db";
import { runOrchestratorJob } from "../jobs/orchestrator.js";

async function sendBudgetAlertEmail(spentEur: number, budgetEur: number): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.OPERATOR_EMAIL;
  const from = process.env.EMAIL_FROM ?? "NicheFinder <noreply@example.com>";

  if (!apiKey || !to) {
    console.warn(
      `[budget-alert] RESEND_API_KEY or OPERATOR_EMAIL not set — skipping email (spent €${spentEur.toFixed(2)} of €${budgetEur})`,
    );
    return;
  }

  const pct = Math.round((spentEur / budgetEur) * 100);
  const subject = `⚠ NicheFinder Claude budget at ${pct}% (€${spentEur.toFixed(2)} / €${budgetEur})`;
  const text = [
    `Claude spend is at ${pct}% of your monthly budget.`,
    "",
    `  Spent:  €${spentEur.toFixed(2)}`,
    `  Budget: €${budgetEur.toFixed(2)}`,
    "",
    "Check /admin/costs for a breakdown. Raise CLAUDE_MONTHLY_BUDGET_EUR in Vercel env if needed, or let the hard pause kick in at 100%.",
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[budget-alert] Resend error ${res.status}: ${body}`);
  } else {
    console.info(`[budget-alert] Alert email sent to ${to}`);
  }
}

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
    onBudgetAlert: sendBudgetAlertEmail,
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
