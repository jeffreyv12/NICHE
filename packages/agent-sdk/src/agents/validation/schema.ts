import { z } from "zod";

// ---------------------------------------------------------------------------
// Validation decisions live in their own enum so the host can compare against
// niches.state transitions without importing the Sonnet output type.
// ---------------------------------------------------------------------------

export const VALIDATION_DECISIONS = ["go", "pivot", "kill"] as const;
export type ValidationDecision = (typeof VALIDATION_DECISIONS)[number];

export const VALIDATION_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type ValidationConfidence = (typeof VALIDATION_CONFIDENCE_LEVELS)[number];

// ---------------------------------------------------------------------------
// Per-page + per-network roll-ups the host hands to the agent. Test-page URLs
// stay strings (paths or absolute) so the agent can quote them in rationale.
// ---------------------------------------------------------------------------

export const TestPageMetricsSchema = z.object({
  url: z.string().min(1),
  sessions: z.number().int().nonnegative(),
  bounce_rate: z.number().min(0).max(1).optional(),
  avg_time_on_page_seconds: z.number().nonnegative().optional(),
  affiliate_clicks: z.number().int().nonnegative().default(0),
});
export type TestPageMetrics = z.infer<typeof TestPageMetricsSchema>;

export const AffiliateClicksByNetworkSchema = z.record(
  z.string(), // network slug — bol|awin|daisycon|digistore|impact|...
  z.number().int().nonnegative(),
);

export const ValidationMetricsSchema = z.object({
  window_days: z.number().int().min(1).max(60).default(14),
  paid_traffic_spend_eur: z.number().nonnegative().default(0),
  sessions_total: z.number().int().nonnegative(),
  bounce_rate: z.number().min(0).max(1).optional(),
  avg_time_on_page_seconds: z.number().nonnegative().optional(),
  affiliate_clicks_total: z.number().int().nonnegative().default(0),
  affiliate_clicks_by_network: AffiliateClicksByNetworkSchema.default({}),
  affiliate_conversions: z.number().int().nonnegative().default(0),
  affiliate_revenue_eur: z.number().nonnegative().default(0),
  email_signups: z.number().int().nonnegative().default(0),
});
export type ValidationMetrics = z.infer<typeof ValidationMetricsSchema>;

// ---------------------------------------------------------------------------
// Input — niche identification + metrics bundle.
// ---------------------------------------------------------------------------

export const ValidationInputSchema = z.object({
  niche: z.object({
    topic: z.string().min(2).max(80),
    topic_slug: z
      .string()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be kebab-case ASCII"),
    days_in_validation: z.number().int().nonnegative(),
  }),
  test_pages: z.array(TestPageMetricsSchema).min(1).max(20),
  metrics: ValidationMetricsSchema,
  /** Score breakdown from the original Scoring run (for context only). */
  prior_score_breakdown: z.unknown().optional(),
});
export type ValidationInput = z.infer<typeof ValidationInputSchema>;

// ---------------------------------------------------------------------------
// Output — matches AGENT_PROMPTS.md §3 exactly.
// ---------------------------------------------------------------------------

export const ValidationOutputSchema = z.object({
  decision: z.enum(VALIDATION_DECISIONS),
  confidence: z.enum(VALIDATION_CONFIDENCE_LEVELS),
  rationale: z.string().min(1).max(2000),
  key_metrics: z.object({
    sessions: z.number().int().nonnegative(),
    affiliate_clicks: z.number().int().nonnegative(),
    affiliate_conversions: z.number().int().nonnegative(),
    affiliate_revenue_eur: z.number().nonnegative(),
    email_signups: z.number().int().nonnegative(),
    avg_time_on_page_seconds: z.number().nonnegative(),
    ctr_to_affiliate: z.number().min(0).max(1),
  }),
  next_actions: z.array(z.string().min(1)).min(1).max(10),
});
export type ValidationOutput = z.infer<typeof ValidationOutputSchema>;
