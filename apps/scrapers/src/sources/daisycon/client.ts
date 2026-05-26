import {
  DaisyconAuthError,
  DaisyconError,
  type DaisyconTokenResponse,
  daisyconTokenResponse,
} from "./types.js";

// Daisycon REST: https://developers.daisycon.com/api/
// OAuth2 client_credentials at /oauth/access-token; resources under /publishers/{id}/.

const DEFAULT_AUTH_BASE = "https://login.daisycon.com";
const DEFAULT_API_BASE = "https://services.daisycon.com";
const USER_AGENT = "NicheFinder/1.0 (+https://expertgids.nl/about-bot)";
const TOKEN_LEEWAY_S = 60;

export interface DaisyconCredentials {
  clientId: string;
  clientSecret: string;
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

export interface DaisyconClientOptions {
  credentials: DaisyconCredentials;
  authBase?: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  retry?: RetryPolicy;
  now?: () => number;
}

export function defaultDaisyconRetryPolicy(): RetryPolicy {
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

export class DaisyconClient {
  readonly publisherId: string;
  private readonly creds: DaisyconCredentials;
  private readonly authBase: string;
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retry: RetryPolicy;
  private readonly now: () => number;

  private token: DaisyconTokenResponse | null = null;
  private tokenExpiresAtMs = 0;
  private tokenInFlight: Promise<DaisyconTokenResponse> | null = null;

  constructor(opts: DaisyconClientOptions) {
    this.creds = opts.credentials;
    this.publisherId = String(opts.credentials.publisherId);
    this.authBase = opts.authBase ?? DEFAULT_AUTH_BASE;
    this.apiBase = opts.apiBase ?? DEFAULT_API_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.retry = opts.retry ?? defaultDaisyconRetryPolicy();
    this.now = opts.now ?? (() => Date.now());
  }

  private async fetchNewToken(): Promise<DaisyconTokenResponse> {
    const url = `${this.authBase}/oauth/access-token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
    });
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: body.toString(),
    });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new DaisyconAuthError("/oauth/access-token", res.status);
    }
    if (!res.ok) {
      throw new DaisyconError(res.status, "/oauth/access-token", text.slice(0, 200));
    }
    const parsed = daisyconTokenResponse.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new DaisyconError(-1, "/oauth/access-token", parsed.error.message.slice(0, 200));
    }
    return parsed.data;
  }

  async ensureToken(): Promise<string> {
    if (this.token && this.now() < this.tokenExpiresAtMs) return this.token.access_token;
    if (!this.tokenInFlight) {
      this.tokenInFlight = this.fetchNewToken().finally(() => {
        this.tokenInFlight = null;
      });
    }
    const t = await this.tokenInFlight;
    this.token = t;
    this.tokenExpiresAtMs = this.now() + (t.expires_in - TOKEN_LEEWAY_S) * 1000;
    return t.access_token;
  }

  async get(path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
    const qs = query
      ? Object.entries(query)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&")
      : "";
    const url = `${this.apiBase}${path}${qs ? `?${qs}` : ""}`;

    let attempt = 0;
    let lastErr: unknown;
    while (attempt < this.retry.maxAttempts) {
      attempt++;
      try {
        const token = await this.ensureToken();
        const res = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "User-Agent": USER_AGENT,
          },
        });
        if (res.status === 401) {
          this.token = null;
          this.tokenExpiresAtMs = 0;
          if (attempt >= this.retry.maxAttempts) throw new DaisyconAuthError(path);
          continue;
        }
        if (res.status === 403) throw new DaisyconAuthError(path, 403);
        const text = await res.text();
        if (!res.ok) {
          const err = new DaisyconError(res.status, path, text.slice(0, 200));
          lastErr = err;
          const d = this.retry.decide({ attempt, error: err, httpStatus: res.status });
          if (!d.retry || attempt >= this.retry.maxAttempts) throw err;
          await sleep(d.delayMs);
          continue;
        }
        return text ? JSON.parse(text) : null;
      } catch (err) {
        if (err instanceof DaisyconAuthError) throw err;
        lastErr = err;
        const d = this.retry.decide({ attempt, error: err });
        if (!d.retry || attempt >= this.retry.maxAttempts) throw err;
        await sleep(d.delayMs);
      }
    }
    throw lastErr ?? new Error("Daisycon request exhausted retries");
  }
}
