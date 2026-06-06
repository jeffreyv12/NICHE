// Phase 3.2.5 — daily conversion reconciliation.
//
// Pulls confirmed/updated transactions from each network's reporting API and
// merges them into `conversions` (idempotent on network + transaction id). This
// is the batch counterpart to the real-time webhook: postbacks give the early
// signal, reconciliation corrects status (pending → approved → reversed) and
// backfills anything the postback missed.
//
// Network access is behind an injected ReportingAdapter so the job is unit-
// testable without live credentials; createDefaultReportingAdapter wires the
// real Bol/Awin/Daisycon source clients from env.

import type { ServiceDb } from "@nichefinder/db";
import {
  type AffiliateNetwork,
  type Env,
  type NormalizedConversion,
  ingestConversion,
  moneyToCents,
  toIso,
} from "@nichefinder/shared";
import * as awin from "../sources/awin/index.js";
import type { AwinTransaction } from "../sources/awin/types.js";
import * as bol from "../sources/bol/index.js";
import type { BolAffiliateTransaction } from "../sources/bol/types.js";
import * as daisycon from "../sources/daisycon/index.js";
import type { DaisyconTransaction } from "../sources/daisycon/types.js";
import { createDrizzleConversionStore } from "./conversionStore.js";

// -----------------------------------------------------------------------------
// Reporting adapter seam
// -----------------------------------------------------------------------------

export interface ReportingWindow {
  /** Inclusive lower bound, yyyy-mm-dd. */
  startDate: string;
  /** Inclusive upper bound, yyyy-mm-dd. */
  endDate: string;
}

export interface ReportingAdapter {
  /** Return normalized conversions for the window, or [] if not configured. */
  fetchTransactions(
    network: AffiliateNetwork,
    window: ReportingWindow,
  ): Promise<NormalizedConversion[]>;
}

/** Networks that expose a reporting/transactions API we reconcile against. */
export const RECONCILIATION_NETWORKS: AffiliateNetwork[] = ["bol", "awin", "daisycon"];

// -----------------------------------------------------------------------------
// Source transaction → NormalizedConversion
// -----------------------------------------------------------------------------

export function normalizeBolTransaction(t: BolAffiliateTransaction): NormalizedConversion {
  return {
    networkTransactionId: String(t.id),
    subid: t.subId ?? null,
    // Bol Affiliate Reporting v2 (our subset) reports commission, not order value.
    amountCents: 0,
    commissionCents: moneyToCents(t.commission),
    currency: "EUR",
    occurredAt: toIso(t.orderDate ?? t.clickDate),
    rawStatus: t.status,
    productExternalId: t.productEan,
    raw: t,
  };
}

export function normalizeAwinTransaction(t: AwinTransaction): NormalizedConversion {
  const clickRef = t.clickRefs?.clickRef;
  return {
    networkTransactionId: String(t.id),
    subid: typeof clickRef === "string" ? clickRef : null,
    amountCents: moneyToCents(t.saleAmount?.amount),
    commissionCents: moneyToCents(t.commissionAmount?.amount),
    currency: t.saleAmount?.currency ?? "EUR",
    occurredAt: toIso(t.transactionDate),
    rawStatus: t.commissionStatus,
    raw: t,
  };
}

export function normalizeDaisyconTransaction(t: DaisyconTransaction): NormalizedConversion {
  return {
    networkTransactionId: String(t.id),
    subid: t.sub_id ?? null,
    amountCents: moneyToCents(t.revenue_total),
    commissionCents: moneyToCents(t.commission_total),
    currency: "EUR",
    occurredAt: toIso(t.sale_date),
    rawStatus: t.status,
    raw: t,
  };
}

/**
 * The production adapter: builds each network's client from env and pulls the
 * window. A network with missing credentials yields [] (skipped, not an error).
 */
