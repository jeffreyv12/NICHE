import { z } from "zod";

export const ALERT_SEVERITIES = ["info", "warning", "critical"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

// ---------------------------------------------------------------------------
// Inputs — the host snapshots portfolio + cost + kills + promotions and hands
// them to the agent. We keep schemas loose for cost-ledger categories so a new
// vendor doesn't force a prompt-version bump.
// ---------------------------------------------------------------------------

const NicheSnapshotSchema = z.object({
  topic: z.string(),
  topic_slug: z.string(),
  state: z.string(),
  days_in_state: z.number().int().nonnegative(),
  revenue_last_month_eur: z.number().nonnegative().optional(),
  organic_clicks_last_month: z.number().int().nonnegative().optional(),
  last_hero_edit_days_ago: z.number().int().nonnegative().nullable().optional(),
});

const KillSnapshotSchema = z.object({
  niche_slug: z.string(),
  reason: z.string(),
  killed_at: z.string(),
});

const PromotionSnapshotSchema = z.object({
  niche_slug: z.string(),
  result: z.string(),
  evaluated_at: z.string(),
  ready_since: z.string().optional(),
});

const AlgorithmEventSnapshotSchema = z.object({
  kind: z.string(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
});

const CostLineSchema = z.object({
  category: z.string(),
  mtd_eur: z.number().nonnegative(),
});

export const OrchestratorInputSchema = z.object({
  week_of: z.string(), // YYYY-MM-DD
  niches: z.array(NicheSnapshotSchema).max(500),
  spend: z.object({
    claude_mtd_eur: z.number().nonnegative(),
    claude_budget_eur: z.number().nonnegative(),
    cost_ledger_mtd: z.array(CostLineSchema).default([]),
    paid_traffic_mtd_eur: z.number().nonnegative().default(0),
  }),
  kills_90d: z.array(KillSnapshotSchema).default([]),
  promotions_90d: z.array(PromotionSnapshotSchema).default([]),
  algorithm_events_30d: z.array(AlgorithmEventSnapshotSchema).default([]),
});
export type OrchestratorInput = z.infer<typeof OrchestratorInputSchema>;

// ---------------------------------------------------------------------------
// Output — matches AGENT_PROMPTS.md §6.
// ---------------------------------------------------------------------------

export const OrchestratorOutputSchema = z.object({
  week_of: z.string(),
  headline: z.string().min(1).max(280),
  portfolio_state: z.object({
    candidate_count: z.number().int().nonnegative(),
    validating: z.number().int().nonnegative(),
    building: z.number().int().nonnegative(),
    mature: z.number().int().nonnegative(),
    promoted: z.number().int().nonnegative(),
    killed_lifetime: z.number().int().nonnegative(),
    kill_rate_12m: z.number().min(0).max(1),
    promotion_rate_12m: z.number().min(0).max(1),
  }),
  spend: z.object({
    claude_mtd_eur: z.number().nonnegative(),
    claude_budget_eur: z.number().nonnegative(),
    claude_pct_used: z.number().min(0),
    infra_mtd_eur: z.number().nonnegative(),
    paid_traffic_mtd_eur: z.number().nonnegative(),
  }),
  kills_recommended: z
    .array(
      z.object({
        niche_slug: z.string(),
        reason: z.string(),
        evidence: z.unknown(),
      }),
    )
    .default([]),
  promotions_pending_operator: z
    .array(
      z.object({
        niche_slug: z.string(),
        ready_since: z.string(),
      }),
    )
    .default([]),
  alerts: z
    .array(
      z.object({
        severity: z.enum(ALERT_SEVERITIES),
        message: z.string().min(1).max(2000),
      }),
    )
    .default([]),
  operator_action_items: z.array(z.string().min(1)).default([]),
});
export type OrchestratorOutput = z.infer<typeof OrchestratorOutputSchema>;
