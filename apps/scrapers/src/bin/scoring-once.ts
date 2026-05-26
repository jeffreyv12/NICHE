#!/usr/bin/env node
// Cron entrypoint for the scoring job (Phase 2.3.6).
//
// Hetzner runs this via a systemd timer at Sun 03:30 NL (see infra/hetzner).
// The script is deliberately thin: parse env, build runtime + prefetch, run.
//
// Real affiliate/keyword prefetch wiring is per-env — operators inject their
// own adapters or accept the "empty bundle" fallback this script provides for
// smoke tests. Once Bol/Awin/Daisycon/DataForSEO credentials are present in
// .env, swap the placeholder adapters out for production ones.

import { getServiceDb } from "@nichefinder/db";
import {
  type AffiliateSignalAdapter,
  type KeywordSignalAdapter,
  buildDefaultPrefetch,
} from "../jobs/prefetch.js";
import { runScoringJob } from "../jobs/scoring.js";

async function main(): Promise<void> {
  const db = getServiceDb();

  const monthlyBudgetEur = Number(process.env.CLAUDE_MONTHLY_BUDGET_EUR ?? 200);
  const perCallCapEur = Number(process.env.CLAUDE_PER_CALL_CAP_EUR ?? 0.5);

  // Placeholder adapters return "no signal" bundles so the agent reasons over
  // what's available (Wikipedia + EUIPO). Replace before scoring real cohorts.
  const affiliate: AffiliateSignalAdapter = {
    async fetch() {
      return { median_epc_eur_overall: null };
    },
  };
  const keyword: KeywordSignalAdapter = {
    async fetch() {
      return { keywords: {}, serp: {} };
    },
  };

  const prefetch = buildDefaultPrefetch({ affiliate, keyword });

  const result = await runScoringJob({
    db,
    runtime: { db, monthlyBudgetEur, perCallCapEur },
    prefetch,
    limit: Number(process.env.SCORING_BATCH_LIMIT ?? 25),
  });

  process.stdout.write(`${JSON.stringify({ event: "scoring_job.done", ...result }, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`scoring-once failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
