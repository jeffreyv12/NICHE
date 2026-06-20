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

describe("evaluateKillCriteria — maturity boundary (180 days)", () => {
  it("treats a niche at exactly 180 days as mature (>= check)", () => {
    const flags = evaluateKillCriteria(
      input({ nicheAgeDays: 180, trailing30dRevenueEur: 0, trailing30dOrganicClicks: 0 }),
    );
    expect(flags.map((f) => f.reason)).toContain("low_revenue_month_6");
    expect(flags.map((f) => f.reason)).toContain("low_traffic_month_6");
  });

  it("does not flag revenue/traffic at 179 days (not yet mature)", () => {
    const flags = evaluateKillCriteria(
      input({ nicheAgeDays: 179, trailing30dRevenueEur: 0, trailing30dOrganicClicks: 0 }),
    );
    expect(flags).toHaveLength(0);
  });

  it("does not flag revenue when exactly at the default threshold (10 EUR)", () => {
    const flags = evaluateKillCriteria(input({ nicheAgeDays: 200, trailing30dRevenueEur: 10 }));
    expect(flags.map((f) => f.reason)).not.toContain("low_revenue_month_6");
  });

  it("flags revenue when 1 cent below the default threshold (9.99 EUR)", () => {
    const flags = evaluateKillCriteria(input({ nicheAgeDays: 200, trailing30dRevenueEur: 9.99 }));
    expect(flags.map((f) => f.reason)).toContain("low_revenue_month_6");
  });

  it("does not flag traffic when exactly at the default threshold (100 clicks)", () => {
    const flags = evaluateKillCriteria(input({ nicheAgeDays: 200, trailing30dOrganicClicks: 100 }));
    expect(flags.map((f) => f.reason)).not.toContain("low_traffic_month_6");
  });

  it("flags traffic when one click below the default threshold (99 clicks)", () => {
    const flags = evaluateKillCriteria(input({ nicheAgeDays: 200, trailing30dOrganicClicks: 99 }));
    expect(flags.map((f) => f.reason)).toContain("low_traffic_month_6");
  });
});

describe("evaluateKillCriteria — flag detail content", () => {
  it("kill_list_match flag carries Dutch detail text", () => {
    const flags = evaluateKillCriteria(input({ killListHardBlock: true }));
    expect(flags[0]?.detail).toMatch(/kill-list/i);
  });

  it("google_penalty flag references manual action (handmatige actie)", () => {
    const flags = evaluateKillCriteria(input({ hasGoogleManualAction: true }));
    const flag = flags.find((f) => f.reason === "google_penalty");
    expect(flag?.detail).toContain("handmatige actie");
  });

  it("low_revenue_month_6 detail includes the actual revenue amount", () => {
    const flags = evaluateKillCriteria(input({ nicheAgeDays: 200, trailing30dRevenueEur: 3.5 }));
    const flag = flags.find((f) => f.reason === "low_revenue_month_6");
    expect(flag?.detail).toContain("3.50");
  });

  it("low_traffic_month_6 detail includes the actual click count", () => {
    const flags = evaluateKillCriteria(input({ nicheAgeDays: 200, trailing30dOrganicClicks: 42 }));
    const flag = flags.find((f) => f.reason === "low_traffic_month_6");
    expect(flag?.detail).toContain("42");
  });

  it("all four flags can be raised simultaneously", () => {
    const flags = evaluateKillCriteria(
      input({
        nicheAgeDays: 200,
        killListHardBlock: true,
        hasGoogleManualAction: true,
        trailing30dRevenueEur: 0,
        trailing30dOrganicClicks: 0,
      }),
    );
    expect(flags.map((f) => f.reason).sort()).toEqual([
      "google_penalty",
      "kill_list_match",
      "low_revenue_month_6",
      "low_traffic_month_6",
    ]);
  });
});
