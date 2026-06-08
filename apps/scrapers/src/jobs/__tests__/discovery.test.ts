import { discoveryAgent } from "@nichefinder/agent-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunDiscoveryJobOptions } from "../discovery.js";
import { runDiscoveryJob } from "../discovery.js";
import type { DiscoverySignal } from "../discovery.js";

// ---------------------------------------------------------------------------
// Mock the agent SDK so no real Anthropic calls are made.
// ---------------------------------------------------------------------------

vi.mock("@nichefinder/agent-sdk", async () => {
  const actual =
    await vi.importActual<typeof import("@nichefinder/agent-sdk")>("@nichefinder/agent-sdk");
  return {
    ...actual,
    discoveryAgent: {
      ...actual.discoveryAgent,
      runDiscoveryAgent: vi.fn(),
    },
  };
});

const mockedRun = vi.mocked(discoveryAgent.runDiscoveryAgent);

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeSignal(source: DiscoverySignal["source"] = "dataforseo"): DiscoverySignal {
  return {
    source,
    summary: "staandbureau Nederland 1200/mo, lage concurrentie",
    raw: { keyword: "staandbureau" },
  };
}

function makeCandidate(topicSlug = "staandbureau"): discoveryAgent.NicheCandidate {
  return {
    topic: "Staandbureau",
    topic_slug: topicSlug,
    language: "nl",
    related_keywords: ["staandbureau kopen", "verstelbaar bureau"],
    evidence: {
      source: "dataforseo",
      signal_summary: "1200 searches/mo, low competition",
      raw_signal: { keyword: "staandbureau" },
    },
    preliminary_red_flags: [],
  };
}

function makeAgentResult(
  candidates: discoveryAgent.NicheCandidate[] = [makeCandidate()],
  killed: discoveryAgent.RunDiscoveryResult["killed"] = [],
) {
  return { candidates, killed, agentRunId: "run-uuid-001", costEur: 0.05 };
}

// A mock DB whose from() returns a thenable that also supports .where() chaining.
// This satisfies both:
//   await db.select().from(niches)             (no where)
//   await db.select().from(candidates).where() (with where)
function makeDb(existingSlugs: string[] = []) {
  const insertedRows: Record<string, unknown>[] = [];
  const slugRows = existingSlugs.map((s) => ({ topicSlug: s }));

  function queryResult() {
    return Object.assign(Promise.resolve(slugRows), {
      where: () => Promise.resolve(slugRows),
    });
  }

  const db = {
    select: () => ({ from: () => queryResult() }),
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        insertedRows.push(row);
        return Promise.resolve();
      },
    }),
  } as unknown as RunDiscoveryJobOptions["db"];

  return { db, insertedRows };
}

const FAKE_RUNTIME = {
  db: {} as RunDiscoveryJobOptions["db"],
  monthlyBudgetEur: 200,
  perCallCapEur: 2.5,
} as RunDiscoveryJobOptions["runtime"];

