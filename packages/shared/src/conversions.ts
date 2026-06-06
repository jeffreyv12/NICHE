// Phase 3.2 — network-agnostic conversion ingestion core.
//
// One code path turns an affiliate conversion (from a real-time postback OR the
// daily reconciliation pull) into a `conversions` row:
//
//   normalized payload → resolve links (subid → affiliate_link → click/page)
//                       → idempotent upsert keyed on (network, transaction_id)
//
// The DB is reached through an injected ConversionStore, so this module is pure
// and testable in @nichefinder/shared, and the same logic backs both
// apps/web (supabase store) and apps/scrapers (drizzle store).

import type { AffiliateNetwork } from "./constants";

// =============================================================================
// Types
// =============================================================================

/** Network payload reduced to the fields we persist. Source-format agnostic. */
export interface NormalizedConversion {
  /** The network's own transaction id — the idempotency key with `network`. */
  networkTransactionId: string;
  /** Our `[tenant]:[page]:[cohort]` tracking key, if the network echoed it. */
  subid: string | null;
  /** Order value in cents (EUR). */
  amountCents: number;
  /** Our commission in cents (EUR). */
  commissionCents: number;
  currency: string;
  /** ISO timestamp of the sale, or "" when the payload omitted it. */
  occurredAt: string;
  /** Raw network status string (un-canonicalised). */
  rawStatus?: string;
  productExternalId?: string;
  /** The untouched payload, stored for audit/debug. */
  raw: unknown;
}

/** Attribution resolved from a subid. tenantId is always known when the
 *  affiliate_link exists; clickId/pageId are best-effort (a click may not have
 *  been logged, or carried no page id). */
export interface ConversionLinks {
  tenantId: string;
  affiliateLinkId: string;
  clickId: string | null;
  pageId: string | null;
}

/** The row handed to the store for upsert. */
export interface ConversionUpsert {
  tenantId: string;
  network: AffiliateNetwork;
  networkTransactionId: string;
  affiliateLinkId: string | null;
  clickId: string | null;
  pageId: string | null;
  productExternalId: string | null;
  amountCents: number;
  commissionCents: number;
  currency: string;
  occurredAt: string;
  status: string;
  raw: unknown;
}

export interface ConversionStore {
  /** Resolve attribution from a subid, or null if the subid is unknown. */
  resolveLinks(network: AffiliateNetwork, subid: string): Promise<ConversionLinks | null>;
  /** Insert, or update on the (network, networkTransactionId) conflict. */
  upsertConversion(row: ConversionUpsert): Promise<{ action: "inserted" | "updated" }>;
}

export type IngestResult =
  | { status: "stored"; action: "inserted" | "updated"; pageId: string | null }
  | { status: "unlinked"; reason: "no_subid" | "unknown_subid" };

// =============================================================================
// Ingestion
// =============================================================================

export interface IngestConversionArgs {
  store: ConversionStore;
  network: AffiliateNetwork;
  normalized: NormalizedConversion;
  /** Fallback timestamp when the payload omitted the sale date. */
  receivedAt: string;
}

/**
 * Resolve attribution and upsert the conversion. Returns "unlinked" (without
 * writing) when the subid is missing or unknown — conversions.tenant_id is NOT
 * NULL, so an unattributable conversion cannot be stored. Callers should log
 * unlinked results rather than drop them silently.
 */
export async function ingestConversion(args: IngestConversionArgs): Promise<IngestResult> {
  const { store, network, normalized, receivedAt } = args;

  if (!normalized.subid) return { status: "unlinked", reason: "no_subid" };

  const links = await store.resolveLinks(network, normalized.subid);
  if (!links) return { status: "unlinked", reason: "unknown_subid" };

  const { action } = await store.upsertConversion({
    tenantId: links.tenantId,
    network,
    networkTransactionId: normalized.networkTransactionId,
    affiliateLinkId: links.affiliateLinkId,
    clickId: links.clickId,
    pageId: links.pageId,
    productExternalId: normalized.productExternalId ?? null,
    amountCents: normalized.amountCents,
    commissionCents: normalized.commissionCents,
    currency: normalized.currency || "EUR",
    occurredAt: normalized.occurredAt || receivedAt,
    status: normalized.rawStatus ?? "pending",
    raw: normalized.raw,
  });

  return { status: "stored", action, pageId: links.pageId };
}

