import { promotionAgent } from "@nichefinder/agent-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateDomainAdapter, RunPromotionJobOptions } from "../promotion.js";
import { createStubDomainAdapter, runPromotionJob } from "../promotion.js";

// ---------------------------------------------------------------------------
// Mock the promotion agent runner — no real Anthropic or DB calls.
// ---------------------------------------------------------------------------

vi.mock("@nichefinder/agent-sdk", async () => {
  const actual =
    await vi.importActual<typeof import("@nichefinder/agent-sdk")>("@nichefinder/agent-sdk");
  return {
    ...actual,
    promotionAgent: {
      ...actual.promotionAgent,
      runPromotionAgent: vi.fn(),
    },
  };
});

const mockedRun = vi.mocked(promotionAgent.runPromotionAgent);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAgentResult(
  result: promotionAgent.PromotionResult = "not_ready",
): Awaited<ReturnType<typeof promotionAgent.runPromotionAgent>> {
  const output = promotionAgent.PromotionOutputSchema.parse({
    result,
    criteria: {
      revenue: { passed: false, value: [0, 0, 0], threshold: 150 },
      organic_clicks: { passed: false, value: [0, 0, 0], threshold: 1500 },
      diversity: { passed: true, value: 2, threshold: 2 },
      branded_search: { passed: false, value: 0, threshold: 10 },
      engagement: { passed: true, value: 45, threshold: 30 },
      algorithm_quiet: { passed: true, value: [], threshold: 0 },
      no_manual_action: { passed: true, value: [], threshold: 0 },
    },
    recommendation: "Niche heeft nog niet genoeg omzet.",
    earliest_retry_date: "2026-09-07",
  });
  return {
    output,
    modelResult: result,
    mechanical: { forcedResult: null, reasons: [] },
    resultAmended: false,
    agentRunId: "aaaaaaaa-0000-0000-0000-000000000001",
    costEur: 0.15,
  };
}

/** Stub DB: no conversions, no gsc_metrics, no recent evaluations, no clicks. */
function makeStubDb() {
  const selectResult = {
    rows: [{ median: "0" }],
  };
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ total: "0", totalClicks: "0", nonBrand: "0" }]),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: "eval-uuid-001" }]),
      }),
    }),
    execute: () => Promise.resolve(selectResult),
  } as unknown as Parameters<typeof runPromotionJob>[0]["db"];
}

