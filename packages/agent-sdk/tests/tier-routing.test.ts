import { describe, expect, it } from "vitest";
import {
  ALLOWED_MODELS_PER_AGENT,
  TierRoutingError,
  allowedModelsForAgent,
  assertAgentModel,
} from "../src/guards/tier-routing";

describe("tier routing", () => {
  it("discovery is Haiku-only", () => {
    expect(allowedModelsForAgent("discovery")).toEqual(["claude-haiku-4-5-20251001"]);
  });

  it("promotion is Opus-only", () => {
    expect(allowedModelsForAgent("promotion")).toEqual(["claude-opus-4-7"]);
  });

  it("orchestrator is Opus-only", () => {
    expect(allowedModelsForAgent("orchestrator")).toEqual(["claude-opus-4-7"]);
  });

  it("scoring allows Haiku + Sonnet escalation", () => {
    expect(allowedModelsForAgent("scoring")).toEqual([
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-6",
    ]);
  });

  it("content allows Sonnet + Opus polish", () => {
    expect(allowedModelsForAgent("content")).toEqual(["claude-sonnet-4-6", "claude-opus-4-7"]);
  });

  it("assertAgentModel passes for allowed combos", () => {
    expect(() => assertAgentModel("discovery", "claude-haiku-4-5-20251001")).not.toThrow();
    expect(() => assertAgentModel("promotion", "claude-opus-4-7")).not.toThrow();
  });

  it("assertAgentModel throws TierRoutingError for forbidden combos", () => {
    // The cardinal sin: discovery trying to call Opus.
    expect(() => assertAgentModel("discovery", "claude-opus-4-7")).toThrow(TierRoutingError);
    // Scoring trying to use Opus is also forbidden.
    expect(() => assertAgentModel("scoring", "claude-opus-4-7")).toThrow(TierRoutingError);
    // Promotion can't use Haiku (Opus only).
    expect(() => assertAgentModel("promotion", "claude-haiku-4-5-20251001")).toThrow(
      TierRoutingError,
    );
  });

  it("error message names the offending agent + model", () => {
    try {
      assertAgentModel("discovery", "claude-opus-4-7");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TierRoutingError);
      expect((e as Error).message).toContain("discovery");
      expect((e as Error).message).toContain("claude-opus-4-7");
    }
  });

  it("validation is Sonnet-only", () => {
    expect(allowedModelsForAgent("validation")).toEqual(["claude-sonnet-4-6"]);
  });

  it("assertAgentModel passes for validation + sonnet", () => {
    expect(() => assertAgentModel("validation", "claude-sonnet-4-6")).not.toThrow();
  });

  it("assertAgentModel throws TierRoutingError when validation tries Haiku", () => {
    expect(() => assertAgentModel("validation", "claude-haiku-4-5-20251001")).toThrow(
      TierRoutingError,
    );
  });

  it("assertAgentModel throws TierRoutingError when validation tries Opus", () => {
    expect(() => assertAgentModel("validation", "claude-opus-4-7")).toThrow(TierRoutingError);
  });

  it("error message names allowed models in the allowed list", () => {
    try {
      assertAgentModel("scoring", "claude-opus-4-7");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("Allowed:");
      expect((e as Error).message).toContain("claude-haiku-4-5-20251001");
      expect((e as Error).message).toContain("claude-sonnet-4-6");
    }
  });

  it("ALLOWED_MODELS_PER_AGENT covers all six agents", () => {
    expect(Object.keys(ALLOWED_MODELS_PER_AGENT).sort()).toEqual([
      "content",
      "discovery",
      "orchestrator",
      "promotion",
      "scoring",
      "validation",
    ]);
  });
});
