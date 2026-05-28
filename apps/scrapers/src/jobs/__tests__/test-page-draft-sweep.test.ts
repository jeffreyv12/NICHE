import { describe, expect, it, vi } from "vitest";
import { runTestPageDraftSweep } from "../test-page-draft-sweep.js";

// Mock the per-niche job — we're testing the sweep's selection + state-advance
// orchestration, not the draft pipeline itself (covered in test-page-draft.test).
vi.mock("../test-page-draft.js", () => ({
  runTestPageDraftJob: vi.fn(),
}));

import { runTestPageDraftJob } from "../test-page-draft.js";
const mockedJob = vi.mocked(runTestPageDraftJob);

interface FakeNiche {
  id: string;
  tenantId: string | null;
  topicSlug: string;
}

function makeFakeDb(opts: {
  ready: FakeNiche[];
  mainTenantId?: string;
}) {
  const updates: Array<{ table: string; values: Record<string, unknown>; where: string }> = [];
  // The sweep issues both subquery selects (terminated by .as()) and main
  // selects (terminated by .limit() or await). We defer row resolution to
  // .limit() so subqueries don't consume the queue.
  const limitQueue: unknown[][] = [
    opts.ready,
    opts.mainTenantId ? [{ id: opts.mainTenantId }] : [],
  ];

  function makeChain() {
    const chain: Record<string, unknown> = {};
    const pt = () => chain;
    chain.from = pt;
    chain.leftJoin = pt;
    chain.where = pt;
    chain.as = pt;
    chain.limit = () => Promise.resolve(limitQueue.shift() ?? []);
    return chain;
  }

  return {
    updates,
    db: {
      select: () => makeChain(),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: (clause: unknown) => {
            updates.push({ table: "niches", values, where: String(clause) });
            return Promise.resolve();
          },
        }),
      }),
    } as unknown as Parameters<typeof runTestPageDraftSweep>[0]["db"],
  };
}

describe("runTestPageDraftSweep", () => {
  it("advances niches to validating when drafts succeed", async () => {
    const ready: FakeNiche[] = [
      { id: "n1", tenantId: "tenant-1", topicSlug: "koffiemolens" },
      { id: "n2", tenantId: "tenant-1", topicSlug: "espressomachines" },
    ];
    const { db, updates } = makeFakeDb({ ready });

    mockedJob.mockResolvedValue({
      nicheId: "x",
      tenantId: "tenant-1",
      drafted: [
        {
          pageId: "p",
          pageSlug: "s",
          kind: "comparison",
          cohort: "compare",
          agentRunId: "r",
          costEur: 0.02,
          disclosuresAmended: false,
          affiliateLinkIds: [],
        },
      ],
      totalCostEur: 0.02,
      failures: [],
    });

    const result = await runTestPageDraftSweep({
      db,
      runtime: {} as Parameters<typeof runTestPageDraftSweep>[0]["runtime"],
    });

    expect(result.considered).toBe(2);
    expect(result.drafted).toBe(2);
    expect(result.advanced).toBe(2);
    expect(result.totalCostEur).toBeCloseTo(0.04, 5);

    // Each niche got exactly one update — to state=validating.
    const stateUpdates = updates.filter((u) => u.values.state === "validating");
    expect(stateUpdates).toHaveLength(2);
  });

  it("assigns main_authority tenant when niche.tenantId is null", async () => {
    const ready: FakeNiche[] = [{ id: "n1", tenantId: null, topicSlug: "koffiemolens" }];
    const { db, updates } = makeFakeDb({ ready, mainTenantId: "main-tenant" });

    mockedJob.mockResolvedValue({
      nicheId: "n1",
      tenantId: "main-tenant",
      drafted: [
        {
          pageId: "p",
          pageSlug: "s",
          kind: "comparison",
          cohort: "compare",
          agentRunId: "r",
          costEur: 0.01,
          disclosuresAmended: false,
          affiliateLinkIds: [],
        },
      ],
      totalCostEur: 0.01,
      failures: [],
    });

    await runTestPageDraftSweep({
      db,
      runtime: {} as Parameters<typeof runTestPageDraftSweep>[0]["runtime"],
    });

    // First update sets the tenant; second flips state to validating.
    expect(updates[0]?.values.tenantId).toBe("main-tenant");
    expect(updates[1]?.values.state).toBe("validating");
  });

  it("does NOT advance state when the job had failures", async () => {
    const ready: FakeNiche[] = [{ id: "n1", tenantId: "t", topicSlug: "x" }];
    const { db, updates } = makeFakeDb({ ready });

    mockedJob.mockResolvedValue({
      nicheId: "n1",
      tenantId: "t",
      drafted: [
        {
          pageId: "p",
          pageSlug: "s",
          kind: "comparison",
          cohort: "compare",
          agentRunId: "r",
          costEur: 0.01,
          disclosuresAmended: false,
          affiliateLinkIds: [],
        },
      ],
      totalCostEur: 0.01,
      failures: [{ pageSlug: "koopgids", error: "agent timeout" }],
    });

    const result = await runTestPageDraftSweep({
      db,
      runtime: {} as Parameters<typeof runTestPageDraftSweep>[0]["runtime"],
    });

    expect(result.advanced).toBe(0);
    expect(updates.some((u) => u.values.state === "validating")).toBe(false);
  });

  it("captures per-niche failures without aborting the sweep", async () => {
    const ready: FakeNiche[] = [
      { id: "n1", tenantId: "t", topicSlug: "a" },
      { id: "n2", tenantId: "t", topicSlug: "b" },
    ];
    const { db } = makeFakeDb({ ready });

    mockedJob.mockRejectedValueOnce(new Error("niche not found")).mockResolvedValueOnce({
      nicheId: "n2",
      tenantId: "t",
      drafted: [
        {
          pageId: "p",
          pageSlug: "s",
          kind: "comparison",
          cohort: "compare",
          agentRunId: "r",
          costEur: 0.01,
          disclosuresAmended: false,
          affiliateLinkIds: [],
        },
      ],
      totalCostEur: 0.01,
      failures: [],
    });

    const result = await runTestPageDraftSweep({
      db,
      runtime: {} as Parameters<typeof runTestPageDraftSweep>[0]["runtime"],
    });

    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]?.ok).toBe(false);
    expect(result.jobs[1]?.ok).toBe(true);
    expect(result.advanced).toBe(1);
  });
});
