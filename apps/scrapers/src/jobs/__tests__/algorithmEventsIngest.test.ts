import type { AlgorithmEventInsert } from "@nichefinder/shared";
import { describe, expect, it } from "vitest";
import {
  type RunAlgorithmEventsIngestOptions,
  runAlgorithmEventsIngestJob,
} from "../algorithmEventsIngest.js";

// ---------------------------------------------------------------------------
// Fake db: captures the inserted rows and the ON CONFLICT ... SET clause.
// ---------------------------------------------------------------------------

interface UpsertCapture {
  rows: Array<Record<string, unknown>>;
  conflict?: { target: unknown; set: Record<string, unknown> };
  insertCalls: number;
}

function makeDb(capture: UpsertCapture): RunAlgorithmEventsIngestOptions["db"] {
  return {
    insert: () => ({
      values: (rows: Array<Record<string, unknown>>) => {
        capture.insertCalls += 1;
        capture.rows = rows;
        return {
          onConflictDoUpdate: (cfg: { target: unknown; set: Record<string, unknown> }) => {
            capture.conflict = cfg;
            return Promise.resolve(undefined);
          },
        };
      },
    }),
  } as unknown as RunAlgorithmEventsIngestOptions["db"];
}

function event(over: Partial<AlgorithmEventInsert> = {}): AlgorithmEventInsert {
  return {
    externalId: "incident-1",
    kind: "core_update",
    name: "March 2026 core update",
    startedAt: "2026-03-27T00:00:00.000Z",
    endedAt: "2026-04-08T00:00:00.000Z",
    source: "google_search_status",
    ...over,
  };
}

describe("runAlgorithmEventsIngestJob", () => {
  it("returns early and never inserts when the feed has no ranking events", async () => {
    const capture: UpsertCapture = { rows: [], insertCalls: 0 };
    const result = await runAlgorithmEventsIngestJob({
      db: makeDb(capture),
      fetchRankingEvents: async () => [],
    });
    expect(result).toEqual({ rankingEvents: 0, rowsUpserted: 0 });
    expect(capture.insertCalls).toBe(0);
  });

  it("upserts mapped events, converting ISO strings to Date objects", async () => {
    const capture: UpsertCapture = { rows: [], insertCalls: 0 };
    const result = await runAlgorithmEventsIngestJob({
      db: makeDb(capture),
      fetchRankingEvents: async () => [event()],
    });

    expect(result).toEqual({ rankingEvents: 1, rowsUpserted: 1 });
    expect(capture.insertCalls).toBe(1);
    expect(capture.rows[0]).toMatchObject({
      kind: "core_update",
      name: "March 2026 core update",
      source: "google_search_status",
      externalId: "incident-1",
    });
    expect(capture.rows[0]?.startedAt).toBeInstanceOf(Date);
    expect((capture.rows[0]?.startedAt as Date).toISOString()).toBe("2026-03-27T00:00:00.000Z");
    expect((capture.rows[0]?.endedAt as Date).toISOString()).toBe("2026-04-08T00:00:00.000Z");
  });

  it("keeps endedAt null for an ongoing rollout", async () => {
    const capture: UpsertCapture = { rows: [], insertCalls: 0 };
    await runAlgorithmEventsIngestJob({
      db: makeDb(capture),
      fetchRankingEvents: async () => [event({ endedAt: null })],
    });
    expect(capture.rows[0]?.endedAt).toBeNull();
  });

  it("conflicts on (source, external_id) and refreshes every field from the feed", async () => {
    const capture: UpsertCapture = { rows: [], insertCalls: 0 };
    await runAlgorithmEventsIngestJob({
      db: makeDb(capture),
      fetchRankingEvents: async () => [event()],
    });
    const set = capture.conflict?.set ?? {};
    expect(Object.keys(set).sort()).toEqual(["endedAt", "kind", "name", "startedAt"]);
    // created_at must NOT be in the SET clause — first-seen time is preserved.
    expect(set).not.toHaveProperty("createdAt");
  });
});
