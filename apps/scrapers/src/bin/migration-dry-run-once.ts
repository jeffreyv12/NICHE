#!/usr/bin/env node
// Phase 5.5 acceptance dry-run — validates the 13-step migration state machine
// end-to-end without crossing any human-approval gate (CLAUDE.md #1).
//
// Gated steps skipped with mocks:
//   Step 2 (register_domain) — real registrar calls require operator confirm
//   Step 3 (dns_setup)       — DNS is tied to domain registration
//   Step 5 (ssl_poll)        — SSL can't provision without real DNS; mock returns true
//
// Real API call made:
//   Step 4 (vercel_attach)   — adds the test hostname to the Vercel project,
//                              then removes it at the end regardless of outcome.
//
// Usage:
//   node dist/bin/migration-dry-run-once.js [--hostname dry-run-test.nl]
//
// Exit 0 = all 13 steps completed (or skipped with mock). Exit 1 = failure.

import { createVercelClient, runMigration } from "../index.js";

const DRY_RUN_HOSTNAME =
  process.argv.find((a) => a.startsWith("--hostname="))?.split("=")[1] ??
  "nichebot-dry-run-acceptance.nl";

// ---------------------------------------------------------------------------
// Mock DB — no real rows needed; mirrors the pattern in migration.test.ts
// ---------------------------------------------------------------------------

const MIGRATION_ID = "dry-run-mig-001";
const NICHE_ID = "dry-run-niche-001";
const DR_ID = "dry-run-dr-001";

function makeMockDb() {
  let selectCall = 0;
  const migRow = {
    id: MIGRATION_ID,
    nicheId: NICHE_ID,
    domainRegistrationId: DR_ID,
    status: "pending",
    currentStep: 0,
    stepLogs: [],
    operatorEmail: null,
    startedAt: new Date(),
    completedAt: null,
    failedAt: null,
    failedStep: null,
    createdAt: new Date(),
  };
  const drRow = {
    id: DR_ID,
    nicheId: NICHE_ID,
    tenantId: "dry-run-tenant-001",
    // Registrar "transip" so the mock transip adapter is selected in step 2-3.
    hostname: DRY_RUN_HOSTNAME,
    registrar: "transip",
    registeredAt: new Date(),
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    autoRenew: true,
    registrationCostCents: null,
    sslProvisionedAt: null,
    dnsPropagatedAt: null,
    vercelAttachedAt: null,
    status: "pending",
    notes: null,
    createdAt: new Date(),
  };

  return {
    select: () => ({
      from: () => ({
        where: () => {
          selectCall++;
          return Promise.resolve(selectCall === 1 ? [migRow] : [drRow]);
        },
      }),
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
    execute: () => Promise.resolve(undefined),
  };
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

function makeMockTransip() {
  return {
    registerDomain: async (hostname: string) => {
      process.stdout.write(`  [mock] transip.registerDomain(${hostname}) — skipped (gated)\n`);
    },
    addDnsEntry: async (hostname: string, type: string, name: string) => {
      process.stdout.write(
        `  [mock] transip.addDnsEntry(${hostname}, ${type}, ${name}) — skipped\n`,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  process.stdout.write(`Phase 5 dry-run — hostname: ${DRY_RUN_HOSTNAME}\n\n`);

  let vercelClient: ReturnType<typeof createVercelClient> | undefined;

  try {
    vercelClient = createVercelClient();
  } catch (err) {
    process.stderr.write(
      `Cannot create VercelClient: ${err instanceof Error ? err.message : String(err)}\nMake sure VERCEL_API_TOKEN and VERCEL_PROJECT_ID are set in .env.local\n`,
    );
    process.exit(1);
  }

  const capturedVercel = vercelClient;

  // Wrap the Vercel adapter: step 4 uses the real API; step 5 (SSL poll)
  // immediately returns true since there's no real DNS to provision from.
  const vercelAdapter = {
    attachDomain: (hostname: string) => capturedVercel.attachDomain(hostname),
    pollSslUntilActive: async (_hostname: string) => {
      process.stdout.write("  [mock] ssl_poll — skipped (no DNS for test hostname)\n");
      return true;
    },
  };

  const db = makeMockDb() as unknown as Parameters<typeof runMigration>[0]["db"];

  let domainAttached = false;

  try {
    const result = await runMigration({
      db,
      migrationId: MIGRATION_ID,
      adapters: {
        transip: makeMockTransip(),
        vercel: vercelAdapter,
        pingIndexNow: async (url) => {
          process.stdout.write(`  [mock] pingIndexNow(${url}) — skipped\n`);
        },
      },
      operatorEmail: "dry-run@nichefinder.local",
    });

    // Track whether step 4 (vercel_attach) actually ran so we know to clean up.
    domainAttached = result.completedSteps.includes(4);

    process.stdout.write(`\nResult: ${JSON.stringify(result, null, 2)}\n`);

    if (result.status === "done") {
      process.stdout.write(
        "\n✓ All 13 steps completed — Phase 5 state machine is wired correctly.\n",
      );
    } else {
      process.stderr.write(`\n✗ Migration failed at step ${result.failedStep}.\n`);
    }
  } finally {
    if (domainAttached) {
      process.stdout.write(`\nCleaning up: removing ${DRY_RUN_HOSTNAME} from Vercel project…\n`);
      try {
        await capturedVercel.removeDomain(DRY_RUN_HOSTNAME);
        process.stdout.write("Cleanup done.\n");
      } catch (err) {
        process.stderr.write(
          `Cleanup failed (remove manually in Vercel dashboard): ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  }
}

main().catch((err) => {
  process.stderr.write(
    `migration-dry-run-once failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
