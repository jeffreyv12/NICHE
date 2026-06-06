// Phase 3.2 — cross-cutting helpers for affiliate conversion ingestion.
//
// Used by BOTH apps/web (the conversion webhook handler) and apps/scrapers
// (the daily reconciliation job), so the security primitives and the
// status/revenue policy live in exactly one place.
//
// Nothing here touches the database or process.env — all functions are pure
// and synchronously testable.

import { createHmac, timingSafeEqual } from "node:crypto";

// =============================================================================
// SubID — the [tenant_slug]:[page_slug]:[cohort] tracking key.
// =============================================================================
//
// Every affiliate_links row carries a subid in this shape (see
// jobs/test-page-draft.ts). Networks echo it back on conversions, which is how
// we attribute revenue to a tenant + test page + traffic cohort.

export interface SubIdParts {
  tenantSlug: string;
  pageSlug: string;
  cohort: string;
}

const SUBID_SEP = ":";

/** Build a subid from its parts. Inverse of {@link parseSubId}. */
export function formatSubId(parts: SubIdParts): string {
  return [parts.tenantSlug, parts.pageSlug, parts.cohort].join(SUBID_SEP);
}

/**
 * Parse a subid into its parts, or return null if it is malformed (wrong
 * segment count or any empty segment). Tolerant of surrounding whitespace.
 */
export function parseSubId(raw: string | null | undefined): SubIdParts | null {
  if (!raw) return null;
  const segments = raw.trim().split(SUBID_SEP);
  if (segments.length !== 3) return null;
  const [tenantSlug, pageSlug, cohort] = segments;
  if (!tenantSlug || !pageSlug || !cohort) return null;
  return { tenantSlug, pageSlug, cohort };
}

// =============================================================================
// Token comparison — the {token} path segment on the webhook URL.
// =============================================================================

/**
 * Constant-time comparison of the token in the inbound webhook path against the
 * per-network token from env. Returns false (never throws) when either side is
 * missing/empty — an unconfigured network must not accept postbacks.
 */
export function verifyWebhookToken(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // length leak is acceptable; content is not
  return timingSafeEqual(a, b);
}

// =============================================================================
// HMAC signature verification — networks that sign the postback body.
// =============================================================================

export interface VerifyHmacArgs {
  /** The exact raw request body the signature was computed over. */
  payload: string;
  /** The signature from the request header (hex or base64, optional algo prefix). */
  signature: string | null | undefined;
  /** The shared signing secret from env. */
  secret: string;
  /** Hash algorithm. Default sha256. */
  algorithm?: "sha256" | "sha1" | "sha512";
  /** Expected digest encoding of the provided signature. Default hex. */
  encoding?: "hex" | "base64";
}

/**
 * Constant-time HMAC verification. Strips a leading "<algo>=" prefix (GitHub /
 * Awin style). Returns false (never throws) on any malformed or missing input.
 */
export function verifyHmacSignature(args: VerifyHmacArgs): boolean {
  const { payload, secret } = args;
  let signature = args.signature ?? "";
  const algorithm = args.algorithm ?? "sha256";
  const encoding = args.encoding ?? "hex";
  if (!signature || !secret) return false;

  // Drop a "sha256=" / "sha1=" style prefix if present.
  const eq = signature.indexOf("=");
  if (eq > 0 && eq < 12) signature = signature.slice(eq + 1);

  const expected = createHmac(algorithm, secret).update(payload).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, encoding);
  } catch {
    return false;
  }
  if (provided.length !== expected.length || provided.length === 0) return false;
  return timingSafeEqual(provided, expected);
}

// =============================================================================
// Conversion status — canonicalize each network's vocabulary, then decide
// which conversions count toward the validation revenue signal.
// =============================================================================

export type CanonicalConversionStatus = "approved" | "pending" | "declined";

const APPROVED_TOKENS = new Set([
  "approved",
  "confirmed",
  "accepted",
  "paid",
  "valid",
  "validated",
]);
const DECLINED_TOKENS = new Set([
  "declined",
  "disapproved",
  "cancelled",
  "canceled",
  "rejected",
  "deleted",
  "reversed",
  "refunded",
  "void",
]);
// Everything else (pending, open, new, …) maps to "pending" — conservative:
// we never silently treat an unrecognised status as confirmed revenue.

/** Map a raw network status string to our three canonical buckets. */
export function canonicalConversionStatus(
  raw: string | null | undefined,
): CanonicalConversionStatus {
  const s = (raw ?? "").trim().toLowerCase();
  if (APPROVED_TOKENS.has(s)) return "approved";
  if (DECLINED_TOKENS.has(s)) return "declined";
  return "pending";
}

/**
 * Policy: does a conversion in this status count toward the revenue figure the
 * Validation Agent sees? This number drives GO/PIVOT/KILL, so the handling of
 * *pending* conversions is a real product decision — see the TODO below.
 *
 * @param status   canonical status (use {@link canonicalConversionStatus})
 * @param countPending  whether not-yet-confirmed conversions should count
 */
export function conversionCountsAsRevenue(
  status: CanonicalConversionStatus,
  countPending: boolean = COUNT_PENDING_AS_REVENUE,
): boolean {
  if (status === "approved") return true;
  if (status === "declined") return false;
  // status === "pending"
  return countPending;
}

// Operator decision (2026-06-06): pending conversions do NOT count toward the
// validation revenue figure. During a ~14-day window most Bol/Awin/Daisycon
// conversions are still "pending" (return/confirmation windows run ~30–60 days);
// counting them would risk a false GO if they later reverse. Excluding them is
// conservative and aligns with CLAUDE.md #10 (false positives worse than
// slowness). Flip to `true` to trade that safety for an earlier revenue signal.
export const COUNT_PENDING_AS_REVENUE = false;
