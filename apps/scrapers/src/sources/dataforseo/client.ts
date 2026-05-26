import { DataForSeoAuthError, DataForSeoError, dfsResponseEnvelope } from "./types.js";

// DataForSEO uses HTTP Basic Auth. Their API base is api.dataforseo.com; the
// per-endpoint path is composed by the caller, e.g.
// `/v3/dataforseo_labs/google/keyword_overview/live`.

const DEFAULT_BASE = "https://api.dataforseo.com";

export interface DataForSeoCredentials {
  login: string;
  password: string;
}

export interface DataForSeoClientOptions {
  credentials: DataForSeoCredentials;
  baseUrl?: string;
  // Allows tests to inject a mock. Defaults to globalThis.fetch.
  fetchImpl?: typeof fetch;
  // Caller-controlled retry policy. See retry.ts for the shape and the
  // contract we expect — the operator (you!) decides the defaults.
  retry?: RetryPolicy;
}

// ---------------------------------------------------------------------------
// Retry policy contract — implementation lives in retry.ts
// ---------------------------------------------------------------------------

export interface RetryDecision {
  retry: boolean;
  // milliseconds to wait before the next attempt; ignored when retry=false
  delayMs: number;
}

export interface RetryPolicy {
  // Maximum *total* attempts including the first try. 1 = no retries.
  maxAttempts: number;
  // Called after each failed attempt; returns a decision for the next one.
  // `attempt` is 1-based and refers to the attempt that just failed.
  decide(args: {
    attempt: number;
    error: unknown;
    httpStatus?: number;
  }): RetryDecision;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function authHeader(creds: DataForSeoCredentials): string {
  const token = Buffer.from(`${creds.login}:${creds.password}`).toString("base64");
  return `Basic ${token}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class DataForSeoClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retry: RetryPolicy;
  private readonly creds: DataForSeoCredentials;

  constructor(opts: DataForSeoClientOptions) {
    this.creds = opts.credentials;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.retry = opts.retry ?? defaultRetryPolicy();
  }

  // POST is the universal verb for DataForSEO — both Labs Live and Standard
  // Queue task_post/task_get use POST with a JSON array body wrapping a
  // single object. The envelope is the same shape across endpoints.
  async post(endpoint: string, body: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${endpoint}`;
    const init: RequestInit = {
      method: "POST",
      headers: {
        Authorization: authHeader(this.creds),
        "Content-Type": "application/json",
        "User-Agent": "NicheFinder/1.0 (+https://expertgids.nl/about-bot)",
      },
      body: JSON.stringify(Array.isArray(body) ? body : [body]),
    };

    let attempt = 0;
    let lastErr: unknown;
    while (attempt < this.retry.maxAttempts) {
      attempt++;
      try {
        const res = await this.fetchImpl(url, init);
        if (res.status === 401 || res.status === 403) {
          throw new DataForSeoAuthError(endpoint);
        }
        const text = await res.text();
        if (!res.ok) {
          lastErr = new DataForSeoError(res.status, text.slice(0, 200), endpoint);
          const d = this.retry.decide({ attempt, error: lastErr, httpStatus: res.status });
          if (!d.retry || attempt >= this.retry.maxAttempts) throw lastErr;
          await sleep(d.delayMs);
          continue;
        }
        const json = JSON.parse(text);
        const env = dfsResponseEnvelope.safeParse(json);
        if (!env.success) {
          throw new DataForSeoError(
            -1,
            `unparseable envelope: ${env.error.message.slice(0, 200)}`,
            endpoint,
          );
        }
        return env.data;
      } catch (err) {
        lastErr = err;
        if (err instanceof DataForSeoAuthError) throw err;
        const d = this.retry.decide({ attempt, error: err });
        if (!d.retry || attempt >= this.retry.maxAttempts) throw err;
        await sleep(d.delayMs);
      }
    }
    throw lastErr ?? new Error("DataForSEO request exhausted retries");
  }
}

// ---------------------------------------------------------------------------
// Default retry policy — TODO(user)
// ---------------------------------------------------------------------------

// Retry only on 429 and 5xx; network errors (no httpStatus) also retryable.
// Exponential backoff with full jitter (AWS-style): delay = rand(0, base * 2^n).
export function defaultRetryPolicy(): RetryPolicy {
  const baseMs = 500;
  const maxAttempts = 4;
  return {
    maxAttempts,
    decide({ attempt, httpStatus }) {
      const retryable =
        httpStatus === undefined || httpStatus === 429 || (httpStatus >= 500 && httpStatus < 600);
      if (!retryable) return { retry: false, delayMs: 0 };
      const cap = baseMs * 2 ** Math.min(attempt, 6);
      const delayMs = Math.floor(Math.random() * cap);
      return { retry: true, delayMs };
    },
  };
}
