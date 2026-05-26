import { scoringAgent } from "@nichefinder/agent-sdk";
import { CRITERION_KEYS, RUBRIC_VERSION } from "@nichefinder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runScoringJob } from "../scoring.js";

// -----------------------------------------------------------------------------
// We mock both the agent SDK runner and the database client. The job's
// responsibilities are: select unscored candidates, prefetch, run, persist.
// Tests cover idempotency intent (selection), orchestration, and cost rollup.
// -----------------------------------------------------------------------------

vi.mock("@nichefinder/agent-sdk", async () => {
  const actual =
    await vi.importActual<typeof import("@nichefinder/agent-sdk")>("@nichefinder/agent-sdk");
  return {
    ...actual,
    scoringAgent: {
      ...actual.scoringAgent,
      runScoringWithEscalation: vi.fn(),
    },
  };
});

const mockedRun = vi.mocked(scoringAgent.runScoringWithEscalation);

// -----------------------------------------------------------------------------
// Tiny fake-db that captures inserts and lets us seed the select result.
// -----------------------------------------------------------------------------

interface FakeCandidate {
  id: string;
  topic: string;
  topicSlug: string;
  relatedKeywords: string[];
}

interface InsertedScore {
  candidateId: string;
  model: string;
  totalScore: number;
  breakdown: unknown;
  rubricVersion: string;
  agentRunId: string;
  notes: string | null;
}

function makeFakeDb(unscored: FakeCandidate[]) {
  const inserted: InsertedScore[] = [];
  // Build a thenable selection chain that resolves to the seeded rows.
  const selectChain = {
    from: () => selectChain,
    leftJoin: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    groupBy: () => selectChain,
    as: () => selectChain,
    limit: () =>
      Promise.resolve(
        unscored.map((c) => ({
          id: c.id,
          topic: c.topic,
          topicSlug: c.topicSlug,
          relatedKeywords: c.relatedKeywords,
          lastScoredAt: null,
        })),
      ),
  };
  const db = {
    select: () => selectChain,
    insert: () => ({
      values: (row: InsertedScore) => {
        inserted.push(row);
        return Promise.resolve();
      },
    }),
  };
  // The job uses ServiceDb; we cast at the boundary.
  return { db: db as unknown as Parameters<typeof runScoringJob>[0]["db"], inserted };
}

function fakeBreakdown(scoreEach = 50): scoringAgent.ScoringOutput["breakdown"] {
  return Object.fromEntries(
    CRITERION_KEYS.map((k) => [k, { score: scoreEach, evidence: { stub: true } }]),
  ) as scoringAgent.ScoringOutput["breakdown"];
}

function fakeAgentResult(opts: {
  total?: number;
  escalated?: boolean;
  blockReason?: scoringAgent.ScoringOutput["block_reason"];
  haikuCost?: number;
  sonnetCost?: number;
}) {
  const total = opts.total ?? 50;
  const breakdown = fakeBreakdown();
  const output: scoringAgent.ScoringOutput = {
    rubric_version: RUBRIC_VERSION,
    total_score: opts.blockReason ? 0 : total,
    block_reason: opts.blockReason ?? null,
    breakdown,
    notes: "stub",
  };
  const haiku = {
    output,
    amended: false,
    modelClaimed: { total, blockReason: opts.blockReason ?? null },
    totalDriftDelta: 0,
    agentRunId: "haiku-run",
    costEur: opts.haikuCost ?? 0.01,
  };
  if (!opts.escalated) {
    return { final: haiku, haiku, escalated: false as const };
  }
  const sonnet = { ...haiku, agentRunId: "sonnet-run", costEur: opts.sonnetCost ?? 0.05 };
  return { final: sonnet, haiku, sonnet, escalated: true as const };
}

const stubPrefetch = {
  fetchBundle: vi.fn(async () => ({
    affiliate_availability: {},
    dataforseo_keywords: {},
    dataforseo_serp_top5: {},
    trademark: { euipo_tmview: "clear" } as const,
    kill_list_match: null,
    ymyl_match: false,
    operator_interest: 50,
  })),
};

