// Phase 5.2 — TransIP REST API v6 client.
//
// Used for .nl and .be domains (SIDN-accredited). Authentication uses
// a short-lived JWT signed with an RSA private key stored base64-encoded
// in TRANSIP_PRIVATE_KEY. Token is cached for ~29 minutes.
//
// HTTP adapter is injectable so tests never make real API calls.

import { createHash, createSign } from "node:crypto";

export type FetchFn = typeof fetch;

export interface TransipClientOptions {
  login: string;
  /** Base64-encoded PEM private key (PKCS#8 or PKCS#1). */
  privateKeyBase64: string;
  fetch?: FetchFn;
}

export interface TransipDomainAvailability {
  hostname: string;
  /** 'free' | 'registered' | 'in_transfer' */
  status: string;
  price_eur_year: number | null;
}

export interface TransipWhoisResult {
  hostname: string;
  available: boolean;
  price_eur_year: number | null;
}

const TRANSIP_BASE = "https://api.transip.nl/v6";
const TOKEN_TTL_MS = 29 * 60 * 1_000;

export class TransipClient {
  private login: string;
  private privateKey: string;
  private fetch: FetchFn;
  private cachedToken: string | null = null;
  private tokenExpiry = 0;

  constructor(opts: TransipClientOptions) {
    this.login = opts.login;
    // Decode from base64 to PEM string
    this.privateKey = Buffer.from(opts.privateKeyBase64, "base64").toString("utf-8");
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  private buildAuthBody(): string {
    const nonce = createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 16);
    const body = JSON.stringify({
      login: this.login,
      nonce,
      read_only: false,
      expiration_time: "30 minutes",
      label: `nichefinder-${Date.now()}`,
      global_key: false,
    });
    const sign = createSign("RSA-SHA512");
    sign.update(body);
    const signature = sign.sign(this.privateKey, "base64");
    return JSON.stringify({ ...JSON.parse(body), signature });
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiry) {
      return this.cachedToken;
    }
    const res = await this.fetch(`${TRANSIP_BASE}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: this.buildAuthBody(),
    });
    if (!res.ok) {
      throw new Error(`TransIP auth failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { token: string };
    this.cachedToken = json.token;
    this.tokenExpiry = Date.now() + TOKEN_TTL_MS;
    return this.cachedToken;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.getToken();
    const res = await this.fetch(`${TRANSIP_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`TransIP ${method} ${path} failed: ${res.status} ${text}`);
    }
    // TransIP answers successful writes (register domain, add DNS entry) with
    // 201 Created and an empty body — guard against JSON.parse("") throwing.
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // -------------------------------------------------------------------------
  // Domains
  // -------------------------------------------------------------------------

  async checkAvailability(hostname: string): Promise<TransipWhoisResult> {
    try {
      const result = await this.req<{ status: string; actions?: string[] }>(
        "GET",
        `/domains/whois?domainName=${encodeURIComponent(hostname)}`,
      );
      return {
        hostname,
        available: result.status === "free",
        price_eur_year: null,
      };
    } catch {
      return { hostname, available: false, price_eur_year: null };
    }
  }

  async registerDomain(hostname: string): Promise<void> {
    await this.req<void>("POST", "/domains", {
      domain: {
        name: hostname,
        contacts: [],
        nameservers: [],
        dnsEntries: [],
      },
    });
  }

  async addDnsEntry(
    hostname: string,
    type: "A" | "CNAME" | "TXT",
    name: string,
    content: string,
    ttl = 300,
  ): Promise<void> {
    await this.req<void>("POST", `/domains/${encodeURIComponent(hostname)}/dns`, {
      dnsEntry: { name, type, expire: ttl, content },
    });
  }
}

export function createTransipClient(overrideFetch?: FetchFn): TransipClient {
  const login = process.env.TRANSIP_LOGIN;
  const privateKeyBase64 = process.env.TRANSIP_PRIVATE_KEY;
  if (!login || !privateKeyBase64) {
    throw new Error("TRANSIP_LOGIN and TRANSIP_PRIVATE_KEY must be set");
  }
  return new TransipClient({ login, privateKeyBase64, fetch: overrideFetch });
}
