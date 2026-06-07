import { describe, expect, it } from "vitest";
import { type KillCriteriaInput, evaluateKillCriteria } from "../src/killCriteria";

function input(over: Partial<KillCriteriaInput> = {}): KillCriteriaInput {
  return {
    nicheAgeDays: 200,
    trailing30dRevenueEur: 100,
    trailing30dOrganicClicks: 500,
    killListHardBlock: false,
    hasGoogleManualAction: false,
    ...over,
  };
}

describe("evaluateKillCriteria", () => {
  it("returns no flags for a healthy mature niche", () => {
    expect(evaluateKillCriteria(input())).toEqual([]);
  });

  it("flags a kill-list match regardless of age (highest priority)", () => {
    const flags = evaluateKillCriteria(input({ nicheAgeDays: 5, killListHardBlock: true }));
    expect(flags.map((f) => f.reason)).toContain("kill_list_match");
  });

  it("flags a google manual action", () => {
    const flags = evaluateKillCriteria(input({ hasGoogleManualAction: true }));
    expect(flags.map((f) => f.reason)).toContain("google_penalty");
  });

  it("flags low revenue only once the niche is mature (≥180d)", () => {
    expect(evaluateKillCriteria(input({ nicheAgeDays: 100, trailing30dRevenueEur: 0 }))).toEqual(
      [],
    );
    const flags = evaluateKillCriteria(input({ nicheAgeDays: 200, trailing30dRevenueEur: 3 }));
    expect(flags.map((f) => f.reason)).toContain("low_revenue_month_6");
  });

  it("flags low traffic only once mature", () => {
    expect(evaluateKillCriteria(input({ nicheAgeDays: 100, trailing30dOrganicClicks: 0 }))).toEqual(
      [],
    );
    const flags = evaluateKillCriteria(input({ nicheAgeDays: 200, trailing30dOrganicClicks: 20 }));
    expect(flags.map((f) => f.reason)).toContain("low_traffic_month_6");
  });

  it("can return several flags at once", () => {
    const flags = evaluateKillCriteria(
      input({ nicheAgeDays: 200, trailing30dRevenueEur: 1, trailing30dOrganicClicks: 5 }),
    );
    expect(flags.map((f) => f.reason).sort()).toEqual([
      "low_revenue_month_6",
      "low_traffic_month_6",
    ]);
  });

  it("respects custom thresholds", () => {
    const flags = evaluateKillCriteria(input({ nicheAgeDays: 200, trailing30dRevenueEur: 50 }), {
      matureAgeDays: 180,
      minMonthlyRevenueEur: 80,
      minMonthlyOrganicClicks: 100,
    });
    expect(flags.map((f) => f.reason)).toContain("low_revenue_month_6");
  });
});
