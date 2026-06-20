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

type MigMockDb = RunMigrationOptions["db"] & { _updatedSets: Record<string, unknown>[] };

function makeDb(migRow = makeMigrationRow(), drRow = makeDrRow()): MigMockDb {
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
  } as unknown as MigMockDb;
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
// Additional fixture helpers
// ---------------------------------------------------------------------------

function makeEmptyMigDb() {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    execute: () => Promise.resolve(undefined),
  } as unknown as RunMigrationOptions["db"];
}

function makeDbNoRegistration(migRow = makeMigrationRow()) {
  let selectCall = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => {
          selectCall++;
          return Promise.resolve(selectCall === 1 ? [migRow] : []);
        },
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    execute: () => Promise.resolve(undefined),
  } as unknown as RunMigrationOptions["db"];
}

function makeCloudflareAdapters(zoneOverride?: { id: string; name: string } | null) {
  const zone = zoneOverride === undefined ? { id: "zone-cf-1", name: HOSTNAME } : zoneOverride;
  return {
    cloudflare: {
      registerDomain: vi
        .fn()
        .mockResolvedValue({ id: "cf-reg", hostname: HOSTNAME, expires_at: "2027-06-20" }),
      getZone: vi.fn().mockResolvedValue(zone),
      createZone: vi.fn().mockResolvedValue({ id: "zone-new", name: HOSTNAME }),
      createARecord: vi.fn().mockResolvedValue({}),
      createCnameRecord: vi.fn().mockResolvedValue({}),
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

  // -------------------------------------------------------------------------
  // Guard failures — bad DB state throws before any step runs
  // -------------------------------------------------------------------------

  describe("guard failures", () => {
    it("throws when migration row does not exist", async () => {
      await expect(
        runMigration({ db: makeEmptyMigDb(), migrationId: MIGRATION_ID, adapters: makeAdapters() }),
      ).rejects.toThrow(`Migration ${MIGRATION_ID} not found`);
    });

    it("throws when migration has no nicheId", async () => {
      const db = makeDb(makeMigrationRow({ nicheId: null }));
      await expect(
        runMigration({ db, migrationId: MIGRATION_ID, adapters: makeAdapters() }),
      ).rejects.toThrow("Migration has no niche_id");
    });

    it("throws when migration has no domainRegistrationId", async () => {
      const db = makeDb(makeMigrationRow({ domainRegistrationId: null }));
      await expect(
        runMigration({ db, migrationId: MIGRATION_ID, adapters: makeAdapters() }),
      ).rejects.toThrow("Migration has no domain_registration_id");
    });

    it("throws when domain registration row does not exist", async () => {
      const db = makeDbNoRegistration();
      await expect(
        runMigration({ db, migrationId: MIGRATION_ID, adapters: makeAdapters() }),
      ).rejects.toThrow("Domain registration not found");
    });
  });

  // -------------------------------------------------------------------------
  // Step 2 — register domain routing
  // -------------------------------------------------------------------------

  describe("step 2 — register domain", () => {
    it("fails step 2 on unknown registrar", async () => {
      const db = makeDb(makeMigrationRow(), makeDrRow({ registrar: "namecheap" }));
      const result = await runMigration({
        db,
        migrationId: MIGRATION_ID,
        adapters: makeAdapters(),
      });
      expect(result.status).toBe("failed");
      expect(result.failedStep).toBe(2);
    });

    it("fails step 2 when registrar=transip but transip adapter is absent", async () => {
      const db = makeDb();
      const { transip: _omit, ...adaptersNoTransip } = makeAdapters();
      const result = await runMigration({
        db,
        migrationId: MIGRATION_ID,
        adapters: adaptersNoTransip,
      });
      expect(result.status).toBe("failed");
      expect(result.failedStep).toBe(2);
    });

    it("fails step 2 when registrar=cloudflare but cloudflare adapter is absent", async () => {
      const db = makeDb(makeMigrationRow(), makeDrRow({ registrar: "cloudflare" }));
      const result = await runMigration({
        db,
        migrationId: MIGRATION_ID,
        adapters: makeAdapters(),
      });
      expect(result.status).toBe("failed");
      expect(result.failedStep).toBe(2);
    });

    it("fails step 2 when transip.registerDomain rejects", async () => {
      const db = makeDb();
      const adapters = makeAdapters();
      adapters.transip.registerDomain = vi.fn().mockRejectedValue(new Error("SIDN timeout"));
      const result = await runMigration({ db, migrationId: MIGRATION_ID, adapters });
      expect(result.status).toBe("failed");
      expect(result.failedStep).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Step 3 — DNS setup routing
  // -------------------------------------------------------------------------

  describe("step 3 — DNS setup", () => {
    it("uses TransIP DNS when registrar=transip (no cloudflare adapter)", async () => {
      const db = makeDb();
      const adapters = makeAdapters();
      await runMigration({ db, migrationId: MIGRATION_ID, adapters });
      expect(adapters.transip.addDnsEntry).toHaveBeenCalledWith(
        HOSTNAME,
        "A",
        "@",
        expect.any(String),
      );
      expect(adapters.transip.addDnsEntry).toHaveBeenCalledWith(HOSTNAME, "CNAME", "www", HOSTNAME);
    });

    it("uses existing Cloudflare zone when getZone returns one", async () => {
      const db = makeDb(makeMigrationRow(), makeDrRow({ registrar: "cloudflare" }));
      const adapters = makeCloudflareAdapters({ id: "zone-existing", name: HOSTNAME });
      await runMigration({ db, migrationId: MIGRATION_ID, adapters });
      expect(adapters.cloudflare.createZone).not.toHaveBeenCalled();
      expect(adapters.cloudflare.createARecord).toHaveBeenCalledWith(
        "zone-existing",
        HOSTNAME,
        expect.any(String),
      );
    });

    it("creates a Cloudflare zone when getZone returns null", async () => {
      const db = makeDb(makeMigrationRow(), makeDrRow({ registrar: "cloudflare" }));
      const adapters = makeCloudflareAdapters(null);
      await runMigration({ db, migrationId: MIGRATION_ID, adapters });
      expect(adapters.cloudflare.createZone).toHaveBeenCalledWith(HOSTNAME);
      expect(adapters.cloudflare.createARecord).toHaveBeenCalledWith(
        "zone-new",
        HOSTNAME,
        expect.any(String),
      );
    });

    it("fails step 3 when neither cloudflare nor transip adapter is present", async () => {
      const db = makeDb();
      const adapters = makeAdapters();
      // Resume past step 2 so the transip adapter absence triggers step 3, not step 2.
      const result = await runMigration({
        db,
        migrationId: MIGRATION_ID,
        adapters: { vercel: adapters.vercel, pingIndexNow: adapters.pingIndexNow },
        resumeFromStep: 3,
      });
      expect(result.status).toBe("failed");
      expect(result.failedStep).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Step 4 — Vercel attach
  // -------------------------------------------------------------------------

  describe("step 4 — Vercel attach", () => {
    it("attaches both apex and www subdomains", async () => {
      const db = makeDb();
      const adapters = makeAdapters();
      await runMigration({ db, migrationId: MIGRATION_ID, adapters });
      expect(adapters.vercel.attachDomain).toHaveBeenCalledWith(HOSTNAME);
      expect(adapters.vercel.attachDomain).toHaveBeenCalledWith(`www.${HOSTNAME}`);
      expect(adapters.vercel.attachDomain).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Step 9 — IndexNow
  // -------------------------------------------------------------------------

  describe("step 9 — IndexNow", () => {
    it("pings IndexNow with the sitemap URL for the new domain", async () => {
      const db = makeDb();
      const adapters = makeAdapters();
      await runMigration({ db, migrationId: MIGRATION_ID, adapters });
      expect(adapters.pingIndexNow).toHaveBeenCalledWith(`https://${HOSTNAME}/sitemap.xml`);
    });

    it("completes without error when pingIndexNow adapter is absent", async () => {
      const db = makeDb();
      const { pingIndexNow: _omit, ...adaptersNoPing } = makeAdapters();
      const result = await runMigration({
        db,
        migrationId: MIGRATION_ID,
        adapters: adaptersNoPing,
      });
      expect(result.status).toBe("done");
    });
  });

  // -------------------------------------------------------------------------
  // Resume edge cases
  // -------------------------------------------------------------------------

  describe("resume behavior", () => {
    it("resumeFromStep=0 skips nothing", async () => {
      const db = makeDb();
      const result = await runMigration({
        db,
        migrationId: MIGRATION_ID,
        adapters: makeAdapters(),
        resumeFromStep: 0,
      });
      expect(result.skippedSteps).toEqual([]);
      expect(result.completedSteps).toHaveLength(13);
    });

    it("resumeFromStep=12 runs only the last step", async () => {
      const db = makeDb();
      const result = await runMigration({
        db,
        migrationId: MIGRATION_ID,
        adapters: makeAdapters(),
        resumeFromStep: 12,
      });
      expect(result.skippedSteps).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(result.completedSteps).toEqual([12]);
    });
  });

  // -------------------------------------------------------------------------
  // DB state transitions
  // -------------------------------------------------------------------------

  describe("DB state tracking", () => {
    it("marks status=running before any step executes", async () => {
      const db = makeDb();
      await runMigration({ db, migrationId: MIGRATION_ID, adapters: makeAdapters() });
      const firstUpdate = db._updatedSets[0];
      expect(firstUpdate).toMatchObject({ status: "running" });
    });

    it("marks status=done after all steps complete", async () => {
      const db = makeDb();
      await runMigration({ db, migrationId: MIGRATION_ID, adapters: makeAdapters() });
      const lastUpdate = db._updatedSets[db._updatedSets.length - 1];
      expect(lastUpdate).toMatchObject({ status: "done" });
      expect(lastUpdate).toHaveProperty("completedAt");
    });

    it("marks status=failed with correct failedStep when a step throws", async () => {
      const db = makeDb();
      const adapters = makeAdapters();
      adapters.transip.registerDomain = vi.fn().mockRejectedValue(new Error("domain taken"));
      await runMigration({ db, migrationId: MIGRATION_ID, adapters });
      const failUpdate = db._updatedSets.find(
        (u: Record<string, unknown>) => u.status === "failed",
      );
      expect(failUpdate).toMatchObject({ status: "failed", failedStep: 2 });
      expect(failUpdate).toHaveProperty("failedAt");
    });
  });
});
