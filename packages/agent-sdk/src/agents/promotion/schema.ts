import { z } from "zod";

export const PROMOTION_RESULTS = [
  "ready",
  "not_ready",
  "blocked_by_update_window",
  "blocked_by_single_source",
] as const;
export type PromotionResult = (typeof PROMOTION_RESULTS)[number];

export const PROMOTION_REGISTRARS = ["cloudflare", "transip"] as const;
export type PromotionRegistrar = (typeof PROMOTION_REGISTRARS)[number];

// ---------------------------------------------------------------------------
// Input — 90d metrics + algorithm/manual-action context + candidate domains.
// ---------------------------------------------------------------------------

const MonthlySeriesSchema = z.tuple([z.number(), z.number(), z.number()]);

const EngagementInputSchema = z.object({
  median_time_on_page_seconds: z.number().nonnegative(),
  median_scroll_depth: z.number().min(0).max(1),
  median_bot_score: z.number().min(0).max(100),
  bounce_rate: z.number().min(0).max(1),
});

const AlgorithmEventSchema = z.object({
  kind: z.string().min(1),
  started_at: z.string(),
  ended_at: z.string().nullable(),
});

const ManualActionSchema = z.object({
  kind: z.string().min(1),
  page_pattern: z.string().min(1),
  opened_at: z.string(),
});

const CandidateDomainSchema = z.object({
  hostname: z.string().min(3),
  registrar: z.enum(PROMOTION_REGISTRARS),
  cost_eur_year: z.number().nonnegative(),
  available: z.boolean(),
  tmview_clear: z.boolean(),
});

export const PromotionInputSchema = z.object({
  niche: z.object({
    topic: z.string().min(2).max(80),
    topic_slug: z.string().min(2).max(80),
    current_state: z.string().min(1),
    days_in_state: z.number().int().nonnegative(),
  }),
  metrics_90d: z.object({
    approved_revenue_per_month_eur: MonthlySeriesSchema,
    organic_clicks_per_month: MonthlySeriesSchema,
    non_brand_long_tail_share: z.number().min(0).max(1),
    affiliate_sources_share: z.record(z.string(), z.number().min(0).max(1)),
    single_product_share_max: z.number().min(0).max(1),
    branded_queries_per_month: z.number().int().nonnegative(),
    engagement: EngagementInputSchema,
  }),
  algorithm_events_30d: z.array(AlgorithmEventSchema).default([]),
  gsc_manual_actions_30d: z.array(ManualActionSchema).default([]),
  candidate_domains: z.array(CandidateDomainSchema).min(1).max(5),
});
export type PromotionInput = z.infer<typeof PromotionInputSchema>;

// ---------------------------------------------------------------------------
// Output — strict shape mirroring AGENT_PROMPTS.md §5.
// ---------------------------------------------------------------------------

const CriterionRowSchema = z.object({
  passed: z.boolean(),
  value: z.unknown(),
  threshold: z.unknown(),
});

export const PromotionOutputSchema = z.object({
  result: z.enum(PROMOTION_RESULTS),
  criteria: z.object({
    revenue: CriterionRowSchema,
    organic_clicks: CriterionRowSchema,
    diversity: CriterionRowSchema,
    branded_search: CriterionRowSchema,
    engagement: CriterionRowSchema,
    algorithm_quiet: CriterionRowSchema,
    no_manual_action: CriterionRowSchema,
  }),
  recommendation: z.string().min(1).max(5_000),
  proposed_domains: z
    .array(
      z.object({
        hostname: z.string().min(3),
        registrar: z.enum(PROMOTION_REGISTRARS),
        cost_eur_year: z.number().nonnegative(),
        available: z.boolean(),
        tmview_clear: z.boolean(),
      }),
    )
    .default([]),
  migration_plan_summary: z.string().max(5_000).optional(),
  risks: z.array(z.string().min(1)).default([]),
  /** YYYY-MM-DD or null when result === "ready". */
  earliest_retry_date: z.string().nullable(),
});
export type PromotionOutput = z.infer<typeof PromotionOutputSchema>;
