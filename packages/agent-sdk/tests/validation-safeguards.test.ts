import { describe, expect, it } from "vitest";
import {
  type ValidationInput,
  ValidationInputSchema,
  ValidationOutputSchema,
  evaluateMechanicalSafeguards,
} from "../src/agents/validation";

function input(overrides: Partial<ValidationInput> = {}): ValidationInput {
  return ValidationInputSchema.parse({
    niche: {
      topic: "Aeropress draagbaar",
      topic_slug: "aeropress-draagbaar",
      days_in_validation: 14,
    },
    test_pages: [
      { url: "/test/aeropress-draagbaar/beste-aeropress-2026", sessions: 80, affiliate_clicks: 20 },
      {
        url: "/test/aeropress-draagbaar/draagbare-koffiemolen",
        sessions: 90,
        affiliate_clicks: 18,
      },
    ],
    metrics: {
      window_days: 14,
      paid_traffic_spend_eur: 48,
      sessions_total: 312,
      affiliate_clicks_total: 56,
      affiliate_clicks_by_network: { bol: 32, awin: 18, daisycon: 6 },
      affiliate_conversions: 3,
      affiliate_revenue_eur: 14.2,
      email_signups: 8,
    },
    ...overrides,
  });
}

describe("evaluateMechanicalSafeguards", () => {
  it("leaves PIVOT and KILL decisions untouched", () => {
    const pivot = evaluateMechanicalSafeguards(input(), "pivot");
    expect(pivot.amended).toBe(false);
    expect(pivot.decision).toBe("pivot");

    const kill = evaluateMechanicalSafeguards(input(), "kill");
    expect(kill.amended).toBe(false);
    expect(kill.decision).toBe("kill");
  });

  it("allows GO when there is at least one conversion and traffic is spread", () => {
    const res = evaluateMechanicalSafeguards(input(), "go");
    expect(res.amended).toBe(false);
    expect(res.decision).toBe("go");
  });

  it("downgrades GO → PIVOT when conversions = 0 (prompt constraint)", () => {
    const res = evaluateMechanicalSafeguards(
      input({
        metrics: {
          window_days: 14,
          paid_traffic_spend_eur: 48,
          sessions_total: 312,
          affiliate_clicks_total: 56,
          affiliate_clicks_by_network: { bol: 32, awin: 18, daisycon: 6 },
          affiliate_conversions: 0,
          affiliate_revenue_eur: 0,
          email_signups: 8,
        },
      }),
      "go",
    );
    expect(res.amended).toBe(true);
    expect(res.amendedReason).toBe("go_without_conversion");
    expect(res.decision).toBe("pivot");
  });

  it("downgrades GO → PIVOT when one page accounts for >70% of sessions", () => {
    const res = evaluateMechanicalSafeguards(
      input({
        test_pages: [
          { url: "/test/x/a", sessions: 300, affiliate_clicks: 50 },
          { url: "/test/x/b", sessions: 10, affiliate_clicks: 5 },
          { url: "/test/x/c", sessions: 2, affiliate_clicks: 1 },
        ],
        metrics: {
          window_days: 14,
          paid_traffic_spend_eur: 48,
          sessions_total: 312,
          affiliate_clicks_total: 56,
          affiliate_clicks_by_network: { bol: 56 },
          affiliate_conversions: 5,
          affiliate_revenue_eur: 200,
          email_signups: 8,
        },
      }),
      "go",
    );
    expect(res.amended).toBe(true);
    expect(res.amendedReason).toBe("go_concentrated_traffic");
    expect(res.decision).toBe("pivot");
  });

  it("conversion-zero takes precedence over traffic concentration", () => {
    const res = evaluateMechanicalSafeguards(
      input({
        test_pages: [
          { url: "/test/x/a", sessions: 300, affiliate_clicks: 50 },
          { url: "/test/x/b", sessions: 12, affiliate_clicks: 5 },
        ],
        metrics: {
          window_days: 14,
          paid_traffic_spend_eur: 0,
          sessions_total: 312,
          affiliate_clicks_total: 55,
          affiliate_clicks_by_network: {},
          affiliate_conversions: 0,
          affiliate_revenue_eur: 0,
          email_signups: 0,
        },
      }),
      "go",
    );
    expect(res.amendedReason).toBe("go_without_conversion");
  });
});

describe("ValidationOutputSchema", () => {
  const wellFormed = {
    decision: "go",
    confidence: "medium",
    rationale: "Three conversions across 312 sessions cross the GO threshold.",
    key_metrics: {
      sessions: 312,
      affiliate_clicks: 56,
      affiliate_conversions: 3,
      affiliate_revenue_eur: 14.2,
      email_signups: 8,
      avg_time_on_page_seconds: 94,
      ctr_to_affiliate: 0.18,
    },
    next_actions: ["Promote to full build", "Brief operator on hero pages"],
  };

  it("accepts a well-formed output", () => {
    expect(() => ValidationOutputSchema.parse(wellFormed)).not.toThrow();
  });

  it("rejects ctr outside 0..1", () => {
    expect(() =>
      ValidationOutputSchema.parse({
        ...wellFormed,
        key_metrics: { ...wellFormed.key_metrics, ctr_to_affiliate: 1.5 },
      }),
    ).toThrow();
  });

  it("rejects an unknown decision", () => {
    expect(() => ValidationOutputSchema.parse({ ...wellFormed, decision: "go!" })).toThrow();
  });

  it("requires at least one next_action", () => {
    expect(() => ValidationOutputSchema.parse({ ...wellFormed, next_actions: [] })).toThrow();
  });
});