// =============================================================================
// Postback parsing — inbound real-time conversion pings.
// =============================================================================
//
// Field names below are the documented postback parameters per network, with
// tolerant fallbacks. They MUST be verified against each network's live
// postback configuration (docs/DATA_SOURCES.md) before go-live — the mechanism
// is what is tested here, not the exact vocabulary of any one network.

interface FieldMap {
  txn: string[];
  subid: string[];
  amount: string[];
  commission: string[];
  status: string[];
  date: string[];
  currency: string[];
  product: string[];
}

const FIELD_MAPS: Record<AffiliateNetwork, FieldMap> = {
  bol: {
    txn: ["transactionId", "id"],
    subid: ["subId", "subid"],
    amount: ["amount", "total"],
    commission: ["commission"],
    status: ["status"],
    date: ["orderDate", "clickDate", "date"],
    currency: ["currency"],
    product: ["productEan", "ean"],
  },
  awin: {
    txn: ["transactionId", "id"],
    subid: ["clickRef", "clickref", "subId"],
    amount: ["saleAmount", "amount"],
    commission: ["commissionAmount", "commission"],
    status: ["commissionStatus", "status"],
    date: ["transactionDate", "date"],
    currency: ["currency", "currencyCode"],
    product: ["productId"],
  },
  daisycon: {
    txn: ["id", "transaction_id"],
    subid: ["sub_id", "subid"],
    amount: ["revenue_total", "amount"],
    commission: ["commission_total", "commission"],
    status: ["status"],
    date: ["sale_date", "date"],
    currency: ["currency"],
    product: ["product_id"],
  },
  digistore24: {
    txn: ["order_id", "transaction_id"],
    subid: ["custom", "tracking", "subid"],
    amount: ["amount", "order_amount"],
    commission: ["affiliate_commission_amount", "commission"],
    status: ["event", "status"],
    date: ["order_time", "created_at", "date"],
    currency: ["currency"],
    product: ["product_id"],
  },
  impact: {
    txn: ["ActionId", "Oid", "action_id"],
    subid: ["SubId1", "subid"],
    amount: ["Amount", "IntendedAmount", "amount"],
    commission: ["Payout", "payout"],
    status: ["State", "status"],
    date: ["EventDate", "event_date"],
    currency: ["Currency", "currency"],
    product: ["ItemSku", "sku"],
  },
  other: {
    txn: ["transactionId", "id"],
    subid: ["subid", "subId"],
    amount: ["amount"],
    commission: ["commission"],
    status: ["status"],
    date: ["occurredAt", "date"],
    currency: ["currency"],
    product: ["productId"],
  },
};

type Body = Record<string, unknown>;

function readField(body: Body, keys: string[]): unknown {
  for (const k of keys) {
    const v = body[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

/** Parse a money value to integer cents. Accepts NL comma or dot decimals. */
export function moneyToCents(v: unknown): number {
  if (typeof v === "number") return Math.round(v * 100);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v.trim().replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(n)) return Math.round(n * 100);
  }
  return 0;
}

/** Normalise a date-ish value to ISO, or "" if unparseable. Accepts unix
 *  seconds (10-digit) and millis (13-digit) as well as date strings. */
export function toIso(v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "number" || /^\d+$/.test(String(v))) {
    const num = Number(v);
    const ms = String(v).length <= 10 ? num * 1000 : num;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/**
 * Parse a network postback body into a NormalizedConversion, or null when it
 * lacks a usable transaction id (→ caller returns 400).
 */
export function parsePostback(network: AffiliateNetwork, body: Body): NormalizedConversion | null {
  const map = FIELD_MAPS[network];
  const networkTransactionId = asString(readField(body, map.txn));
  if (!networkTransactionId) return null;

  return {
    networkTransactionId,
    subid: asString(readField(body, map.subid)) ?? null,
    amountCents: moneyToCents(readField(body, map.amount)),
    commissionCents: moneyToCents(readField(body, map.commission)),
    currency: asString(readField(body, map.currency)) ?? "EUR",
    occurredAt: toIso(readField(body, map.date)),
    rawStatus: asString(readField(body, map.status)),
    productExternalId: asString(readField(body, map.product)),
    raw: body,
  };
}
