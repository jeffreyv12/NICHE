import { type CacheBackend, SEVEN_DAYS_MS, cacheKey, withCache } from "./cache.js";
import type { DataForSeoClient } from "./client.js";
import {
  DataForSeoError,
  DataForSeoTimeoutError,
  type SerpOrganicItem,
  type SerpOrganicRequest,
  serpOrganicItem,
  serpOrganicRequest,
} from "./types.js";

const SERP_LIVE_ENDPOINT = "/v3/serp/google/organic/live/advanced";
const SERP_TASK_POST = "/v3/serp/google/organic/task_post";
const SERP_TASK_GET = "/v3/serp/google/organic/task_get/advanced";

// DATA_SOURCES.md: poll every 30s, max 10min, then time out.
const POLL_INTERVAL_MS = 30_000;
const POLL_MAX_WAIT_MS = 10 * 60_000;

export interface SerpPollOptions {
  intervalMs?: number;
  maxWaitMs?: number;
  // Hook for tests so we don't actually sleep.
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function serpOrganic(
  client: DataForSeoClient,
  cache: CacheBackend,
  req: SerpOrganicRequest,
  poll: SerpPollOptions = {},
): Promise<SerpOrganicItem[]> {
  const body = serpOrganicRequest.parse(req);
  const key = cacheKey(`serp:${body.mode}`, body);
  return withCache(cache, key, SEVEN_DAYS_MS, async () => {
    if (body.mode === "live") {
      const env = await client.post(SERP_LIVE_ENDPOINT, body);
      return extractSerpItems(env, SERP_LIVE_ENDPOINT);
    }
    const taskId = await postSerpTask(client, body);
    return pollSerpTask(client, taskId, poll);
  });
}

async function postSerpTask(client: DataForSeoClient, body: SerpOrganicRequest): Promise<string> {
  const env = await client.post(SERP_TASK_POST, body);
  const tasks = (
    env as { tasks?: { id?: string; status_code?: number; status_message?: string }[] }
  ).tasks;
  if (!Array.isArray(tasks) || !tasks[0]?.id) {
    throw new DataForSeoError(-1, "task_post: missing task id", SERP_TASK_POST);
  }
  const t = tasks[0];
  // 20100 = "Task Created." — the queue accepted it.
  if (t.status_code !== 20100) {
    throw new DataForSeoError(
      t.status_code ?? -1,
      t.status_message ?? "task_post failed",
      SERP_TASK_POST,
    );
  }
  return t.id as string;
}

async function pollSerpTask(
  client: DataForSeoClient,
  taskId: string,
  opts: SerpPollOptions,
): Promise<SerpOrganicItem[]> {
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  const maxWaitMs = opts.maxWaitMs ?? POLL_MAX_WAIT_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const endpoint = `${SERP_TASK_GET}/${taskId}`;
  const started = Date.now();
  while (true) {
    const elapsed = Date.now() - started;
    if (elapsed >= maxWaitMs) throw new DataForSeoTimeoutError(taskId, elapsed);
    const env = await client.post(endpoint, {});
    const tasks = (env as { tasks?: { status_code?: number; status_message?: string }[] }).tasks;
    const t = tasks?.[0];
    if (t?.status_code === 20000) {
      return extractSerpItems(env, endpoint);
    }
    // 40601 / 40602 = "Task in Queue" / "Task in Progress" — keep waiting.
    if (t && t.status_code !== 40601 && t.status_code !== 40602) {
      throw new DataForSeoError(
        t.status_code ?? -1,
        t.status_message ?? "task_get failed",
        endpoint,
      );
    }
    await sleep(intervalMs);
  }
}

function extractSerpItems(env: unknown, endpoint: string): SerpOrganicItem[] {
  const tasks = (env as { tasks?: { result?: { items?: unknown[] }[] }[] }).tasks;
  const result = tasks?.[0]?.result;
  if (!Array.isArray(result)) {
    throw new DataForSeoError(-1, "no result in task envelope", endpoint);
  }
  const items: SerpOrganicItem[] = [];
  for (const row of result) {
    const inner = row.items;
    if (!Array.isArray(inner)) continue;
    for (const it of inner) {
      // Filter to organic only — DataForSEO mixes in featured snippets, etc.
      const obj = it as { type?: string };
      if (obj?.type !== "organic") continue;
      const parsed = serpOrganicItem.safeParse(it);
      if (parsed.success) items.push(parsed.data);
    }
  }
  return items;
}
