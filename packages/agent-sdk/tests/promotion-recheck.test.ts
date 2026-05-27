import { describe, expect, it } from "vitest";
import {
  type PromotionInput,
  PromotionInputSchema,
  PromotionOutputSchema,
  mechanicalRecheck,
} from "../src/agents/promotion";

function input(overrides: Partial<PromotionInput> = {}): PromotionInput {
  return PromotionInputSchema.parse({
    niche: {
      topic: "specialty espresso",
      topic_slug: "specialty-espresso",
      current_state: "mature",
      days_in_state: 95,
    },
    metrics_90d: {
      approved_revenue_per_month_eur: [160, 175, 190],
      organic_clicks_per_month: [1600, 1700, 1800],
      non_brand_long_tail_share: 0.45,
      affiliate_sources_share: { bol: 0.55, awin: 0.3, daisycon: 0.15 },
      single_product_share_max: 0.35,
      branded_queries_per_month: 30,
      engagement: {
        median_time_on_page_seconds: 110,
        median_scroll_depth: 0.65,
        median_bot_score: 22,
        bounce_rate: 0.55,
      },
    },
    algorithm_events_30d: [],
    gsc_manual_actions_30d: [],
    candidate_domains: [
      {
        hostname: "specialty-espresso.nl",
        registrar: "transip",
        cost_eur_year: 10,
        available: true,
        tmview_clear: true,
      },
    ],
    ...overrides,
  });
}

describe("promotion mechanicalRecheck", () => {
  it("returns null when revenue and algo window are clean", () => {
    expect(mechanicalRecheck(input()).forcedResult).toBeNull();
  });

  it("forces not_ready when any month <€75 revenue floor", () => {
    const r = mechanicalRecheck(
      input({
        metrics_90d: {
          ...input().metrics_90d,
          approved_revenue_per_month_eur: [160, 60, 190],
        },
      }),
    );
    expect(r.forcedResult).toBe("not_ready");
    expect(r.reasons[0]).toContain("Revenue floor");
  });

  it("forces not_ready when 3-month average <€150", () => {
    const r = mechanicalRecheck(
      input({
        metrics_90d: {
          ...input().metrics_90d,
          approved_revenue_per_month_eur: [80, 90, 100],
        },
      }),
    );
    expect(r.forcedResult).toBe("not_ready");
    // Revenue floor (<€75) ok, but avg <150 alone triggers.
    expect(r.reasons.some((s) => s.includes("avg"))).toBe(true);
  });

  it("forces blocked_by_update_window when an algo event is present", () => {
    const r = mechanicalRecheck(
      input({
        algorithm_events_30d: [
          { kind: "core_update", started_at: "2026-05-10T00:00:00Z", ended_at: null },
        ],
      }),
    );
    expect(r.forcedResult).toBe("blocked_by_update_window");
  });

  it("revenue floor takes precedence over algorithm window when both fire", () => {
    const r = mechanicalRecheck(
      input({
        metrics_90d: {
          ...input().metrics_90d,
          approved_revenue_per_month_eur: [50, 60, 70],
        },
        algorithm_events_30d: [
          { kind: "core_update", started_at: "2026-05-10T00:00:00Z", ended_at: null },
        ],
      }),
    );
    expect(r.forcedResult).toBe("not_ready");
  });
});

describe("PromotionOutputSchema", () => {
  const sample = {
    result: "ready",
    criteria: {
      revenue: { passed: true, value: 175, threshold: 150 },
      organic_clicks: { passed: true, value: 1700, threshold: 1500 },
      diversity: { passed: true, value: 0.55, threshold: 0.65 },
      branded_search: { passed: true, value: 30, threshold: 20 },
      engagement: { passed: true, value: 110, threshold: 90 },
      algorithm_quiet: { passed: true, value: 0, threshold: 0 },
      no_manual_action: { passed: true, value: 0, threshold: 0 },
    },
    recommendation: "Promote to specialty-espresso.nl",
    proposed_domains: [
      {
        hostname: "specialty-espresso.nl",
        registrar: "transip",
        cost_eur_year: 10,
        available: true,
        tmview_clear: true,
      },
    ],
    risks: ["seasonality"],
    earliest_retry_date: null,
  };

  it("accepts a well-formed ready output", () => {
    expect(() => PromotionOutputSchema.parse(sample)).not.toThrow();
  });

  it("rejects unknown registrar", () => {
    expect(() =>
      PromotionOutputSchema.parse({
        ...sample,
        proposed_domains: [{ ...sample.proposed_domains[0], registrar: "godaddy" }],
      }),
    ).toThrow();
  });

  it("rejects unknown result", () => {
    expect(() => PromotionOutputSchema.parse({ ...sample, result: "meh" })).toThrow();
  });
});
