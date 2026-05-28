import { validationAgent } from "@nichefinder/agent-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runValidationJob } from "../validation.js";
import { buildValidationInput } from "../validationMetrics.js";

// Mock the agent runner and the metrics aggregator: the job's own job is
// selection → run → persist, which is what we exercise here.
vi.mock("@nichefinder/agent-sdk", async () => {
  const actual =
    await vi.importActual<typeof import("@nichefinder/agent-sdk")>("@nichefinder/agent-sdk");
  return {
    ...actual,
    validationAgent: { ...actual.validationAgent, runValidationAgent: vi.fn() },
  };
});
vi.mock("../validationMetrics.js", () => ({
  buildValidationInput: vi.fn(),
}));

const mockedRun = vi.mocked(validationAgent.runValidationAgent);
const mockedBuild = vi.mocked(buildValidationInput);

interface InsertedEval {
  nicheId: string;
  decision: string;
  modelDecision: string;
  safeguardReason: string | null;
  [k: string]: unknown;
}

function makeFakeDb(nicheRows: Array<{ id: string; topicSlug: string }>) {
  const inserted: InsertedEval[] = [];
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(nicheRows),
  };
  const db = {
    select: () => selectChain,
    insert: () => ({
      values: (row: InsertedEval) => ({
        returning: () => {
          inserted.push(row);
          return Promise.resolve([{ id: `eval-${inserted.length}` }]);
        },
      }),
    }),
  };
  return { db: db as unknown as Parameters<typeof runValidationJob>[0]["db"], inserted };
}

const stubRuntime = { db: {}, monthlyBudgetEur: 200, perCallCapEur: 0.5 } as Parameters<
  typeof runValidationJob
>[0]["runtime"];

const sampleInput: validationAgent.ValidationInput = {
  niche: { topic: "X", topic_slug: "x", days_in_validation: 14 },
  test_pages: [{ url: "/test/x/review", sessions: 100, affiliate_clicks: 5 }],
  metrics: {
    window_days: 14,
    paid_traffic_spend_eur: 0,
    sessions_total: 100,
    affiliate_clicks_total: 5,
    affiliate_clicks_by_network: { bol: 5 },
    affiliate_conversions: 1,
    affiliate_revenue_eur: 12,
    email_signups: 0,
  },
};

function fakeRun(opts: {
  decision: validationAgent.ValidationDecision;
  modelDecision?: validationAgent.ValidationDecision;
  amendedReason?: validationAgent.SafeguardReason | null;
  cost?: number;
}) {
  const modelDecision = opts.modelDecision ?? opts.decision;
  const amendedReason = opts.amendedReason ?? null;
  return {
    output: {
      decision: opts.decision,
      confidence: "medium" as const,
      rationale: "stub",
      key_metrics: {
        sessions: 100,
        affiliate_clicks: 5,
        affiliate_conversions: 1,
        affiliate_revenue_eur: 12,
        email_signups: 0,
        avg_time_on_page_seconds: 30,
        ctr_to_affiliate: 0.05,
      },
      next_actions: ["do thing"],
    },
    modelDecision,
    safeguard: { amendedReason, decision: opts.decision, amended: amendedReason !== null },
    agentRunId: "run-1",
    costEur: opts.cost ?? 0.02,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runValidationJob", () => {
  it("returns zero work when no niches are validating", async () => {
    const { db } = makeFakeDb([]);
    const result = await runValidationJob({ db, runtime: stubRuntime });
    expect(result.nichesConsidered).toBe(0);
    expect(result.evaluated).toBe(0);
    expect(mockedBuild).not.toHaveBeenCalled();
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("evaluates each niche and writes one recommendation row", async () => {
    const { db, inserted } = makeFakeDb([
      { id: "n1", topicSlug: "x" },
      { id: "n2", topicSlug: "y" },
    ]);
    mockedBuild.mockResolvedValue(sampleInput);
    mockedRun.mockResolvedValueOnce(fakeRun({ decision: "go", cost: 0.02 }) as never);
    mockedRun.mockResolvedValueOnce(fakeRun({ decision: "kill", cost: 0.03 }) as never);

    const result = await runValidationJob({ db, runtime: stubRuntime });

    expect(result.evaluated).toBe(2);
    expect(result.totalCostEur).toBeCloseTo(0.05, 5);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({ nicheId: "n1", decision: "go", modelDecision: "go" });
    expect(inserted[1]).toMatchObject({ nicheId: "n2", decision: "kill" });
    expect(result.outcomes[0]).toMatchObject({ evaluationId: "eval-1", decision: "go" });
  });

  it("persists the safeguard-amended decision and flags it", async () => {
    const { db, inserted } = makeFakeDb([{ id: "n1", topicSlug: "x" }]);
    mockedBuild.mockResolvedValue(sampleInput);
    mockedRun.mockResolvedValueOnce(
      fakeRun({
        decision: "pivot",
        modelDecision: "go",
        amendedReason: "go_without_conversion",
      }) as never,
    );

    const result = await runValidationJob({ db, runtime: stubRuntime });

    expect(result.outcomes[0]).toMatchObject({
      decision: "pivot",
      modelDecision: "go",
      amended: true,
    });
    expect(inserted[0]).toMatchObject({
      decision: "pivot",
      modelDecision: "go",
      safeguardReason: "go_without_conversion",
    });
  });

  it("skips niches with no test-page data", async () => {
    const { db, inserted } = makeFakeDb([{ id: "n1", topicSlug: "x" }]);
    mockedBuild.mockResolvedValue(null);

    const result = await runValidationJob({ db, runtime: stubRuntime });

    expect(result.skippedNoData).toBe(1);
    expect(result.evaluated).toBe(0);
    expect(inserted).toHaveLength(0);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("captures per-niche failures without aborting the batch", async () => {
    const { db, inserted } = makeFakeDb([
      { id: "n1", topicSlug: "x" },
      { id: "n2", topicSlug: "y" },
    ]);
    mockedBuild.mockResolvedValue(sampleInput);
    mockedRun.mockRejectedValueOnce(new Error("budget breach"));
    mockedRun.mockResolvedValueOnce(fakeRun({ decision: "go" }) as never);

    const result = await runValidationJob({ db, runtime: stubRuntime });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ nicheId: "n1", error: "budget breach" });
    expect(result.evaluated).toBe(1);
    expect(inserted).toHaveLength(1);
  });
});
