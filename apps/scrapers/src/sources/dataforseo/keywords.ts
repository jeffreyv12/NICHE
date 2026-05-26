import { type CacheBackend, SEVEN_DAYS_MS, cacheKey, withCache } from "./cache.js";
import type { DataForSeoClient } from "./client.js";
import {
  DataForSeoError,
  type KeywordOverviewItem,
  type KeywordOverviewRequest,
  type RelatedKeywordItem,
  type RelatedKeywordsRequest,
  keywordOverviewItem,
  keywordOverviewRequest,
  relatedKeywordItem,
  relatedKeywordsRequest,
} from "./types.js";

const KEYWORD_OVERVIEW_ENDPOINT = "/v3/dataforseo_labs/google/keyword_overview/live";
const RELATED_KEYWORDS_ENDPOINT = "/v3/dataforseo_labs/google/related_keywords/live";

// Pulls the first task's `result` array out of the envelope, throwing if
// the task itself reports an error. Errors at task level are common and
// distinct from HTTP-level failures, so we surface them explicitly.
function unwrapFirstTaskResult(env: unknown, endpoint: string): unknown[] {
  const tasks = (env as { tasks?: unknown[] }).tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new DataForSeoError(-1, "no tasks in envelope", endpoint);
  }
  const t = tasks[0] as {
    status_code?: number;
    status_message?: string;
    result?: unknown[];
  };
  // 20000 = "Ok". Anything else is an error per their docs.
  if (t.status_code !== 20000) {
    throw new DataForSeoError(
      t.status_code ?? -1,
      t.status_message ?? "unknown task error",
      endpoint,
    );
  }
  return t.result ?? [];
}

export async function keywordOverview(
  client: DataForSeoClient,
  cache: CacheBackend,
  req: KeywordOverviewRequest,
): Promise<KeywordOverviewItem[]> {
  const body = keywordOverviewRequest.parse(req);
  const key = cacheKey(KEYWORD_OVERVIEW_ENDPOINT, body);
  return withCache(cache, key, SEVEN_DAYS_MS, async () => {
    const env = await client.post(KEYWORD_OVERVIEW_ENDPOINT, body);
    const result = unwrapFirstTaskResult(env, KEYWORD_OVERVIEW_ENDPOINT);
    // Labs returns one result-array per request; each item is one keyword.
    const items = result
      .map((r) => keywordOverviewItem.safeParse(r))
      .filter((p): p is { success: true; data: KeywordOverviewItem } => p.success)
      .map((p) => p.data);
    return items;
  });
}

export async function relatedKeywords(
  client: DataForSeoClient,
  cache: CacheBackend,
  req: RelatedKeywordsRequest,
): Promise<RelatedKeywordItem[]> {
  const body = relatedKeywordsRequest.parse(req);
  const key = cacheKey(RELATED_KEYWORDS_ENDPOINT, body);
  return withCache(cache, key, SEVEN_DAYS_MS, async () => {
    const env = await client.post(RELATED_KEYWORDS_ENDPOINT, body);
    const result = unwrapFirstTaskResult(env, RELATED_KEYWORDS_ENDPOINT);
    // related_keywords nests items inside the first result row.
    const items: RelatedKeywordItem[] = [];
    for (const row of result) {
      const inner = (row as { items?: unknown[] }).items;
      if (!Array.isArray(inner)) continue;
      for (const it of inner) {
        const parsed = relatedKeywordItem.safeParse(it);
        if (parsed.success) items.push(parsed.data);
      }
    }
    return items;
  });
}
