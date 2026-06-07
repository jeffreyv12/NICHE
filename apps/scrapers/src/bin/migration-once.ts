#!/usr/bin/env node
// On-demand entrypoint for the 13-step promotion migration (Phase 5.5).
//
// Run manually after the operator has confirmed domain registration in the
// admin UI (/admin/promotions). Never invoked by an autonomous cron —
// each migration is triggered by an explicit operator action (CLAUDE.md #1).
//
// Usage:
//   node dist/bin/migration-once.js <migrationId>
//
// The migrationId is the UUID of the promotion_migrations row created by
// the confirmRegistrationAction server action.
//
// Exits 0 on success, 1 on failure. JSON summary written to stdout.

import { getServiceDb } from "@nichefinder/db";
import {
  createCloudflareClient,
  createTransipClient,
  createVercelClient,
  runMigration,
} from "../index.js";

async function pingIndexNow(sitemapUrl: string): Promise<void> {
  const key = process.env.BING_INDEXNOW_KEY;
  if (!key) return;
  try {
    await fetch(`https://www.bing.com/indexnow?url=${encodeURIComponent(sitemapUrl)}&key=${key}`);
  } catch {
    // fire-and-forget — failure doesn't block migration
  }
}

async function main(): Promise<void> {
  const migrationId = process.argv[2];
  if (!migrationId) {
    process.stderr.write("Usage: migration-once <migrationId>\n");
    process.exit(1);
  }

  const db = getServiceDb();

  // Build adapters from env vars. Clients throw at construction time if creds
  // are missing — the operator will see the error in the run log.
  const cloudflare = (() => {
    try {
      return createCloudflareClient();
    } catch {
      return undefined;
    }
  })();
  const transip = (() => {
    try {
      return createTransipClient();
    } catch {
      return undefined;
    }
  })();
  const vercel = (() => {
    try {
      return createVercelClient();
    } catch {
      return undefined;
    }
  })();

  const operatorEmail = process.env.OPERATOR_EMAIL ?? undefined;

  const result = await runMigration({
    db,
    migrationId,
    adapters: {
      cloudflare,
      transip,
      vercel,
      pingIndexNow,
    },
    operatorEmail,
  });

  process.stdout.write(`${JSON.stringify({ event: "migration.done", ...result }, null, 2)}\n`);

  if (result.status === "failed") {
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(
    `migration-once failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