function makeOpts(overrides: Partial<RunPromotionJobOptions> = {}): RunPromotionJobOptions {
  return {
    db: makeStubDb(),
    runtime: { db: makeStubDb(), monthlyBudgetEur: 200, perCallCapEur: 10 },
    asOf: "2026-06-09T04:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPromotionJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty result when no eligible niches", async () => {
    // DB returns no niches — stub select returns empty array for niches.
    const db = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
      execute: () => Promise.resolve({ rows: [{ median: "0" }] }),
    } as unknown as RunPromotionJobOptions["db"];

    const result = await runPromotionJob(makeOpts({ db }));

    expect(result.considered).toBe(0);
    expect(result.evaluated).toHaveLength(0);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("calls agent and writes evaluation row for each eligible niche", async () => {
    mockedRun.mockResolvedValueOnce(makeAgentResult("not_ready"));

    const niche = {
      id: "niche-uuid-001",
      tenantId: "tenant-uuid-001",
      topic: "Staandbureau",
      topicSlug: "staandbureau",
      state: "building",
      buildingStartedAt: new Date("2026-01-01"),
      matureAt: null,
    };

    let selectCall = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => {
            selectCall++;
            // 1st call: promotionEvaluations (recently evaluated) → empty
            // 2nd call: niches → one niche
            // 3rd+ calls: metric queries → zeros
            if (selectCall === 1) return Promise.resolve([]);
            if (selectCall === 2) return Promise.resolve([niche]);
            return Promise.resolve([{ total: "0", totalClicks: "0", nonBrand: "0" }]);
          },
        }),
      }),
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve([{ id: "eval-uuid-001" }]),
        }),
      }),
      execute: () => Promise.resolve({ rows: [{ median: "0" }] }),
    } as unknown as RunPromotionJobOptions["db"];

    const result = await runPromotionJob(makeOpts({ db }));

    expect(mockedRun).toHaveBeenCalledTimes(1);
    expect(result.evaluated).toHaveLength(1);
    expect(result.evaluated[0]?.result).toBe("not_ready");
    expect(result.evaluated[0]?.evaluationId).toBe("eval-uuid-001");
    expect(result.totalCostEur).toBeCloseTo(0.15);
  });

  it("records failure without throwing when agent errors", async () => {
    mockedRun.mockRejectedValueOnce(new Error("Anthropic timeout"));

    const niche = {
      id: "niche-uuid-002",
      tenantId: "tenant-uuid-002",
      topic: "Ergonomische Stoel",
      topicSlug: "ergonomische-stoel",
      state: "mature",
      buildingStartedAt: null,
      matureAt: new Date("2026-03-01"),
    };

    let selectCall = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => {
            selectCall++;
            if (selectCall === 1) return Promise.resolve([]);
            if (selectCall === 2) return Promise.resolve([niche]);
            return Promise.resolve([{ total: "0", totalClicks: "0", nonBrand: "0" }]);
          },
        }),
      }),
      insert: () => ({
        values: () => ({ returning: () => Promise.resolve([{ id: "x" }]) }),
      }),
      execute: () => Promise.resolve({ rows: [{ median: "0" }] }),
    } as unknown as RunPromotionJobOptions["db"];

    const result = await runPromotionJob(makeOpts({ db }));

    expect(result.evaluated).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.error).toMatch(/timeout/i);
  });

  it("stub domain adapter returns two candidates for any slug", async () => {
    const adapter = createStubDomainAdapter();
    const candidates = await adapter.getCandidates("staandbureau");
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.hostname).toBe("staandbureau.nl");
    expect(candidates[1]?.hostname).toBe("staandbureau.com");
    expect(candidates.every((c) => c.available === false)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Eligibility filtering
  // -------------------------------------------------------------------------

  describe("eligibility filtering", () => {
    function makeNiche(overrides: Record<string, unknown> = {}) {
      return {
        id: "niche-uuid-001",
        tenantId: "tenant-uuid-001",
        topic: "Staandbureau",
        topicSlug: "staandbureau",
        state: "mature",
        buildingStartedAt: new Date("2026-01-01"),
        matureAt: new Date("2026-03-01"),
        ...overrides,
      };
    }

    function makeNicheDb(
      niches: object[],
      recentNicheIds: string[] = [],
    ): RunPromotionJobOptions["db"] {
      let selectCall = 0;
      return {
        select: () => ({
          from: () => ({
            where: () => {
              selectCall++;
              if (selectCall === 1)
                return Promise.resolve(recentNicheIds.map((nicheId) => ({ nicheId })));
              if (selectCall === 2) return Promise.resolve(niches);
              return Promise.resolve([{ total: "0", totalClicks: "0", nonBrand: "0" }]);
            },
          }),
        }),
        insert: () => ({
          values: () => ({ returning: () => Promise.resolve([{ id: "eval-x" }]) }),
        }),
        execute: () => Promise.resolve({ rows: [{ median: "0" }] }),
      } as unknown as RunPromotionJobOptions["db"];
    }

    it("excludes a niche evaluated within the cooldown window", async () => {
      const niche = makeNiche();
      const db = makeNicheDb([niche], [niche.id]);

      const result = await runPromotionJob(makeOpts({ db }));

      expect(result.considered).toBe(0);
      expect(result.evaluated).toHaveLength(0);
      expect(mockedRun).not.toHaveBeenCalled();
    });

    it("respects the limit parameter", async () => {
      mockedRun.mockResolvedValue(makeAgentResult("not_ready"));
      const niche1 = makeNiche({ id: "niche-uuid-001" });
      const niche2 = makeNiche({ id: "niche-uuid-002", tenantId: "tenant-uuid-002" });
      const db = makeNicheDb([niche1, niche2]);

      const result = await runPromotionJob(makeOpts({ db, limit: 1 }));

      expect(result.considered).toBe(1);
      expect(mockedRun).toHaveBeenCalledTimes(1);
    });

    it("excludes niches with null tenantId", async () => {
      const db = makeNicheDb([makeNiche({ tenantId: null })]);

      const result = await runPromotionJob(makeOpts({ db }));

      expect(result.considered).toBe(0);
      expect(mockedRun).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Agent input — niche timing
  // -------------------------------------------------------------------------

  describe("agent input — niche timing", () => {
    // asOf = 2026-06-09T04:00:00Z used throughout makeOpts

    function makeTimingDb(niche: object): RunPromotionJobOptions["db"] {
      let selectCall = 0;
      return {
        select: () => ({
          from: () => ({
            where: () => {
              selectCall++;
              if (selectCall === 1) return Promise.resolve([]);
              if (selectCall === 2) return Promise.resolve([niche]);
              return Promise.resolve([{ total: "0", totalClicks: "0", nonBrand: "0" }]);
            },
          }),
        }),
        insert: () => ({
          values: () => ({ returning: () => Promise.resolve([{ id: "eval-x" }]) }),
        }),
        execute: () => Promise.resolve({ rows: [{ median: "0" }] }),
      } as unknown as RunPromotionJobOptions["db"];
    }

    it("calculates daysInState from matureAt when available", async () => {
      mockedRun.mockResolvedValueOnce(makeAgentResult("not_ready"));
      const niche = {
        id: "niche-uuid-t1",
        tenantId: "tenant-uuid-t1",
        topic: "T",
        topicSlug: "t",
        state: "mature",
        matureAt: new Date("2026-03-01"), // 100 days before asOf
        buildingStartedAt: new Date("2025-01-01"),
      };
      const db = makeTimingDb(niche);

      await runPromotionJob(makeOpts({ db }));

      const input = mockedRun.mock.calls[0]?.[1];
      expect(input?.niche.days_in_state).toBe(100);
    });

    it("falls back to buildingStartedAt when matureAt is null", async () => {
      mockedRun.mockResolvedValueOnce(makeAgentResult("not_ready"));
      const niche = {
        id: "niche-uuid-t2",
        tenantId: "tenant-uuid-t2",
        topic: "T",
        topicSlug: "t",
        state: "building",
        matureAt: null,
        buildingStartedAt: new Date("2026-01-01"), // 159 days before asOf
      };
      const db = makeTimingDb(niche);

      await runPromotionJob(makeOpts({ db }));

      const input = mockedRun.mock.calls[0]?.[1];
      expect(input?.niche.days_in_state).toBe(159);
    });
  });

  // -------------------------------------------------------------------------
  // Result variants
  // -------------------------------------------------------------------------

  describe("result variants", () => {
    function makeOneNicheDb(): RunPromotionJobOptions["db"] {
      let selectCall = 0;
      const niche = {
        id: "niche-uuid-v1",
        tenantId: "tenant-uuid-v1",
        topic: "V",
        topicSlug: "v",
        state: "mature",
        buildingStartedAt: null,
        matureAt: new Date("2026-03-01"),
      };
      return {
        select: () => ({
          from: () => ({
            where: () => {
              selectCall++;
              if (selectCall === 1) return Promise.resolve([]);
              if (selectCall === 2) return Promise.resolve([niche]);
              return Promise.resolve([{ total: "0", totalClicks: "0", nonBrand: "0" }]);
            },
          }),
        }),
        insert: () => ({
          values: () => ({ returning: () => Promise.resolve([{ id: "eval-v1" }]) }),
        }),
        execute: () => Promise.resolve({ rows: [{ median: "0" }] }),
      } as unknown as RunPromotionJobOptions["db"];
    }

    it("surfaces result=ready in the evaluated array", async () => {
      mockedRun.mockResolvedValueOnce(makeAgentResult("ready"));
      const result = await runPromotionJob(makeOpts({ db: makeOneNicheDb() }));
      expect(result.evaluated[0]?.result).toBe("ready");
    });

    it("surfaces result=blocked_by_update_window in the evaluated array", async () => {
      mockedRun.mockResolvedValueOnce(makeAgentResult("blocked_by_update_window"));
      const result = await runPromotionJob(makeOpts({ db: makeOneNicheDb() }));
      expect(result.evaluated[0]?.result).toBe("blocked_by_update_window");
    });
  });

  // -------------------------------------------------------------------------
  // Multi-niche accumulation
  // -------------------------------------------------------------------------

  describe("multi-niche accumulation", () => {
    function makeTwoNicheDb(): RunPromotionJobOptions["db"] {
      const niches = [
        {
          id: "niche-m1",
          tenantId: "tenant-m1",
          topic: "A",
          topicSlug: "a",
          state: "mature",
          buildingStartedAt: null,
          matureAt: new Date("2026-03-01"),
        },
        {
          id: "niche-m2",
          tenantId: "tenant-m2",
          topic: "B",
          topicSlug: "b",
          state: "mature",
          buildingStartedAt: null,
          matureAt: new Date("2026-03-01"),
        },
      ];
      let evalId = 0;
      let selectCall = 0;
      return {
        select: () => ({
          from: () => ({
            where: () => {
              selectCall++;
              if (selectCall === 1) return Promise.resolve([]);
              if (selectCall === 2) return Promise.resolve(niches);
              return Promise.resolve([{ total: "0", totalClicks: "0", nonBrand: "0" }]);
            },
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([{ id: `eval-multi-${++evalId}` }]),
          }),
        }),
        execute: () => Promise.resolve({ rows: [{ median: "0" }] }),
      } as unknown as RunPromotionJobOptions["db"];
    }

    it("accumulates totalCostEur across two successful niches", async () => {
      const r1 = makeAgentResult("not_ready");
      const r2 = makeAgentResult("not_ready");
      r1.costEur = 0.1;
      r2.costEur = 0.2;
      mockedRun.mockResolvedValueOnce(r1).mockResolvedValueOnce(r2);

      const result = await runPromotionJob(makeOpts({ db: makeTwoNicheDb(), limit: 2 }));

      expect(result.evaluated).toHaveLength(2);
      expect(result.totalCostEur).toBeCloseTo(0.3);
    });

    it("records both failures when two niches each throw", async () => {
      mockedRun
        .mockRejectedValueOnce(new Error("timeout A"))
        .mockRejectedValueOnce(new Error("timeout B"));

      const result = await runPromotionJob(makeOpts({ db: makeTwoNicheDb(), limit: 2 }));

      expect(result.evaluated).toHaveLength(0);
      expect(result.failures).toHaveLength(2);
      expect(result.failures[0]?.error).toMatch(/timeout A/i);
      expect(result.failures[1]?.error).toMatch(/timeout B/i);
    });
  });

  it("injectable domain adapter is used when provided", async () => {
    mockedRun.mockResolvedValueOnce(makeAgentResult("ready"));

    const customAdapter: CandidateDomainAdapter = {
      getCandidates: vi.fn().mockResolvedValue([
        {
          hostname: "staandbureau.nl",
          registrar: "transip",
          cost_eur_year: 8,
          available: true,
          tmview_clear: true,
        },
      ]),
    };

    const niche = {
      id: "niche-uuid-003",
      tenantId: "tenant-uuid-003",
      topic: "Staandbureau",
      topicSlug: "staandbureau",
      state: "mature",
      buildingStartedAt: null,
      matureAt: new Date("2025-12-01"),
    };

    let selectCall = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => {
            selectCall++;
            if (selectCall === 1) return Promise.resolve([]);
            if (selectCall === 2) return Promise.resolve([niche]);
            return Promise.resolve([{ total: "1000", totalClicks: "500", nonBrand: "400" }]);
          },
        }),
      }),
      insert: () => ({
        values: () => ({ returning: () => Promise.resolve([{ id: "eval-uuid-003" }]) }),
      }),
      execute: () => Promise.resolve({ rows: [{ median: "5" }] }),
    } as unknown as RunPromotionJobOptions["db"];

    await runPromotionJob(makeOpts({ db, domainAdapter: customAdapter }));

    expect(customAdapter.getCandidates).toHaveBeenCalledWith("staandbureau");
    const callArg = mockedRun.mock.calls[0]?.[1];
    expect(callArg?.candidate_domains[0]?.available).toBe(true);
  });
});
