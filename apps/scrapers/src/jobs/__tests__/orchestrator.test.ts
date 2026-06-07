import { orchestratorAgent } from "@nichefinder/agent-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortfolioSnapshotAdapter, RunOrchestratorJobOptions } from "../orchestrator.js";
import { runOrchestratorJob } from "../orchestrator.js";

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

function makeOpts(overrides: Partial<RunOrchestratorJobOptions> = {}): RunOrchestratorJobOptions {
  return {
    db: {} as never,
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

  it("forwards the snapshot input to the agent including week_of", async () => {
    const output = makeOutput();
    mockAgentResponse(output);

    const asOf = "2026-06-09T06:00:00.000Z";
    await runOrchestratorJob(makeOpts({ asOf }));

    const callArg = mockedRun.mock.calls[0]?.[1];
    expect(callArg?.week_of).toBe("2026-06-09");
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
