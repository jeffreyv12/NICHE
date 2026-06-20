// Phase 5 — Real registrar-backed CandidateDomainAdapter.
//
// Replaces the stub adapter in promotion.ts with live availability checks:
//   .nl / .be  → TransIP REST API v6 (checkAvailability)
//   .com / .eu → Cloudflare Registrar API (checkDomainAvailability)
//
// Falls back to available=false if the respective client's env vars are not
// set, so the job never crashes on a Hetzner box with partial credentials.
//
// CLAUDE.md #1: no auto-registration ever. This adapter only READS availability.
// The operator confirms a domain in the admin UI before any registration begins.

import type { CandidateDomainAdapter } from "../jobs/promotion.js";
import { type FetchFn as CFFetchFn, CloudflareClient } from "./cloudflare/client.js";
import { type FetchFn as TIFetchFn, TransipClient } from "./transip/client.js";

// ---------------------------------------------------------------------------
// TLD routing tables
// ---------------------------------------------------------------------------

const TRANSIP_TLDS = [".nl", ".be"] as const;
const CLOUDFLARE_TLDS = [".com", ".eu"] as const;

type TransipTld = (typeof TRANSIP_TLDS)[number];
type CloudflareTld = (typeof CLOUDFLARE_TLDS)[number];

function getTld(hostname: string): string {
  const dot = hostname.lastIndexOf(".");
  return dot === -1 ? "" : hostname.slice(dot);
}

function isTransipTld(tld: string): tld is TransipTld {
  return (TRANSIP_TLDS as readonly string[]).includes(tld);
}

function isCloudflareTld(tld: string): tld is CloudflareTld {
  return (CLOUDFLARE_TLDS as readonly string[]).includes(tld);
}

// Hardcoded yearly cost estimates for TLDs where the registrar API doesn't
// return pricing in the availability endpoint.
const TRANSIP_TLD_COST: Record<TransipTld, number> = {
  ".nl": 8,
  ".be": 12,
};

// ---------------------------------------------------------------------------
// Candidate hostname generation
// ---------------------------------------------------------------------------

/** Produces up to 3 candidate hostnames from a niche slug. */
export function generateCandidateHostnames(nicheSlug: string): string[] {
  return [`${nicheSlug}.nl`, `${nicheSlug}.com`, `${nicheSlug}.eu`];
}

// ---------------------------------------------------------------------------
// Real adapter
// ---------------------------------------------------------------------------

export interface RegistrarAdapterOptions {
  cloudflareClient: CloudflareClient | null;
  transipClient: TransipClient | null;
}

/**
 * Build a CandidateDomainAdapter backed by real registrar clients.
 * Each client may be null if credentials aren't configured — those TLDs
 * return available=false rather than throwing.
 */
export function createRegistrarDomainAdapter(
  opts: RegistrarAdapterOptions,
): CandidateDomainAdapter {
  return {
    async getCandidates(nicheSlug) {
      const hostnames = generateCandidateHostnames(nicheSlug);

      const results = await Promise.all(
        hostnames.map(async (hostname) => {
          const tld = getTld(hostname);

          if (isTransipTld(tld) && opts.transipClient) {
            const check = await opts.transipClient.checkAvailability(hostname);
            return {
              hostname,
              registrar: "transip" as const,
              cost_eur_year: TRANSIP_TLD_COST[tld],
              available: check.available,
              tmview_clear: true,
            };
          }

          if (isCloudflareTld(tld) && opts.cloudflareClient) {
            const check = await opts.cloudflareClient.checkDomainAvailability(hostname);
            return {
              hostname,
              registrar: "cloudflare" as const,
              cost_eur_year: check.price_eur_year ?? 12,
              available: check.available,
              tmview_clear: true,
            };
          }

          // No client available for this TLD — return conservative fallback.
          return {
            hostname,
            registrar: isCloudflareTld(tld) ? ("cloudflare" as const) : ("transip" as const),
            cost_eur_year: 12,
            available: false,
            tmview_clear: true,
          };
        }),
      );

      return results;
    },
  };
}

// ---------------------------------------------------------------------------
// Env-based factory
// ---------------------------------------------------------------------------

export interface RegistrarAdapterClients {
  cloudflareClient: CloudflareClient | null;
  transipClient: TransipClient | null;
  /** true when at least one real client was constructed */
  hasRealClients: boolean;
}

/**
 * Attempt to build registrar clients from environment variables.
 * Returns null for each client whose credentials are absent — never throws.
 * Used by the promotion-once bin so a partially-configured box still runs.
 */
export function tryBuildRegistrarClients(overrideFetch?: {
  cf?: CFFetchFn;
  ti?: TIFetchFn;
}): RegistrarAdapterClients {
  let cloudflareClient: CloudflareClient | null = null;
  let transipClient: TransipClient | null = null;

  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  if (cfAccount && cfToken) {
    cloudflareClient = new CloudflareClient({
      accountId: cfAccount,
      apiToken: cfToken,
      fetch: overrideFetch?.cf,
    });
  }

  const tiLogin = process.env.TRANSIP_LOGIN;
  const tiKey = process.env.TRANSIP_PRIVATE_KEY;
  if (tiLogin && tiKey) {
    transipClient = new TransipClient({
      login: tiLogin,
      privateKeyBase64: tiKey,
      fetch: overrideFetch?.ti,
    });
  }

  return {
    cloudflareClient,
    transipClient,
    hasRealClients: cloudflareClient !== null || transipClient !== null,
  };
}

/**
 * Convenience wrapper: build the adapter (or fall back to stub) in one call.
 * The stub is imported lazily to avoid a circular dep at the module level.
 */
export async function tryCreateRegistrarDomainAdapter(): Promise<CandidateDomainAdapter> {
  const clients = tryBuildRegistrarClients();
  if (!clients.hasRealClients) {
    const { createStubDomainAdapter } = await import("../jobs/promotion.js");
    return createStubDomainAdapter();
  }
  return createRegistrarDomainAdapter(clients);
}
