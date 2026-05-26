import { z } from "zod";

// Each "signal" is one row of evidence drawn from a source: a trending
// keyword, a programme listing, a YouTube hit, a Wikipedia pageview delta.
// The runtime pre-fetches signals from the source clients, then passes them
// to the agent for synthesis. The agent does NOT browse — it reasons over
// what's already in its context.
export const DiscoverySignalSchema = z.object({
  source: z.enum([
    "dataforseo",
    "bol_trends",
    "awin_programmes",
    "daisycon_programs",
    "yt_trending",
    "wiki_pageviews",
    "other",
  ]),
  summary: z.string().min(1).max(500),
  raw: z.record(z.string(), z.unknown()),
});
export type DiscoverySignal = z.infer<typeof DiscoverySignalSchema>;

export const DiscoveryInputSchema = z.object({
  /** ISO 8601 timestamp of when the signals were gathered. */
  gatheredAt: z.string(),
  /** The raw evidence the agent reasons over. Capped to keep token cost predictable. */
  signals: z.array(DiscoverySignalSchema).min(1).max(200),
  /**
   * Optional list of `topic_slug` values the operator does NOT want resurfaced
   * this run (e.g. already approved, currently scoring, recently rejected).
   * Passed in by the host runtime; agent should drop matches silently.
   */
  excludeSlugs: z.array(z.string()).default([]),
});
export type DiscoveryInput = z.infer<typeof DiscoveryInputSchema>;

const PreliminaryRedFlag = z.enum([
  "YMYL_health",
  "YMYL_finance",
  "trademark_risk",
  "saturated_serp",
  "regulated_gambling",
  "regulated_alcohol_tobacco",
  "weapons",
  "adult",
  "fad",
  "broad",
  "other",
]);

export const NicheCandidateSchema = z.object({
  topic: z.string().min(2).max(80),
  topic_slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be kebab-case ASCII"),
  language: z.enum(["nl", "en"]),
  related_keywords: z.array(z.string().min(1)).min(1).max(20),
  evidence: z.object({
    source: DiscoverySignalSchema.shape.source,
    signal_summary: z.string().min(1).max(500),
    raw_signal: z.record(z.string(), z.unknown()),
  }),
  preliminary_red_flags: z.array(PreliminaryRedFlag).default([]),
});
export type NicheCandidate = z.infer<typeof NicheCandidateSchema>;

export const DiscoveryOutputSchema = z.object({
  candidates: z.array(NicheCandidateSchema).max(50),
});
export type DiscoveryOutput = z.infer<typeof DiscoveryOutputSchema>;
