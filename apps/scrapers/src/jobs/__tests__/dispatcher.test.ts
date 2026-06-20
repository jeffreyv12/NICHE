import { type ChildProcess, spawn } from "node:child_process";
import type { ServiceDb } from "@nichefinder/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pollOnce } from "../dispatcher.js";

// ---------------------------------------------------------------------------
// Mock node:child_process — no real processes spawned in tests.
// vi.mock is hoisted above imports by Vitest.
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const mockedSpawn = vi.mocked(spawn);

// ---------------------------------------------------------------------------
// Child-process mock factory
// ---------------------------------------------------------------------------

interface MockChildOpts {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  spawnError?: Error;
}

function mockChild(opts: MockChildOpts = {}) {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const stdoutListeners: Array<(chunk: Buffer) => void> = [];
  const stderrListeners: Array<(chunk: Buffer) => void> = [];

  const child = {
    stdout: {
      on(_evt: string, cb: (chunk: Buffer) => void) {
        stdoutListeners.push(cb);
      },
    },
    stderr: {
      on(_evt: string, cb: (chunk: Buffer) => void) {
        stderrListeners.push(cb);
      },
    },
    on(evt: string, cb: (...args: unknown[]) => void) {
      listeners[evt] = [...(listeners[evt] ?? []), cb];
    },
  };

  // Emit events after all handlers are registered (next microtask tick).
  Promise.resolve().then(() => {
    if (opts.spawnError) {
      listeners.error?.[0]?.(opts.spawnError);
      return;
    }
    if (opts.stdout) stdoutListeners[0]?.(Buffer.from(opts.stdout));
    if (opts.stderr) stderrListeners[0]?.(Buffer.from(opts.stderr));
    listeners.exit?.[0]?.(opts.exitCode ?? 0);
  });

  return child as unknown as ChildProcess;
}

// ---------------------------------------------------------------------------
// DB mock factory
// ---------------------------------------------------------------------------

type MockDb = ServiceDb & { _updatedSets: Record<string, unknown>[] };

function makeDb(triggerRows: object[] = []): MockDb {
  const updatedSets: Record<string, unknown>[] = [];
  return {
    _updatedSets: updatedSets,
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(triggerRows),
          }),
        }),
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
  } as unknown as MockDb;
}

