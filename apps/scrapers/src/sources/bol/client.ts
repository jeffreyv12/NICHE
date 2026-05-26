import {
  BolAuthError,
  BolError,
  type BolTokenResponse,
  bolErrorBody,
  bolTokenResponse,
} from "./types.js";

// Bol.com splits endpoints across hosts:
//   - login.bol.com/token   → OAuth2 token endpoint (form-encoded)
//   - api.bol.com           → resource endpoints (JSON)
// Accept header carries the API version: application/vnd.advertiser.v10+json
// for Marketing Catalog, application/vnd.affiliate.v2+json for Reporting.

const DEFAULT_AUTH_BASE = "https://login.bol.com";
const DEFAULT_API_BASE = "https://api.bol.com";
const USER_AGENT = "NicheFinder/1.0 (+https://expertgids.nl/about-bot)";

// Refresh the access token this many seconds before its true expiry.
// 60s gives us a safety margin against clock skew + in-flight requests.
const TOKEN_REFRESH_LEEWAY_S = 60;

export interface BolCredentials {
  clientId: string;
  clientSecret: string;
}

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
}
export interface RetryPolicy {
  maxAttempts: number;
  decide(args: { attempt: number; error: unknown; httpStatus?: number }): RetryDecision;
}

export interface BolClientOptions {
  credentials: BolCredentials;
  authBase?: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  retry?: RetryPolicy;
  now?: () => number; // injection seam for token-expiry tests
}

// Same default policy shape as DataForSEO: exponential backoff with full
// jitter on 429/5xx/network. Bol gets rate-limit-y on the Marketing Catalog
// during nightly batch runs.
export function defaultBolRetryPolicy(): RetryPolicy {
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

export class BolClient {
  private readonly creds: BolCredentials;
  private readonly authBase: string;
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retry: RetryPolicy;
  private readonly now: () => number;

  // Cached token; we own its lifetime so callers never see a stale 401.
  private token: BolTokenResponse | null = null;
  private tokenExpiresAtMs = 0;
  private tokenInFlight: Promise<BolTokenResponse> | null = null;

  constructor(opts: BolClientOptions) {
    this.creds = opts.credentials;
    this.authBase = opts.authBase ?? DEFAULT_AUTH_BASE;
    this.apiBase = opts.apiBase ?? DEFAULT_API_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.retry = opts.retry ?? defaultBolRetryPolicy();
    this.now = opts.now ?? (() => Date.now());
  }

  // ---- Token management -------------------------------------------------

  private isTokenFresh(): boolean {
    return this.token !== null && this.now() < this.tokenExpiresAtMs;
  }

  private async fetchNewToken(): Promise<BolTokenResponse> {
    const url = `${this.authBase}/token`;
    const basic = Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString(
      "base64",
    );
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: "grant_type=client_credentials",
    });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new BolAuthError("/token", res.status);
    }
    if (!res.ok) {
      throw new BolError(res.status, "/token", { detail: text.slice(0, 200) });
    }
    const parsed = bolTokenResponse.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new BolError(-1, "/token", { detail: parsed.error.message.slice(0, 200) });
    }
    return parsed.data;
  }

  /** Public so tests + callers can force-refresh; normally call request(). */
  async ensureToken(): Promise<string> {
    if (this.isTokenFresh() && this.token) return this.token.access_token;
    // Single-flight: collapse concurrent callers onto one network round trip.
    if (!this.tokenInFlight) {
      this.tokenInFlight = this.fetchNewToken().finally(() => {
        this.tokenInFlight = null;
      });
    }
    const t = await this.tokenInFlight;
    this.token = t;
    this.tokenExpiresAtMs = this.now() + (t.expires_in - TOKEN_REFRESH_LEEWAY_S) * 1000;
    return t.access_token;
  }

  // ---- Authenticated request -------------------------------------------

  async request(
    method: "GET" | "POST",
    path: string,
    opts: { accept: string; query?: Record<string, string | number | undefined>; body?: unknown },
  ): Promise<unknown> {
    const qs =
      opts.query &&
      Object.entries(opts.query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&");
    const url = `${this.apiBase}${path}${qs ? `?${qs}` : ""}`;

    let attempt = 0;
    let lastErr: unknown;
    while (attempt < this.retry.maxAttempts) {
      attempt++;
      try {
        const token = await this.ensureToken();
        const res = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: opts.accept,
            "Content-Type": opts.body ? "application/json" : "",
            "User-Agent": USER_AGENT,
          },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
        });

        // Token expired mid-flight: drop cache + one retry inside the loop.
        if (res.status === 401) {
          this.token = null;
          this.tokenExpiresAtMs = 0;
          const d = this.retry.decide({ attempt, error: null, httpStatus: 401 });
          if (attempt >= this.retry.maxAttempts) throw new BolAuthError(path);
          if (d.delayMs > 0) await sleep(d.delayMs);
          continue;
        }
        if (res.status === 403) throw new BolAuthError(path, 403);

        const text = await res.text();
        if (!res.ok) {
          const parsed = bolErrorBody.safeParse(text ? JSON.parse(text) : {});
          const err = new BolError(res.status, path, parsed.success ? parsed.data : undefined);
          lastErr = err;
          const d = this.retry.decide({ attempt, error: err, httpStatus: res.status });
          if (!d.retry || attempt >= this.retry.maxAttempts) throw err;
          await sleep(d.delayMs);
          continue;
        }
        return text ? JSON.parse(text) : {};
      } catch (err) {
        if (err instanceof BolAuthError) throw err;
        lastErr = err;
        const d = this.retry.decide({ attempt, error: err });
        if (!d.retry || attempt >= this.retry.maxAttempts) throw err;
        await sleep(d.delayMs);
      }
    }
    throw lastErr ?? new Error("Bol request exhausted retries");
  }
}
