// Phase 5.3 — Vercel Domains API client.
//
// Attaches a custom domain to the NicheFinder Vercel project after DNS
// is ready. Also polls SSL provisioning state.
// Credentials: VERCEL_API_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID.

export type FetchFn = typeof fetch;

export interface VercelClientOptions {
  apiToken: string;
  teamId: string;
  projectId: string;
  fetch?: FetchFn;
}

export interface VercelDomainAttachment {
  name: string;
  verified: boolean;
}

export interface VercelSslStatus {
  hostname: string;
  /** 'pending' | 'active' | 'error' */
  status: string;
}

const VERCEL_BASE = "https://api.vercel.com";

export class VercelClient {
  private token: string;
  private teamId: string;
  private projectId: string;
  private fetch: FetchFn;

  constructor(opts: VercelClientOptions) {
    this.token = opts.apiToken;
    this.teamId = opts.teamId;
    this.projectId = opts.projectId;
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  private qs(extra?: Record<string, string>): string {
    const p = new URLSearchParams({ teamId: this.teamId, ...extra });
    return `?${p.toString()}`;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetch(`${VERCEL_BASE}${path}${this.qs()}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Vercel ${method} ${path}: ${res.status} ${text}`);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // -------------------------------------------------------------------------
  // Domains
  // -------------------------------------------------------------------------

  async attachDomain(hostname: string): Promise<VercelDomainAttachment> {
    const result = await this.req<{ name: string; verified: boolean }>(
      "POST",
      `/v9/projects/${encodeURIComponent(this.projectId)}/domains`,
      { name: hostname },
    );
    return result;
  }

  async getDomainStatus(hostname: string): Promise<VercelSslStatus> {
    const result = await this.req<{
      name: string;
      verification?: Array<{ type: string; value: string }>;
      verified?: boolean;
    }>(
      "GET",
      `/v9/projects/${encodeURIComponent(this.projectId)}/domains/${encodeURIComponent(hostname)}`,
    );

    return {
      hostname,
      status: result.verified ? "active" : "pending",
    };
  }

  /** Poll until SSL is active or timeout expires. Resolves true on success. */
  async pollSslUntilActive(
    hostname: string,
    timeoutMs = 5 * 60 * 1_000,
    intervalMs = 10_000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.getDomainStatus(hostname);
      if (status.status === "active") return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  async removeDomain(hostname: string): Promise<void> {
    await this.req<void>(
      "DELETE",
      `/v9/projects/${encodeURIComponent(this.projectId)}/domains/${encodeURIComponent(hostname)}`,
    );
  }
}

export function createVercelClient(overrideFetch?: FetchFn): VercelClient {
  const apiToken = process.env.VERCEL_API_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!apiToken || !teamId || !projectId) {
    throw new Error("VERCEL_API_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID must be set");
  }
  return new VercelClient({ apiToken, teamId, projectId, fetch: overrideFetch });
}
