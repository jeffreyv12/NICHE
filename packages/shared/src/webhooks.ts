// Phase 3.2 — affiliate webhook security primitives (Node.js-only, crypto).
//
// ⚠ This module uses node:crypto and MUST NOT be imported in Edge contexts.
//    Import via @nichefinder/shared/webhooks (direct path) — NOT via the barrel.
//    Pure conversion-status helpers live in conversionStatus.ts (Edge-safe).

import { createHmac, timingSafeEqual } from "node:crypto";

// Re-export the pure helpers so that existing imports from this path still work.
export * from "./conversionStatus";

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
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// =============================================================================
// HMAC signature verification — networks that sign the postback body.
// =============================================================================

export interface VerifyHmacArgs {
  payload: string;
  signature: string | null | undefined;
  secret: string;
  algorithm?: "sha256" | "sha1" | "sha512";
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
