import { orchestratorAgent } from "@nichefinder/agent-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HeroEditRow,
  NicheSnapshotRow,
  PortfolioSnapshotAdapter,
  RunOrchestratorJobOptions,
} from "../orchestrator.js";
import {
  buildNicheSnapshots,
  previousCalendarMonthKey,
  runOrchestratorJob,
} from "../orchestrator.js";

// ---------------------------------------------------------------------------
// Mock the agent runner so no real Anthropic or DB calls are made.
// The orchestrator job itself only wires data; the agent SDK does the heavy
// lifting which we stub out.
// ---------------------------------------------------------------------------

vi.mock("@nichefinder/agent-sdk", async () => {
  const actual =
    await vi.importActual<typeof import("@nichefinder/agent-sdk")>("@nichefinder/agent-sdk");
  return {
    ...actual,
    orchestratorAgent: {
      ...actual.orchestratorAgent,
      runOrchestratorAgent: vi.fn(),
    },
  };
});

const mockedRun = vi.mocked(orchestratorAgent.runOrchestratorAgent);

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeInput(
  overrides: Partial<orchestratorAgent.OrchestratorInput> = {},
): orchestratorAgent.OrchestratorInput {
  return orchestratorAgent.OrchestratorInputSchema.parse({
    week_of: "2026-06-02",
    niches: [
      { topic: "Staandbureau", topic_slug: "staandbureau", state: "validating", days_in_state: 14 },
    ],
    spend: {
      claude_mtd_eur: 80,
      claude_budget_eur: 200,
      cost_ledger_mtd: [{ category: "vercel", mtd_eur: 20 }],
      paid_traffic_mtd_eur: 0,
    },
    ...overrides,
  });
}

function makeOutput(
  overrides: Partial<orchestratorAgent.OrchestratorOutput> = {},
): orchestratorAgent.OrchestratorOutput {
  return orchestratorAgent.OrchestratorOutputSchema.parse({
    week_of: "2026-06-02",
    headline: "Portfolio stable, 1 niche validating.",
    portfolio_state: {
      candidate_count: 1,
      validating: 1,
      building: 0,
      mature: 0,
      promoted: 0,
      killed_lifetime: 0,
      kill_rate_12m: 0,
      promotion_rate_12m: 0,
    },
    spend: {
      claude_mtd_eur: 80,
      claude_budget_eur: 200,
      claude_pct_used: 0.4,
      infra_mtd_eur: 20,
      paid_traffic_mtd_eur: 0,
    },
    operator_action_items: ["Review staandbureau validation results"],
    ...overrides,
  });
}

function mockAgentResponse(
  output: orchestratorAgent.OrchestratorOutput,
  synthetic: Array<{ severity: orchestratorAgent.AlertSeverity; message: string }> = [],
) {
  mockedRun.mockResolvedValueOnce({
    output,
    syntheticAlerts: synthetic,
    agentRunId: "run-test-abc",
    costEur: 0.05,
  });
}

function makeSnapshot(input: orchestratorAgent.OrchestratorInput): PortfolioSnapshotAdapter {
  return { buildInput: async () => input };
}

function makeMockDb() {
  const chain = { set: vi.fn(), where: vi.fn().mockResolvedValue(undefined) };
  chain.set.mockReturnValue(chain);
  return { update: vi.fn().mockReturnValue(chain) };
}

