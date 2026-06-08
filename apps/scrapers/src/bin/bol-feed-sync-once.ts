#!/usr/bin/env node
// Bol product-feed sync entrypoint — Phase 2.1.2.
//
// Triggered by nichefinder-bol-feed-sync.timer (every 2h) or manually:
//   node dist/bin/bol-feed-sync-once.js
//
// Required env:
//   BOL_PARTNER_CLIENT_ID
//   BOL_PARTNER_CLIENT_SECRET

import { getServiceDb } from "@nichefinder/db";
import { runBolFeedSyncJob } from "../jobs/bolFeedSync.js";
import { BolClient } from "../sources/bol/client.js";

async function main(): Promise<void> {
  const clientId = process.env.BOL_PARTNER_CLIENT_ID;
  const clientSecret = process.env.BOL_PARTNER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    process.stderr.write(
      "bol-feed-sync-once: BOL_PARTNER_CLIENT_ID and BOL_PARTNER_CLIENT_SECRET are required\n",
    );
    process.exit(1);
  }

  const db = getServiceDb();
  const bolClient = new BolClient({ credentials: { clientId, clientSecret } });

  const batchDelayMs = process.env.BOL_FEED_SYNC_BATCH_DELAY_MS
    ? Number(process.env.BOL_FEED_SYNC_BATCH_DELAY_MS)
    : undefined;
  const maxProducts = process.env.BOL_FEED_SYNC_MAX_PRODUCTS
    ? Number(process.env.BOL_FEED_SYNC_MAX_PRODUCTS)
    : undefined;

  const result = await runBolFeedSyncJob({ db, bolClient, batchDelayMs, maxProducts });

  process.stdout.write(`${JSON.stringify({ event: "bol_feed_sync.done", ...result }, null, 2)}\n`);

  if (result.errors > 0) {
    process.stderr.write(`bol-feed-sync-once: ${result.errors} product(s) had errors\n`);
    // Non-fatal: partial success is still useful.
  }
}

main().catch((err) => {
  process.stderr.write(
    `bol-feed-sync-once failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
