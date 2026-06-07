// Phase 5.1 — Cloudflare Registrar + DNS client.
//
// Used for .com / .eu / .be domains. Cloudflare Registrar is at-cost
// (no markup). Credentials: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN.
//
// HTTP adapter is injectable so tests never make real API calls.

export type FetchFn = typeof fetch;

export interface CloudflareClientOptions {
  accountId: string;
  apiToken: string;
  fetch?: FetchFn;
}

export interface DomainAvailability {
  hostname: string;
  available: boolean;
  price_eur_year: number | null;
}

export interface RegisteredDomain {
  id: string;
  hostname: string;
  expires_at: string;
}

export interface DnsZone {
  id: string;
  name: string;
}

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
}

const CF_BASE = "https://api.cloudflare.com/client/v4";

export class CloudflareClient {
  private accountId: string;
  private token: string;
  private fetch: FetchFn;

  constructor(opts: CloudflareClientOptions) {
    this.accountId = opts.accountId;
    this.token = opts.apiToken;
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetch(`${CF_BASE}${path}`, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as { success: boolean; result: T; errors?: unknown[] };
    if (!json.success) {
      throw new Error(`Cloudflare API error on ${method} ${path}: ${JSON.stringify(json.errors)}`);
    }
    return json.result;
  }

  // -------------------------------------------------------------------------
  // Registrar
  // -------------------------------------------------------------------------

  async checkDomainAvailability(hostname: string): Promise<DomainAvailability> {
    try {
      const result = await this.req<{ name: string; supported: boolean; price?: number }>(
        "GET",
        `/accounts/${this.accountId}/registrar/domains/${encodeURIComponent(hostname)}`,
      );
      return {
        hostname,
        available: result.supported && !result.name,
        price_eur_year: result.price ?? null,
      };
    } catch {
      return { hostname, available: false, price_eur_year: null };
    }
  }

  async registerDomain(hostname: string, autoRenew = true): Promise<RegisteredDomain> {
    const result = await this.req<{ id: string; name: string; expires_at: string }>(
      "POST",
      `/accounts/${this.accountId}/registrar/domains/${encodeURIComponent(hostname)}`,
      { auto_renew: autoRenew },
    );
    return { id: result.id, hostname: result.name, expires_at: result.expires_at };
  }

  // -------------------------------------------------------------------------
  // DNS
  // -------------------------------------------------------------------------

  async createZone(hostname: string): Promise<DnsZone> {
    const result = await this.req<{ id: string; name: string }>("POST", "/zones", {
      name: hostname,
      account: { id: this.accountId },
      jump_start: false,
      type: "full",
    });
    return { id: result.id, name: result.name };
  }

  async getZone(hostname: string): Promise<DnsZone | null> {
    const result = await this.req<Array<{ id: string; name: string }>>(
      "GET",
      `/zones?name=${encodeURIComponent(hostname)}&account.id=${encodeURIComponent(this.accountId)}`,
    );
    return result[0] ?? null;
  }

  async createARecord(zoneId: string, name: string, ipv4: string): Promise<DnsRecord> {
    const r = await this.req<{ id: string; type: string; name: string; content: string }>(
      "POST",
      `/zones/${zoneId}/dns_records`,
      { type: "A", name, content: ipv4, ttl: 1, proxied: true },
    );
    return r;
  }

  async createCnameRecord(zoneId: string, name: string, target: string): Promise<DnsRecord> {
    const r = await this.req<{ id: string; type: string; name: string; content: string }>(
      "POST",
      `/zones/${zoneId}/dns_records`,
      { type: "CNAME", name, content: target, ttl: 1, proxied: true },
    );
    return r;
  }

  async createTxtRecord(zoneId: string, name: string, content: string): Promise<DnsRecord> {
    const r = await this.req<{ id: string; type: string; name: string; content: string }>(
      "POST",
      `/zones/${zoneId}/dns_records`,
      { type: "TXT", name, content, ttl: 300, proxied: false },
    );
    return r;
  }
}

export function createCloudflareClient(overrideFetch?: FetchFn): CloudflareClient {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set");
  }
  return new CloudflareClient({ accountId, apiToken, fetch: overrideFetch });
}