export function createDefaultReportingAdapter(env: Env): ReportingAdapter {
  return {
    async fetchTransactions(network, window) {
      if (network === "bol") {
        if (!env.BOL_PARTNER_CLIENT_ID || !env.BOL_PARTNER_CLIENT_SECRET) return [];
        const client = new bol.BolClient({
          credentials: {
            clientId: env.BOL_PARTNER_CLIENT_ID,
            clientSecret: env.BOL_PARTNER_CLIENT_SECRET,
          },
        });
        const res = await bol.listTransactions(client, {
          startDate: window.startDate,
          endDate: window.endDate,
        });
        return res.transactions.map(normalizeBolTransaction);
      }

      if (network === "awin") {
        if (!env.AWIN_API_TOKEN || !env.AWIN_PUBLISHER_ID) return [];
        const client = new awin.AwinClient({
          credentials: { apiToken: env.AWIN_API_TOKEN, publisherId: env.AWIN_PUBLISHER_ID },
        });
        const res = await awin.listTransactions(client, {
          startDate: `${window.startDate}T00:00:00`,
          endDate: `${window.endDate}T23:59:59`,
        });
        return res.map(normalizeAwinTransaction);
      }

      if (network === "daisycon") {
        if (!env.DAISYCON_CLIENT_ID || !env.DAISYCON_CLIENT_SECRET || !env.DAISYCON_PUBLISHER_ID) {
          return [];
        }
        const client = new daisycon.DaisyconClient({
          credentials: {
            clientId: env.DAISYCON_CLIENT_ID,
            clientSecret: env.DAISYCON_CLIENT_SECRET,
            publisherId: env.DAISYCON_PUBLISHER_ID,
          },
        });
        const res = await daisycon.listTransactions(client, {
          start_date: window.startDate,
          end_date: window.endDate,
        });
        return res.map(normalizeDaisyconTransaction);
      }

      return [];
    },
  };
}

// -----------------------------------------------------------------------------
// Job
// -----------------------------------------------------------------------------

export interface RunReconciliationJobOptions {
  db: ServiceDb;
  adapter: ReportingAdapter;
  /** Networks to reconcile. Default: RECONCILIATION_NETWORKS. */
  networks?: AffiliateNetwork[];
  /** How far back to pull. Default 3 days (covers late confirmations + retries). */
  windowDays?: number;
  /** ISO timestamp the window ends at. Default now. */
  asOf?: string;
}

export interface NetworkReconResult {
  fetched: number;
  inserted: number;
  updated: number;
  unlinked: number;
}

export interface RunReconciliationJobResult {
  byNetwork: Record<string, NetworkReconResult>;
  failures: Array<{ network: string; error: string }>;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function runReconciliationJob(
  opts: RunReconciliationJobOptions,
): Promise<RunReconciliationJobResult> {
  const networks = opts.networks ?? RECONCILIATION_NETWORKS;
  const windowDays = opts.windowDays ?? 3;
  const asOf = opts.asOf ?? new Date().toISOString();
  const endMs = new Date(asOf).getTime();
  const window: ReportingWindow = {
    startDate: ymd(new Date(endMs - windowDays * 86_400_000)),
    endDate: ymd(new Date(endMs)),
  };

  const store = createDrizzleConversionStore(opts.db);
  const result: RunReconciliationJobResult = { byNetwork: {}, failures: [] };

  for (const network of networks) {
    const tally: NetworkReconResult = { fetched: 0, inserted: 0, updated: 0, unlinked: 0 };
    try {
      const transactions = await opts.adapter.fetchTransactions(network, window);
      tally.fetched = transactions.length;
      for (const normalized of transactions) {
        const r = await ingestConversion({ store, network, normalized, receivedAt: asOf });
        if (r.status === "unlinked") tally.unlinked += 1;
        else if (r.action === "inserted") tally.inserted += 1;
        else tally.updated += 1;
      }
      result.byNetwork[network] = tally;
    } catch (err) {
      result.byNetwork[network] = tally;
      result.failures.push({ network, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
