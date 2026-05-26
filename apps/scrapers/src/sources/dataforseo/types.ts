import { z } from "zod";

// DataForSEO wraps every response in a common envelope. We validate the
// envelope first, then validate the per-endpoint `result` payload separately
// — that way a partial result on one task does not invalidate the whole batch.

export const dfsTaskEnvelope = z.object({
  id: z.string(),
  status_code: z.number(),
  status_message: z.string(),
  time: z.string().optional(),
  cost: z.number().optional(),
  result_count: z.number().optional(),
});

export const dfsResponseEnvelope = z.object({
  version: z.string().optional(),
  status_code: z.number(),
  status_message: z.string(),
  time: z.string().optional(),
  cost: z.number().optional(),
  tasks_count: z.number().optional(),
  tasks_error: z.number().optional(),
  tasks: z.array(z.unknown()),
});

// Locations & languages we use. 2528 = Netherlands, 2056 = Belgium.
export const SupportedLocationCode = z.union([z.literal(2528), z.literal(2056)]);
export const SupportedLanguageCode = z.enum(["nl", "fr", "en"]);

// ---------------------------------------------------------------------------
// keyword_overview (Labs Live)
// ---------------------------------------------------------------------------

export const keywordOverviewItem = z.object({
  keyword: z.string(),
  location_code: z.number(),
  language_code: z.string(),
  search_volume: z.number().nullable(),
  cpc: z.number().nullable().optional(),
  competition: z.number().nullable().optional(),
  competition_level: z.string().nullable().optional(),
  // Labs sometimes returns search_intent_info; treat as opaque + optional.
  search_intent_info: z
    .object({
      main_intent: z.string().nullable().optional(),
      foreign_intent: z.array(z.string()).nullable().optional(),
    })
    .nullable()
    .optional(),
  keyword_info: z
    .object({
      search_volume: z.number().nullable().optional(),
      cpc: z.number().nullable().optional(),
      competition: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type KeywordOverviewItem = z.infer<typeof keywordOverviewItem>;

export const keywordOverviewRequest = z.object({
  keywords: z.array(z.string().min(1)).min(1).max(700),
  location_code: SupportedLocationCode.default(2528),
  language_code: SupportedLanguageCode.default("nl"),
});

export type KeywordOverviewRequest = z.infer<typeof keywordOverviewRequest>;

// ---------------------------------------------------------------------------
// related_keywords (Labs Live)
// ---------------------------------------------------------------------------

export const relatedKeywordItem = z.object({
  keyword_data: z.object({
    keyword: z.string(),
    keyword_info: z
      .object({
        search_volume: z.number().nullable().optional(),
        cpc: z.number().nullable().optional(),
        competition: z.number().nullable().optional(),
      })
      .nullable()
      .optional(),
  }),
  depth: z.number().optional(),
  related_keywords: z.array(z.string()).nullable().optional(),
});

export type RelatedKeywordItem = z.infer<typeof relatedKeywordItem>;

export const relatedKeywordsRequest = z.object({
  keyword: z.string().min(1),
  location_code: SupportedLocationCode.default(2528),
  language_code: SupportedLanguageCode.default("nl"),
  depth: z.number().int().min(0).max(4).default(2),
  limit: z.number().int().min(1).max(1000).default(100),
});

export type RelatedKeywordsRequest = z.infer<typeof relatedKeywordsRequest>;

// ---------------------------------------------------------------------------
// SERP — Google Organic via Standard Queue (task_post + task_get)
// ---------------------------------------------------------------------------

export const serpOrganicItem = z.object({
  type: z.string(),
  rank_group: z.number().optional(),
  rank_absolute: z.number().optional(),
  domain: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export type SerpOrganicItem = z.infer<typeof serpOrganicItem>;

export const serpOrganicResult = z.object({
  keyword: z.string(),
  location_code: z.number(),
  language_code: z.string(),
  total_count: z.number().nullable().optional(),
  items: z.array(serpOrganicItem).nullable().optional(),
});

export const serpOrganicRequest = z.object({
  keyword: z.string().min(1),
  location_code: SupportedLocationCode.default(2528),
  language_code: SupportedLanguageCode.default("nl"),
  depth: z.number().int().min(10).max(100).default(10),
  // Standard Queue is the default cost-conscious choice. "live" costs 15×.
  mode: z.enum(["standard", "live"]).default("standard"),
});

export type SerpOrganicRequest = z.infer<typeof serpOrganicRequest>;

export const serpTaskPostResponse = z.object({
  id: z.string(),
  status_code: z.number(),
  status_message: z.string(),
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class DataForSeoError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly statusMessage: string,
    public readonly endpoint: string,
  ) {
    super(`DataForSEO ${endpoint} -> ${statusCode}: ${statusMessage}`);
    this.name = "DataForSeoError";
  }
}

export class DataForSeoAuthError extends DataForSeoError {
  constructor(endpoint: string) {
    super(401, "Unauthorized — check DATAFORSEO_LOGIN/PASSWORD", endpoint);
    this.name = "DataForSeoAuthError";
  }
}

export class DataForSeoTimeoutError extends Error {
  constructor(taskId: string, waitedMs: number) {
    super(`DataForSEO task ${taskId} did not finish within ${waitedMs}ms`);
    this.name = "DataForSeoTimeoutError";
  }
}
