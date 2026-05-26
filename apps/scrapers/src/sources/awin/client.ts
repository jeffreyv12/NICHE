import { AwinAuthError, AwinError } from "./types.js";

// Awin's Publisher API uses a long-lived bearer token issued from the
// publisher account UI (no OAuth refresh flow). We treat it as opaque.
//
// Base: https://api.awin.com. Endpoints we care about:
//   GET /publishers/{publisherId}/programmes
//   GET /publishers/{publisherId}/transactions/

const DEFAULT_BASE = "https://api.awin.com";
const USER_AGENT = "NicheFinder/1.0 (+https://expertgids.nl/about-bot)";

export interface AwinCredentials {
  /** Publisher API token from the Awin publisher dashboard. */
  apiToken: string;
  /** Numeric publisher id ("affiliate id"). */
  publisherId: string | number;
}

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
}
export interface RetryPolicy {
  maxAttempts: number;
  decide(args: { attempt: number; error: unknown; httpStatus?: number }): RetryDecision;
}

export interface AwinClientOptions {
  credentials: AwinCredentials;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  retry?: RetryPolicy;
}

export function defaultAwinRetryPolicy(): RetryPolicy {
  const baseMs = 500;
  return {
    maxAttempts: 4,
    decide({ attempt, httpStatus }) {
      const retryable =
        httpStatus === undefined || httpStatus === 429 || (httpStatus >= 500 && httpStatus < 600);
      if (!retryable) return { retry: false, delayMs: 0 };
      const cap = baseMs * 2 ** Math.min(attempt, 6);
      return { retry: true, delayMs: Math.floor(Math.random() * cap) };
    },
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class AwinClient {
  readonly publisherId: string;
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retry: RetryPolicy;

  constructor(opts: AwinClientOptions) {
    this.token = opts.credentials.apiToken;
    this.publisherId = String(opts.credentials.publisherId);
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.retry = opts.retry ?? defaultAwinRetryPolicy();
  }

  async get(path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
    const qs = query
      ? Object.entries(query)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&")
      : "";
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;

    let attempt = 0;
    let lastErr: unknown;
    while (attempt < this.retry.maxAttempts) {
      attempt++;
      try {
        const res = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/json",
            "User-Agent": USER_AGENT,
          },
        });
        if (res.status === 401 || res.status === 403) {
          throw new AwinAuthError(path, res.status);
        }
        const text = await res.text();
        if (!res.ok) {
          const err = new AwinError(res.status, path, text.slice(0, 200));
          lastErr = err;
          const d = this.retry.decide({ attempt, error: err, httpStatus: res.status });
          if (!d.retry || attempt >= this.retry.maxAttempts) throw err;
          await sleep(d.delayMs);
          continue;
        }
        return text ? JSON.parse(text) : null;
      } catch (err) {
        if (err instanceof AwinAuthError) throw err;
        lastErr = err;
        const d = this.retry.decide({ attempt, error: err });
        if (!d.retry || attempt >= this.retry.maxAttempts) throw err;
        await sleep(d.delayMs);
      }
    }
    throw lastErr ?? new Error("Awin request exhausted retries");
  }
}
