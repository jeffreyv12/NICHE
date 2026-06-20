#!/usr/bin/env node
// Cron entrypoint for the scoring job (Phase 2.3.6).
//
// Hetzner runs this via a systemd timer at Sun 03:30 NL (see infra/hetzner).
// Real DataForSEO + Bol + Awin adapters are used when env credentials are set;
// falls back to empty-signal stubs so a partially-configured box still runs.

import { getServiceDb } from "@nichefinder/db";
import {
  buildBolAwinAffiliateAdapter,
  buildDataForSeoKeywordAdapter,
} from "../jobs/adapters/scoring-adapters.js";
import {
  type AffiliateSignalAdapter,
  type KeywordSignalAdapter,
  buildDefaultPrefetch,
} from "../jobs/prefetch.js";
import { runScoringJob } from "../jobs/scoring.js";
import { AwinClient, defaultAwinRetryPolicy } from "../sources/awin/client.js";
import { BolClient, defaultBolRetryPolicy } from "../sources/bol/client.js";
import { MemoryCache } from "../sources/dataforseo/cache.js";
import {
  DataForSeoClient,
  defaultRetryPolicy as defaultDfsRetryPolicy,
} from "../sources/dataforseo/client.js";

async function main(): Promise<void> {
  const db = getServiceDb();

  const monthlyBudgetEur = Number(process.env.CLAUDE_MONTHLY_BUDGET_EUR ?? 200);
  const perCallCapEur = Number(process.env.CLAUDE_PER_CALL_CAP_EUR ?? 0.5);

  // --- DataForSEO keyword + SERP adapter ---
  let keyword: KeywordSignalAdapter;
  const dfsLogin = process.env.DATAFORSEO_LOGIN;
  const dfsPassword = process.env.DATAFORSEO_PASSWORD;
  if (dfsLogin && dfsPassword) {
    const dfsClient = new DataForSeoClient({
      credentials: { login: dfsLogin, password: dfsPassword },
      retry: defaultDfsRetryPolicy(),
    });
    keyword = buildDataForSeoKeywordAdapter(dfsClient, new MemoryCache());
    process.stdout.write("[scoring-once] DataForSEO keyword adapter active\n");
  } else {
    keyword = {
      async fetch() {
        return { keywords: {}, serp: {} };
      },
    };
    process.stdout.write("[scoring-once] DataForSEO not configured — using empty keyword signal\n");
  }

  // --- Bol + Awin affiliate adapter ---
  let bolClient: BolClient | null = null;
  const bolId = process.env.BOL_PARTNER_CLIENT_ID;
  const bolSecret = process.env.BOL_PARTNER_CLIENT_SECRET;
  if (bolId && bolSecret) {
    bolClient = new BolClient({
      credentials: { clientId: bolId, clientSecret: bolSecret },
      retry: defaultBolRetryPolicy(),
    });
    process.stdout.write("[scoring-once] Bol affiliate adapter active\n");
  }

  let awinClient: AwinClient | null = null;
  const awinToken = process.env.AWIN_API_TOKEN;
  const awinPub = process.env.AWIN_PUBLISHER_ID;
  if (awinToken && awinPub) {
    awinClient = new AwinClient({
      credentials: { apiToken: awinToken, publisherId: awinPub },
      retry: defaultAwinRetryPolicy(),
    });
    process.stdout.write("[scoring-once] Awin affiliate adapter active\n");
  }

  const affiliate: AffiliateSignalAdapter = buildBolAwinAffiliateAdapter(bolClient, awinClient);

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
