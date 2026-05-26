import { describe, expect, it } from "vitest";
import { type PromotionInputs, evaluatePromotionGate } from "../src/promotionGate";

const PASSING: PromotionInputs = {
  monthlyRevenueEur: [178, 201, 188],
  monthlyOrganicClicks: [1820, 1750, 1900],
  nonBrandLongTailShare: 0.38,
  affiliateSourcesShare: { bol: 0.54, awin: 0.31, daisycon: 0.15 },
  singleProductShareMax: 0.42,
  brandedQueriesPerMonth: 28,
  engagement: {
    medianTimeOnPageSeconds: 112,
    medianScrollDepth: 0.68,
    medianBotScore: 12,
    bounceRate: 0.52,
  },
  algorithmEventsLast30Days: [],
  gscManualActions: [],
};

describe("evaluatePromotionGate — happy path", () => {
  it("canonical passing inputs → ready", () => {
    const r = evaluatePromotionGate(PASSING);
    expect(r.result).toBe("ready");
    expect(r.failingReasons).toEqual([]);
    expect(r.earliestRetryDate).toBeNull();
    for (const key of Object.keys(r.criteria)) {
      expect(r.criteria[key]?.passed, `criterion ${key} should pass`).toBe(true);
    }
  });
});

describe("evaluatePromotionGate — each criterion can fail independently", () => {
  it("C1 revenue below floor → not_ready", () => {
    const r = evaluatePromotionGate({ ...PASSING, monthlyRevenueEur: [50, 200, 200] });
    expect(r.result).toBe("not_ready");
    expect(r.failingReasons).toContain("revenue");
  });

  it("C1 revenue avg too low → not_ready", () => {
    const r = evaluatePromotionGate({ ...PASSING, monthlyRevenueEur: [100, 100, 100] });
    expect(r.failingReasons).toContain("revenue");
  });

  it("C2 clicks too low → not_ready", () => {
    const r = evaluatePromotionGate({
      ...PASSING,
      monthlyOrganicClicks: [500, 500, 500],
    });
    expect(r.failingReasons).toContain("organic_clicks");
  });

  it("C2 non-brand share too low → not_ready", () => {
    const r = evaluatePromotionGate({ ...PASSING, nonBrandLongTailShare: 0.1 });
    expect(r.failingReasons).toContain("organic_clicks");
  });

  it("C3 single source dominance → blocked_by_single_source", () => {
    const r = evaluatePromotionGate({
      ...PASSING,
      affiliateSourcesShare: { bol: 0.9, awin: 0.1 },
    });
    expect(r.result).toBe("blocked_by_single_source");
    expect(r.failingReasons).toContain("diversity");
  });

  it("C3 single product dominance → not_ready (diversity)", () => {
    const r = evaluatePromotionGate({ ...PASSING, singleProductShareMax: 0.85 });
    expect(r.failingReasons).toContain("diversity");
  });

  it("C4 no branded queries → not_ready", () => {
    const r = evaluatePromotionGate({ ...PASSING, brandedQueriesPerMonth: 5 });
    expect(r.failingReasons).toContain("branded_search");
  });

  it("C5 engagement weak → not_ready", () => {
    const r = evaluatePromotionGate({
      ...PASSING,
      engagement: { ...PASSING.engagement, medianTimeOnPageSeconds: 30 },
    });
    expect(r.failingReasons).toContain("engagement");
  });

  it("C5 bounce rate too high → not_ready", () => {
    const r = evaluatePromotionGate({
      ...PASSING,
      engagement: { ...PASSING.engagement, bounceRate: 0.85 },
    });
    expect(r.failingReasons).toContain("engagement");
  });

  it("C6 algorithm event ongoing → blocked_by_update_window", () => {
    const r = evaluatePromotionGate({
      ...PASSING,
      algorithmEventsLast30Days: [{ kind: "core_update", startedAt: new Date(), endedAt: null }],
    });
    expect(r.result).toBe("blocked_by_update_window");
    expect(r.earliestRetryDate).not.toBeNull();
  });

  it("C7 GSC manual action open → not_ready", () => {
    const r = evaluatePromotionGate({
      ...PASSING,
      gscManualActions: [{ kind: "unnatural_links", openedAt: new Date() }],
    });
    expect(r.failingReasons).toContain("no_manual_action");
  });
});

describe("evaluatePromotionGate — decision precedence", () => {
  it("algorithm cooldown overrides other failures", () => {
    const r = evaluatePromotionGate({
      ...PASSING,
      monthlyRevenueEur: [0, 0, 0],
      algorithmEventsLast30Days: [{ kind: "core_update", startedAt: new Date(), endedAt: null }],
    });
    expect(r.result).toBe("blocked_by_update_window");
  });
});