function makeGatherer(signals: DiscoverySignal[] = [makeSignal()]) {
  return vi.fn().mockResolvedValue(signals);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runDiscoveryJob", () => {
  beforeEach(() => {
    mockedRun.mockReset();
  });

  it("returns early and skips agent call when all gatherers return empty arrays", async () => {
    const { db } = makeDb();
    const result = await runDiscoveryJob({
      db,
      runtime: FAKE_RUNTIME,
      gatherers: [vi.fn().mockResolvedValue([])],
    });

    expect(result.signalsGathered).toBe(0);
    expect(result.candidatesFromAgent).toBe(0);
    expect(result.written).toBe(0);
    expect(result.agentRunId).toBe("");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("writes kill-list-safe candidates to the DB", async () => {
    mockedRun.mockResolvedValue(makeAgentResult());
    const { db, insertedRows } = makeDb();

    const result = await runDiscoveryJob({
      db,
      runtime: FAKE_RUNTIME,
      gatherers: [makeGatherer()],
    });

    expect(result.signalsGathered).toBe(1);
    expect(result.candidatesFromAgent).toBe(1);
    expect(result.killedByKillList).toBe(0);
    expect(result.written).toBe(1);
    expect(result.totalCostEur).toBe(0.05);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      topic: "Staandbureau",
      topicSlug: "staandbureau",
      trademarkCheckState: "pending",
    });
  });

  it("counts kill-list-killed candidates but does NOT write them to the DB", async () => {
    const killed: discoveryAgent.RunDiscoveryResult["killed"] = [
      {
        candidate: makeCandidate("cbd-olie"),
        match: {
          category:
            "CBD_supplements" as unknown as discoveryAgent.FilterResult["killed"][number]["match"]["category"],
          matchedStem: "cbd",
          matchedAgainst: "topic",
          matchedValue: "cbd-olie",
        },
      },
    ];
    mockedRun.mockResolvedValue(makeAgentResult([], killed));
    const { db, insertedRows } = makeDb();

    const result = await runDiscoveryJob({
      db,
      runtime: FAKE_RUNTIME,
      gatherers: [makeGatherer()],
    });

    expect(result.killedByKillList).toBe(1);
    expect(result.written).toBe(0);
    expect(insertedRows).toHaveLength(0);
  });

  it("marks trademark conflicts in the DB and increments killedByTrademark", async () => {
    mockedRun.mockResolvedValue(makeAgentResult([makeCandidate("staandbureau")]));
    const { db, insertedRows } = makeDb();
    const euipo = {
      hasActiveMatch: vi.fn().mockResolvedValue({ hit: true, total: 3 }),
    };

    const result = await runDiscoveryJob({
      db,
      runtime: FAKE_RUNTIME,
      gatherers: [makeGatherer()],
      euipo,
    });

    expect(result.killedByTrademark).toBe(1);
    expect(result.written).toBe(0);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      trademarkCheckState: "conflict",
      trademarkConflicts: { total: 3, term: "Staandbureau" },
    });
  });

  it("passes EUIPO when no hit and writes as pending", async () => {
    mockedRun.mockResolvedValue(makeAgentResult([makeCandidate()]));
    const { db, insertedRows } = makeDb();
    const euipo = {
      hasActiveMatch: vi.fn().mockResolvedValue({ hit: false, total: 0 }),
    };

    const result = await runDiscoveryJob({
      db,
      runtime: FAKE_RUNTIME,
      gatherers: [makeGatherer()],
      euipo,
    });

    expect(result.killedByTrademark).toBe(0);
    expect(result.written).toBe(1);
    expect(insertedRows[0]).toMatchObject({ trademarkCheckState: "pending" });
  });

  it("tolerates individual gatherer failure and uses signals from other gatherers", async () => {
    mockedRun.mockResolvedValue(makeAgentResult());
    const { db } = makeDb();
    const failingGatherer = vi.fn().mockRejectedValue(new Error("DataForSEO timeout"));
    const workingGatherer = makeGatherer([makeSignal("bol_trends")]);

    const result = await runDiscoveryJob({
      db,
      runtime: FAKE_RUNTIME,
      gatherers: [failingGatherer, workingGatherer],
    });

    expect(result.signalsGathered).toBe(1);
    expect(result.written).toBe(1);
  });

  it("passes exclude slugs from existing niche_candidates and niches to the agent", async () => {
    mockedRun.mockResolvedValue(makeAgentResult());
    const { db } = makeDb(["existing-slug"]);

    await runDiscoveryJob({
      db,
      runtime: FAKE_RUNTIME,
      gatherers: [makeGatherer()],
    });

    const callArgs = mockedRun.mock.calls[0]?.[1];
    expect(callArgs?.excludeSlugs).toContain("existing-slug");
  });

  it("respects maxSignals cap and slices signal array before agent call", async () => {
    mockedRun.mockResolvedValue(makeAgentResult([], []));
    const { db } = makeDb();
    const manySignals = Array.from({ length: 10 }, () => makeSignal());
    const gatherer = vi.fn().mockResolvedValue(manySignals);

    await runDiscoveryJob({
      db,
      runtime: FAKE_RUNTIME,
      gatherers: [gatherer],
      maxSignals: 3,
    });

    const callArgs = mockedRun.mock.calls[0]?.[1];
    expect(callArgs?.signals).toHaveLength(3);
  });
});