const stubRuntime = { db: {}, monthlyBudgetEur: 200, perCallCapEur: 0.5 } as Parameters<
  typeof runScoringJob
>[0]["runtime"];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runScoringJob", () => {
  it("returns zero work when there are no unscored candidates", async () => {
    const { db } = makeFakeDb([]);
    const result = await runScoringJob({ db, runtime: stubRuntime, prefetch: stubPrefetch });
    expect(result).toMatchObject({
      candidatesConsidered: 0,
      scored: 0,
      blockedByHost: 0,
      escalated: 0,
    });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("scores each candidate and writes one niche_scores row per success", async () => {
    const { db, inserted } = makeFakeDb([
      {
        id: "c1",
        topic: "Aeropress draagbaar",
        topicSlug: "aeropress-draagbaar",
        relatedKeywords: ["aeropress"],
      },
      {
        id: "c2",
        topic: "Ergonomische bureaustoel",
        topicSlug: "ergonomische-bureaustoel",
        relatedKeywords: ["bureaustoel"],
      },
    ]);
    mockedRun.mockResolvedValueOnce(fakeAgentResult({ total: 72 }) as never);
    mockedRun.mockResolvedValueOnce(fakeAgentResult({ total: 48 }) as never);

    const result = await runScoringJob({ db, runtime: stubRuntime, prefetch: stubPrefetch });

    expect(result.candidatesConsidered).toBe(2);
    expect(result.scored).toBe(2);
    expect(result.escalated).toBe(0);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({
      candidateId: "c1",
      model: "claude-haiku-4-5-20251001",
      totalScore: 72,
      rubricVersion: RUBRIC_VERSION,
    });
    expect(inserted[1]?.totalScore).toBe(48);
  });

  it("records the Sonnet model when the run escalated", async () => {
    const { db, inserted } = makeFakeDb([
      { id: "c1", topic: "X", topicSlug: "x", relatedKeywords: ["x"] },
    ]);
    mockedRun.mockResolvedValueOnce(
      fakeAgentResult({ total: 65, escalated: true, sonnetCost: 0.07 }) as never,
    );
    const result = await runScoringJob({ db, runtime: stubRuntime, prefetch: stubPrefetch });
    expect(result.escalated).toBe(1);
    expect(inserted[0]?.model).toBe("claude-sonnet-4-6");
    // Cost rolls up both passes.
    expect(result.totalCostEur).toBeCloseTo(0.08, 5);
  });

  it("counts blocked candidates separately and persists a 0 score", async () => {
    const { db, inserted } = makeFakeDb([
      { id: "c1", topic: "X", topicSlug: "x", relatedKeywords: ["x"] },
    ]);
    mockedRun.mockResolvedValueOnce(fakeAgentResult({ blockReason: "kill_list" }) as never);
    const result = await runScoringJob({ db, runtime: stubRuntime, prefetch: stubPrefetch });
    expect(result.blockedByHost).toBe(1);
    expect(inserted[0]?.totalScore).toBe(0);
  });

  it("isolates failures: one bad candidate doesn't stop the rest", async () => {
    const { db, inserted } = makeFakeDb([
      { id: "c1", topic: "X", topicSlug: "x", relatedKeywords: ["x"] },
      { id: "c2", topic: "Y", topicSlug: "y", relatedKeywords: ["y"] },
    ]);
    mockedRun.mockRejectedValueOnce(new Error("upstream 429") as never);
    mockedRun.mockResolvedValueOnce(fakeAgentResult({ total: 60 }) as never);

    const result = await runScoringJob({ db, runtime: stubRuntime, prefetch: stubPrefetch });

    expect(result.scored).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ candidateId: "c1", topicSlug: "x" });
    expect(result.failures[0]?.error).toContain("429");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.candidateId).toBe("c2");
  });
});
