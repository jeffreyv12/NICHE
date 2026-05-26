import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RetryPolicy } from "../client.js";
import {
  DataForSeoAuthError,
  DataForSeoClient,
  DataForSeoError,
  MemoryCache,
  keywordOverview,
  serpOrganic,
} from "../index.js";

const CREDS = { login: "test@example.com", password: "secret" };

function mockFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    return impl(u, init ?? {});
  }) as unknown as typeof fetch;
}

interface OkEnvelope {
  version: string;
  status_code: number;
  status_message: string;
  tasks_count: number;
  tasks_error: number;
  tasks: unknown[];
}

function envelopeOk(taskResult: unknown[]): OkEnvelope {
  return {
    version: "0.1.20240101",
    status_code: 20000,
    status_message: "Ok.",
    tasks_count: 1,
    tasks_error: 0,
    tasks: [{ id: "task-1", status_code: 20000, status_message: "Ok.", result: taskResult }],
  };
}

describe("DataForSeoClient.post", () => {
  it("sends Basic Auth + wraps single body in array", async () => {
    let capturedAuth: string | undefined;
    let capturedBody: unknown = null;
    const fetchImpl = mockFetch((_url, init) => {
      capturedAuth = (init.headers as Record<string, string>).Authorization;
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(envelopeOk([])), { status: 200 });
    });
    const client = new DataForSeoClient({ credentials: CREDS, fetchImpl });
    await client.post("/v3/test", { keyword: "x" });
    expect(capturedAuth).toMatch(/^Basic /);
    expect(Array.isArray(capturedBody)).toBe(true);
    expect((capturedBody as unknown[])[0]).toEqual({ keyword: "x" });
  });

  it("throws DataForSeoAuthError on 401", async () => {
    const fetchImpl = mockFetch(() => new Response("nope", { status: 401 }));
    const client = new DataForSeoClient({ credentials: CREDS, fetchImpl });
    await expect(client.post("/v3/test", {})).rejects.toBeInstanceOf(DataForSeoAuthError);
  });

  it("does not retry on 401 even if policy says yes", async () => {
    let calls = 0;
    const fetchImpl = mockFetch(() => {
      calls++;
      return new Response("nope", { status: 401 });
    });
    const retry: RetryPolicy = {
      maxAttempts: 5,
      decide: (_args: { attempt: number; error: unknown; httpStatus?: number }) => ({
        retry: true,
        delayMs: 0,
      }),
    };
    const client = new DataForSeoClient({ credentials: CREDS, fetchImpl, retry });
    await expect(client.post("/v3/test", {})).rejects.toBeInstanceOf(DataForSeoAuthError);
    expect(calls).toBe(1);
  });

  it("retries on 503 when policy says yes, succeeds on second attempt", async () => {
    let calls = 0;
    const fetchImpl = mockFetch(() => {
      calls++;
      if (calls === 1) return new Response("busy", { status: 503 });
      return new Response(JSON.stringify(envelopeOk([])), { status: 200 });
    });
    const retry: RetryPolicy = {
      maxAttempts: 3,
      decide: (args: { attempt: number; error: unknown; httpStatus?: number }) =>
        args.httpStatus === 503 ? { retry: true, delayMs: 0 } : { retry: false, delayMs: 0 },
    };
    const client = new DataForSeoClient({ credentials: CREDS, fetchImpl, retry });
    await expect(client.post("/v3/test", {})).resolves.toBeDefined();
    expect(calls).toBe(2);
  });

  it("surfaces envelope status_code != 20000 from caller (HTTP 200 + task error)", async () => {
    const fetchImpl = mockFetch(
      () =>
        new Response(
          JSON.stringify({
            ...envelopeOk([]),
            tasks: [{ id: "x", status_code: 40000, status_message: "bad input", result: null }],
          }),
          { status: 200 },
        ),
    );
    const client = new DataForSeoClient({ credentials: CREDS, fetchImpl });
    const cache = new MemoryCache();
    await expect(
      keywordOverview(client, cache, {
        keywords: ["test"],
        location_code: 2528,
        language_code: "nl",
      }),
    ).rejects.toBeInstanceOf(DataForSeoError);
  });
});

describe("keywordOverview", () => {
  it("parses items + caches subsequent calls", async () => {
    let calls = 0;
    const fetchImpl = mockFetch(() => {
      calls++;
      return new Response(
        JSON.stringify(
          envelopeOk([
            {
              keyword: "elektrische deken",
              location_code: 2528,
              language_code: "nl",
              search_volume: 4400,
              cpc: 0.42,
              competition: 0.18,
            },
          ]),
        ),
        { status: 200 },
      );
    });
    const client = new DataForSeoClient({ credentials: CREDS, fetchImpl });
    const cache = new MemoryCache();
    const req = {
      keywords: ["elektrische deken"],
      location_code: 2528 as const,
      language_code: "nl" as const,
    };
    const a = await keywordOverview(client, cache, req);
    const b = await keywordOverview(client, cache, req);
    expect(a).toHaveLength(1);
    expect(a[0]?.search_volume).toBe(4400);
    expect(b).toEqual(a);
    expect(calls).toBe(1); // second call served from cache
  });
});

describe("serpOrganic Standard Queue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts a task and polls until it completes, returning organic items only", async () => {
    let calls = 0;
    const fetchImpl = mockFetch((url) => {
      calls++;
      if (url.endsWith("/task_post")) {
        return new Response(
          JSON.stringify({
            version: "0.1",
            status_code: 20000,
            status_message: "Ok.",
            tasks: [{ id: "abc", status_code: 20100, status_message: "Task Created." }],
          }),
          { status: 200 },
        );
      }
      // task_get — first poll is still queued, second poll returns the result.
      if (calls === 2) {
        return new Response(
          JSON.stringify({
            status_code: 20000,
            status_message: "Ok.",
            tasks: [{ id: "abc", status_code: 40602, status_message: "Task in Progress." }],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          status_code: 20000,
          status_message: "Ok.",
          tasks: [
            {
              id: "abc",
              status_code: 20000,
              status_message: "Ok.",
              result: [
                {
                  items: [
                    { type: "featured_snippet", rank_absolute: 0 },
                    {
                      type: "organic",
                      rank_group: 1,
                      rank_absolute: 1,
                      domain: "example.nl",
                      url: "https://example.nl/x",
                      title: "X",
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    });
    const client = new DataForSeoClient({ credentials: CREDS, fetchImpl });
    const cache = new MemoryCache();
    const promise = serpOrganic(
      client,
      cache,
      { keyword: "test", location_code: 2528, language_code: "nl", depth: 10, mode: "standard" },
      { sleep: async () => {} },
    );
    const items = await promise;
    expect(items).toHaveLength(1);
    expect(items[0]?.domain).toBe("example.nl");
    expect(calls).toBe(3); // post + queued poll + ok poll
  });
});