function makeTrigger(overrides: Record<string, unknown> = {}) {
  return {
    id: "trigger-uuid-001",
    jobId: "discovery",
    status: "queued",
    triggeredByEmail: "operator@test.nl",
    queuedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    error: null,
    output: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pollOnce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns immediately when no queued rows exist", async () => {
    const db = makeDb([]);
    await pollOnce(db);
    expect(db._updatedSets).toHaveLength(0);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it("marks status=failed for an unknown job_id (allowlist guard)", async () => {
    const trigger = makeTrigger({ jobId: "evil-rm-rf" });
    const db = makeDb([trigger]);

    await pollOnce(db);

    expect(mockedSpawn).not.toHaveBeenCalled();
    expect(db._updatedSets).toHaveLength(1);
    expect(db._updatedSets[0]).toMatchObject({
      status: "failed",
      error: "Unknown job_id: evil-rm-rf",
    });
    expect(db._updatedSets[0]).toHaveProperty("finishedAt");
  });

  it("marks status=running then status=done for a zero-exit spawn", async () => {
    const trigger = makeTrigger({ jobId: "discovery" });
    const db = makeDb([trigger]);
    // Use mockImplementation so mockChild() is called at spawn() time (inside pollOnce),
    // not at test-setup time. This ensures event handlers are registered before microtasks fire.
    mockedSpawn.mockImplementation(() => mockChild({ exitCode: 0, stdout: "Discovery done.\n" }));

    await pollOnce(db);

    expect(db._updatedSets).toHaveLength(2);
    expect(db._updatedSets[0]).toMatchObject({ status: "running" });
    expect(db._updatedSets[0]).toHaveProperty("startedAt");
    expect(db._updatedSets[1]).toMatchObject({ status: "done", exitCode: 0, error: null });
    expect(db._updatedSets[1]).toHaveProperty("finishedAt");
  });

  it("marks status=failed on non-zero exit code", async () => {
    const trigger = makeTrigger({ jobId: "scoring" });
    const db = makeDb([trigger]);
    mockedSpawn.mockImplementation(() =>
      mockChild({ exitCode: 1, stderr: "Error: DB connection refused\nstack trace" }),
    );

    await pollOnce(db);

    expect(db._updatedSets[1]).toMatchObject({ status: "failed", exitCode: 1 });
    expect(db._updatedSets[1]?.error).toBe("Error: DB connection refused");
  });

  it("marks status=failed when spawn emits an error event", async () => {
    const trigger = makeTrigger({ jobId: "orchestrator" });
    const db = makeDb([trigger]);
    mockedSpawn.mockImplementation(() =>
      mockChild({ spawnError: new Error("ENOENT: bin not found") }),
    );

    await pollOnce(db);

    expect(db._updatedSets[1]).toMatchObject({ status: "failed", exitCode: 1 });
    expect(db._updatedSets[1]?.error).toMatch(/ENOENT/);
  });

  it("captures combined stdout+stderr in the output field", async () => {
    const trigger = makeTrigger({ jobId: "kill-scan" });
    const db = makeDb([trigger]);
    mockedSpawn.mockImplementation(() =>
      mockChild({ exitCode: 0, stdout: "stdout line\n", stderr: "stderr line\n" }),
    );

    await pollOnce(db);

    const finalUpdate = db._updatedSets[1] as Record<string, unknown>;
    expect(typeof finalUpdate?.output).toBe("string");
    expect(finalUpdate?.output as string).toContain("stdout line");
  });

  it("stores null output when the process produces no output", async () => {
    const trigger = makeTrigger({ jobId: "gsc-pull" });
    const db = makeDb([trigger]);
    mockedSpawn.mockImplementation(() => mockChild({ exitCode: 0 }));

    await pollOnce(db);

    expect(db._updatedSets[1]).toMatchObject({ output: null });
  });

  it("truncates output to the last 4000 chars", async () => {
    const trigger = makeTrigger({ jobId: "reconciliation" });
    const db = makeDb([trigger]);
    const longOutput = "x".repeat(5000);
    mockedSpawn.mockImplementation(() => mockChild({ exitCode: 0, stdout: longOutput }));

    await pollOnce(db);

    const finalUpdate = db._updatedSets[1] as Record<string, unknown>;
    expect((finalUpdate?.output as string).length).toBeLessThanOrEqual(4000);
  });

  it("spawns the correct bin filename for the job_id", async () => {
    const trigger = makeTrigger({ jobId: "promotion" });
    const db = makeDb([trigger]);
    mockedSpawn.mockImplementation(() => mockChild({ exitCode: 0 }));

    await pollOnce(db);

    // BIN_DIR is a module-level constant (set at import time), so we can't control
    // the full path from a test. Assert on the invariant that matters: the filename.
    expect(mockedSpawn).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining("promotion-once.js")],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
  });

  describe("allowed job_ids", () => {
    const KNOWN_JOBS = [
      "discovery",
      "scoring",
      "validation",
      "kill-scan",
      "niche-monthly-metrics",
      "algorithm-events-ingest",
      "promotion",
      "gsc-pull",
      "reconciliation",
      "bol-feed-sync",
      "orchestrator",
      "test-page-draft",
      "content-polish",
    ];

    it.each(KNOWN_JOBS)("allows job_id=%s", async (jobId) => {
      const db = makeDb([makeTrigger({ jobId })]);
      mockedSpawn.mockImplementation(() => mockChild({ exitCode: 0 }));
      await pollOnce(db);
      expect(mockedSpawn).toHaveBeenCalledTimes(1);
    });

    it.each(["migration", "migration-dry-run", "rm -rf /", "../escape"])(
      "rejects job_id=%s",
      async (jobId) => {
        const db = makeDb([makeTrigger({ jobId })]);
        await pollOnce(db);
        expect(mockedSpawn).not.toHaveBeenCalled();
        expect(db._updatedSets[0]).toMatchObject({ status: "failed" });
      },
    );
  });
});