function makeOpts(overrides: Partial<RunOrchestratorJobOptions> = {}): RunOrchestratorJobOptions {
  return {
    db: makeMockDb() as never,
    runtime: {} as never,
    snapshot: makeSnapshot(makeInput()),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runOrchestratorJob", () => {
  it("returns headline and counts from the agent output", async () => {
    const output = makeOutput();
    mockAgentResponse(output);

    const result = await runOrchestratorJob(makeOpts());

    expect(result.headline).toBe(output.headline);
    expect(result.alertCount).toBe(0);
    expect(result.syntheticAlertCount).toBe(0);
    expect(result.actionItemCount).toBe(1);
    expect(result.agentRunId).toBe("run-test-abc");
    expect(result.costEur).toBe(0.05);
  });

  it("reports synthetic budget alerts from the agent", async () => {
    const output = makeOutput({ alerts: [] });
    const synthetic = [
      { severity: "warning" as orchestratorAgent.AlertSeverity, message: "Budget at 85%." },
    ];
    mockAgentResponse(output, synthetic);

    const result = await runOrchestratorJob(makeOpts());

    expect(result.syntheticAlertCount).toBe(1);
    // alertCount includes the synthetic alerts merged into output.alerts by the agent runner
    expect(result.alertCount).toBe(0); // output.alerts is still [] — the merge happens inside runOrchestratorAgent
  });

  it("skips webhook when no URL provided", async () => {
    mockAgentResponse(makeOutput());

    const result = await runOrchestratorJob(makeOpts());
    expect(result.webhookPosted).toBe(false);
  });

  it("reports webhook failure without throwing", async () => {
    mockAgentResponse(makeOutput());

    const result = await runOrchestratorJob(
      makeOpts({ slackWebhookUrl: "http://localhost:0/no-server" }),
    );
    expect(result.webhookPosted).toBe(false);
  });

  it("sets webhookPosted=true and POSTs correct body on success", async () => {
    const output = makeOutput({
      headline: "Portfolio stabiel — geen actie vereist.",
      operator_action_items: ["Controleer niche X", "Review content Y"],
    });
    mockAgentResponse(output);

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const result = await runOrchestratorJob(
      makeOpts({ slackWebhookUrl: "https://hooks.slack.com/T123/B456/abc" }),
    );

    expect(result.webhookPosted).toBe(true);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/T123/B456/abc");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text).toContain("NicheFinder weekly review");
    expect(body.text).toContain("Portfolio stabiel");
    expect(body.text).toContain("Controleer niche X");

    vi.unstubAllGlobals();
  });

  it("posts to Discord URL when discord URL is supplied (not slack)", async () => {
    mockAgentResponse(makeOutput());

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const result = await runOrchestratorJob(
      makeOpts({ discordWebhookUrl: "https://discord.com/api/webhooks/123/abc" }),
    );

    expect(result.webhookPosted).toBe(true);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://discord.com/api/webhooks/123/abc");

    vi.unstubAllGlobals();
  });

  it("forwards the snapshot input to the agent including week_of", async () => {
    const output = makeOutput();
    mockAgentResponse(output);

    const asOf = "2026-06-09T06:00:00.000Z";
    await runOrchestratorJob(makeOpts({ asOf }));

    const callArg = mockedRun.mock.calls[0]?.[1];
    expect(callArg?.week_of).toBe("2026-06-09");
  });

  it("does not call onBudgetAlert when spend is below 80%", async () => {
    const onBudgetAlert = vi.fn().mockResolvedValue(undefined);
    mockAgentResponse(makeOutput());

    const result = await runOrchestratorJob(
      makeOpts({
        snapshot: makeSnapshot(
          makeInput({
            spend: {
              claude_mtd_eur: 159,
              claude_budget_eur: 200,
              cost_ledger_mtd: [],
              paid_traffic_mtd_eur: 0,
            },
          }),
        ),
        claudeBudgetEur: 200,
        onBudgetAlert,
      }),
    );

    expect(result.budgetAlertSent).toBe(false);
    expect(onBudgetAlert).not.toHaveBeenCalled();
  });

  it("calls onBudgetAlert and sets budgetAlertSent when spend ≥ 80%", async () => {
    const onBudgetAlert = vi.fn().mockResolvedValue(undefined);
    mockAgentResponse(makeOutput());

    const result = await runOrchestratorJob(
      makeOpts({
        snapshot: makeSnapshot(
          makeInput({
            spend: {
              claude_mtd_eur: 160,
              claude_budget_eur: 200,
              cost_ledger_mtd: [],
              paid_traffic_mtd_eur: 0,
            },
          }),
        ),
        claudeBudgetEur: 200,
        onBudgetAlert,
      }),
    );

    expect(result.budgetAlertSent).toBe(true);
    expect(onBudgetAlert).toHaveBeenCalledWith(160, 200);
  });

  it("parses kills_recommended with optional redirect_to_niche_slug (Phase 6.1.5)", () => {
    const withRedirect = orchestratorAgent.OrchestratorOutputSchema.parse({
      week_of: "2026-06-02",
      headline: "Kill kandidaat gevonden.",
      portfolio_state: {
        candidate_count: 2,
        validating: 0,
        building: 1,
        mature: 1,
        promoted: 0,
        killed_lifetime: 1,
        kill_rate_12m: 0.5,
        promotion_rate_12m: 0,
      },
      spend: {
        claude_mtd_eur: 50,
        claude_budget_eur: 200,
        claude_pct_used: 0.25,
        infra_mtd_eur: 10,
        paid_traffic_mtd_eur: 0,
      },
      kills_recommended: [
        {
          niche_slug: "goedkope-laptops",
          reason: "low_revenue_month_6",
          evidence: { revenue_eur: 5 },
          redirect_to_niche_slug: "beste-laptops",
        },
      ],
      operator_action_items: [],
    });

    expect(withRedirect.kills_recommended[0]?.redirect_to_niche_slug).toBe("beste-laptops");

    // Omitting the field is equally valid.
    const withoutRedirect = orchestratorAgent.OrchestratorOutputSchema.parse({
      ...withRedirect,
      kills_recommended: [
        { niche_slug: "goedkope-laptops", reason: "low_revenue_month_6", evidence: {} },
      ],
    });
    expect(withoutRedirect.kills_recommended[0]?.redirect_to_niche_slug).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Pure snapshot helpers (per-niche organic clicks + revenue, Phase 6.1)
// ---------------------------------------------------------------------------

describe("previousCalendarMonthKey", () => {
  it("returns the first day of the previous calendar month (UTC)", () => {
    expect(previousCalendarMonthKey(new Date("2026-06-09T06:00:00.000Z"))).toBe("2026-05-01");
  });

  it("rolls back across the year boundary", () => {
    expect(previousCalendarMonthKey(new Date("2026-01-15T12:00:00.000Z"))).toBe("2025-12-01");
  });
});

describe("buildNicheSnapshots", () => {
  const asOf = new Date("2026-06-15T00:00:00.000Z");

  function nicheRow(over: Partial<NicheSnapshotRow> = {}): NicheSnapshotRow {
    return {
      id: "n1",
      topic: "Topic",
      topicSlug: "topic",
      tenantId: "t1",
      state: "validating",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      validationStartedAt: null,
      buildingStartedAt: null,
      matureAt: null,
      promotedAt: null,
      killedAt: null,
      ...over,
    };
  }

  it("credits each niche its OWN organic clicks — no tenant-wide bleed", () => {
    // Two niches under the SAME tenant must get DIFFERENT figures (the old
    // tenant-grain query gave both the site-wide total — CLAUDE.md #9).
    const niches = [
      nicheRow({ id: "n1", topicSlug: "a", tenantId: "t1", state: "building" }),
      nicheRow({ id: "n2", topicSlug: "b", tenantId: "t1", state: "building" }),
    ];
    const metrics = new Map([
      ["n1", { organicClicks: 1200, revenueEur: 80 }],
      ["n2", { organicClicks: 9, revenueEur: 0 }],
    ]);
    const out = buildNicheSnapshots(niches, metrics, [], asOf);
    expect(out.find((n) => n.topic_slug === "a")?.organic_clicks_last_month).toBe(1200);
    expect(out.find((n) => n.topic_slug === "b")?.organic_clicks_last_month).toBe(9);
  });

  it("surfaces revenue_last_month_eur from the same monthly close (incl. genuine €0)", () => {
    const niches = [nicheRow({ id: "n1", topicSlug: "a", state: "mature" })];
    const metrics = new Map([["n1", { organicClicks: 50, revenueEur: 0 }]]);
    const out = buildNicheSnapshots(niches, metrics, [], asOf);
    expect(out[0]?.revenue_last_month_eur).toBe(0);
  });

  it("omits organic_clicks when the close is NULL (preserve-on-no-data → unknown)", () => {
    const niches = [nicheRow({ id: "n1", topicSlug: "a" })];
    const metrics = new Map([["n1", { organicClicks: null, revenueEur: 12 }]]);
    const out = buildNicheSnapshots(niches, metrics, [], asOf);
    expect(out[0]?.organic_clicks_last_month).toBeUndefined();
    expect(out[0]?.revenue_last_month_eur).toBe(12);
  });

  it("omits both metrics when the niche has no monthly close at all", () => {
    const niches = [nicheRow({ id: "n1", topicSlug: "a" })];
    const out = buildNicheSnapshots(niches, new Map(), [], asOf);
    expect(out[0]?.organic_clicks_last_month).toBeUndefined();
    expect(out[0]?.revenue_last_month_eur).toBeUndefined();
  });

  it("computes days_in_state from the state-entry timestamp", () => {
    const niches = [
      nicheRow({
        id: "n1",
        topicSlug: "a",
        state: "validating",
        validationStartedAt: new Date("2026-06-05T00:00:00.000Z"),
      }),
    ];
    const out = buildNicheSnapshots(niches, new Map(), [], asOf);
    expect(out[0]?.days_in_state).toBe(10); // Jun 5 → Jun 15
  });

  it("reports last_hero_edit_days_ago from the matching page", () => {
    const niches = [nicheRow({ id: "n1", topicSlug: "a", state: "building" })];
    const heroEdits: HeroEditRow[] = [
      { nicheId: "n1", lastEditedAt: new Date("2026-06-10T00:00:00.000Z") },
    ];
    const out = buildNicheSnapshots(niches, new Map(), heroEdits, asOf);
    expect(out[0]?.last_hero_edit_days_ago).toBe(5); // Jun 10 → Jun 15
  });
});
