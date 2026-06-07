import { describe, expect, it, vi } from "vitest";
import type { RunMigrationOptions } from "../migration.js";
import { STEP_NAMES, runMigration } from "../migration.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const MIGRATION_ID = "mig-uuid-001";
const NICHE_ID = "niche-uuid-001";
const DR_ID = "dr-uuid-001";
const HOSTNAME = "staandbureau.nl";

function makeMigrationRow(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function makeDrRow(overrides = {}) {
  return {
    id: DR_ID,
    nicheId: NICHE_ID,
    tenantId: "tenant-uuid-001",
    hostname: HOSTNAME,
    registrar: "transip",
    registeredAt: new Date(),
    expiresAt: new Date(),
    autoRenew: true,
    registrationCostCents: null,
    sslProvisionedAt: null,
    dnsPropagatedAt: null,
    vercelAttachedAt: null,
    status: "pending",
    notes: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeDb(migRow = makeMigrationRow(), drRow = makeDrRow()) {
  const updatedSets: Record<string, unknown>[] = [];
  let selectCall = 0;

  return {
    _updatedSets: updatedSets,
    select: () => ({
      from: () => ({
        where: () => {
          selectCall++;
          if (selectCall === 1) return Promise.resolve([migRow]);
          if (selectCall === 2) return Promise.resolve([drRow]);
          return Promise.resolve([]);
        },
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          updatedSets.push(vals);
          return Promise.resolve();
        },
      }),
    }),
    execute: () => Promise.resolve(undefined),
  } as unknown as RunMigrationOptions["db"];
}

function makeAdapters() {
  return {
    transip: {
      registerDomain: vi.fn().mockResolvedValue(undefined),
      addDnsEntry: vi.fn().mockResolvedValue(undefined),
      checkAvailability: vi.fn(),
    },
    vercel: {
      attachDomain: vi.fn().mockResolvedValue({ name: HOSTNAME, verified: true }),
      pollSslUntilActive: vi.fn().mockResolvedValue(true),
    },
    pingIndexNow: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runMigration", () => {
  it("completes all 13 steps and returns status=done", async () => {
    const db = makeDb();
    const adapters = makeAdapters();

    const result = await runMigration({
      db,
      migrationId: MIGRATION_ID,
      adapters,
      operatorEmail: "operator@test.nl",
    });

    expect(result.status).toBe("done");
    expect(result.completedSteps).toHaveLength(13);
    expect(result.failedStep).toBeNull();
    expect(result.hostname).toBe(HOSTNAME);
  });

  it("registers domain via transip when registrar=transip", async () => {
    const db = makeDb();
    const adapters = makeAdapters();

    await runMigration({ db, migrationId: MIGRATION_ID, adapters });

    expect(adapters.transip.registerDomain).toHaveBeenCalledWith(HOSTNAME);
  });

  it("registers domain via cloudflare when registrar=cloudflare", async () => {
    const drRow = makeDrRow({ registrar: "cloudflare" });
    const db = makeDb(makeMigrationRow(), drRow);
    const adapters = {
      cloudflare: {
        registerDomain: vi
          .fn()
          .mockResolvedValue({ id: "x", hostname: HOSTNAME, expires_at: "2027-01-01" }),
        getZone: vi.fn().mockResolvedValue({ id: "zone-1", name: HOSTNAME }),
        createZone: vi.fn(),
        createARecord: vi.fn().mockResolvedValue({}),
        createCnameRecord: vi.fn().mockResolvedValue({}),
      },
      vercel: {
        attachDomain: vi.fn().mockResolvedValue({ name: HOSTNAME, verified: true }),
        pollSslUntilActive: vi.fn().mockResolvedValue(true),
      },
      pingIndexNow: vi.fn().mockResolvedValue(undefined),
    };

    await runMigration({ db, migrationId: MIGRATION_ID, adapters });

    expect(adapters.cloudflare.registerDomain).toHaveBeenCalledWith(HOSTNAME);
    expect(adapters.cloudflare.createARecord).toHaveBeenCalled();
    expect(adapters.cloudflare.createCnameRecord).toHaveBeenCalled();
  });

  it("resumes from a specified step and skips earlier steps", async () => {
    const db = makeDb();
    const adapters = makeAdapters();

    const result = await runMigration({
      db,
      migrationId: MIGRATION_ID,
      adapters,
      resumeFromStep: 3,
    });

    expect(result.skippedSteps).toEqual([0, 1, 2]);
    expect(result.completedSteps).toHaveLength(10);
    // TransIP registerDomain (step 2) must not have been called
    expect(adapters.transip.registerDomain).not.toHaveBeenCalled();
    // But Vercel attach (step 4) must have been called
    expect(adapters.vercel.attachDomain).toHaveBeenCalled();
  });

  it("records failure and returns status=failed when a step throws", async () => {
    const db = makeDb();
    const adapters = makeAdapters();
    // Make SSL poll fail
    adapters.vercel.pollSslUntilActive = vi.fn().mockResolvedValue(false);

    const result = await runMigration({ db, migrationId: MIGRATION_ID, adapters });

    expect(result.status).toBe("failed");
    expect(result.failedStep).toBe(5); // step 5 = ssl_poll
  });

  it("STEP_NAMES has an entry for all 13 steps", () => {
    for (let i = 0; i < 13; i++) {
      expect(STEP_NAMES[i]).toBeDefined();
    }
  });
});
