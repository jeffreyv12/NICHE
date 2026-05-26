import {
  CRITERION_KEYS,
  type CriterionKey,
  HARD_BLOCK_REASONS,
  RUBRIC_VERSION,
} from "@nichefinder/shared";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Pre-fetched signal bundles — shape mirrors the sample input in
// docs/AGENT_PROMPTS.md §2. The host runtime fills these in before the call;
// the agent does NOT fetch on its own.
// ---------------------------------------------------------------------------

const PerNetworkAvailability = z
  .object({
    advertisers: z.number().int().nonnegative().optional(),
    products: z.number().int().nonnegative().optional(),
    median_epc_eur: z.number().nullable().optional(),
    programs_with_offer: z.array(z.string()).optional(),
  })
  .passthrough();

const AffiliateAvailabilitySchema = z
  .object({
    bol: PerNetworkAvailability.optional(),
    awin: PerNetworkAvailability.optional(),
    daisycon: PerNetworkAvailability.optional(),
    digistore: PerNetworkAvailability.optional(),
    impact: PerNetworkAvailability.optional(),
    median_epc_eur_overall: z.number().nullable().optional(),
  })
  .passthrough();

const DataForSeoKeywordsSchema = z
  .object({
    total_volume_intent_commercial: z.number().int().nonnegative().optional(),
    avg_keyword_difficulty: z.number().min(0).max(100).optional(),
    top_keyword: z.string().optional(),
    keyword_count: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const DataForSeoSerpSchema = z
  .object({
    /** Fraction of top-10 results that look templated (AI-style listicles). 0..1. */
    pct_top10_templated: z.number().min(0).max(1).optional(),
    /** Unique distinct domains in top-10 averaged across keywords. */
    unique_domains_avg: z.number().nonnegative().optional(),
    /** Median Domain Rating of top-10 results. */
    median_dr: z.number().min(0).max(100).optional(),
  })
  .passthrough();

const WikipediaSchema = z
  .object({
    /** 90-day relative slope of pageviews (e.g. +0.18 = +18%). */
    pageview_90d_slope: z.number().optional(),
  })
  .passthrough();

const TrendsSchema = z
  .object({
    google_90d_slope: z.number().optional(),
    dataforseo_12m_slope: z.number().optional(),
  })
  .passthrough();

const TrademarkSchema = z.object({
  /**
   * Result of EUIPO TMview screening on the brand-candidate strings.
   * "clear" = no live match; "match" = registered match found (hard block).
   */
  euipo_tmview: z.enum(["clear", "match", "unknown"]),
  matched_marks: z.array(z.string()).optional(),
});

export const ScoringSignalBundleSchema = z.object({
  affiliate_availability: AffiliateAvailabilitySchema,
  dataforseo_keywords: DataForSeoKeywordsSchema,
  dataforseo_serp_top5: DataForSeoSerpSchema,
  wikipedia: WikipediaSchema.optional(),
  trends: TrendsSchema.optional(),
  trademark: TrademarkSchema,
  /** Host-supplied: did our kill-list match this candidate? */
  kill_list_match: z.string().nullable(),
  /** Host-supplied: does the YMYL filter mark this regulated? */
  ymyl_match: z.boolean(),
  /** 0..100 — operator's a-priori interest, default 50. */
  operator_interest: z.number().int().min(0).max(100).default(50),
});
export type ScoringSignalBundle = z.infer<typeof ScoringSignalBundleSchema>;

// ---------------------------------------------------------------------------
// Candidate to score — narrowed from NicheCandidate so the scoring agent
// doesn't depend on the full discovery surface.
// ---------------------------------------------------------------------------

export const ScoringCandidateSchema = z.object({
  topic: z.string().min(2).max(80),
  topic_slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be kebab-case ASCII"),
  language: z.enum(["nl", "en"]),
  related_keywords: z.array(z.string().min(1)).min(1).max(20),
});
export type ScoringCandidate = z.infer<typeof ScoringCandidateSchema>;

// ---------------------------------------------------------------------------
// Input — host-side known states the agent must respect.
// ---------------------------------------------------------------------------

export const ScoringInputSchema = z.object({
  candidate: ScoringCandidateSchema,
  signals: ScoringSignalBundleSchema,
  /** Slugs the host has previously killed (defense-in-depth duplicate check). */
  killedSlugs: z.array(z.string()).default([]),
  /** Slugs that are currently active niches (don't re-promote). */
  activeSlugs: z.array(z.string()).default([]),
  /**
   * Optional: a Haiku breakdown to include as `haiku_first_pass` when this
   * call is the Sonnet escalation pass. Omit on the first pass.
   */
  haikuFirstPass: z.unknown().optional(),
});
export type ScoringInput = z.infer<typeof ScoringInputSchema>;

// ---------------------------------------------------------------------------
// Output — must satisfy the rubric shape (CriterionKey is the source of truth).
// ---------------------------------------------------------------------------

const CriterionScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  evidence: z.unknown(),
});

// Build the breakdown object dynamically from CRITERION_KEYS so the schema
// stays in sync with @nichefinder/shared/rubric automatically.
const breakdownShape = Object.fromEntries(
  CRITERION_KEYS.map((k) => [k, CriterionScoreSchema] as const),
) as Record<CriterionKey, typeof CriterionScoreSchema>;

export const ScoreBreakdownSchema = z
  .object({
    ...breakdownShape,
    // Present only on escalation outputs (Sonnet attaches it back).
    haiku_first_pass: z.unknown().nullable().optional(),
  })
  .strict();

export const ScoringOutputSchema = z.object({
  rubric_version: z.literal(RUBRIC_VERSION),
  total_score: z.number().int().min(0).max(100),
  block_reason: z.enum(HARD_BLOCK_REASONS).nullable(),
  breakdown: ScoreBreakdownSchema,
  notes: z.string().max(1000),
});
export type ScoringOutput = z.infer<typeof ScoringOutputSchema>;
