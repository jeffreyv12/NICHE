import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalConversionStatus,
  conversionCountsAsRevenue,
  formatSubId,
  parseSubId,
  verifyHmacSignature,
  verifyWebhookToken,
} from "../src/webhooks";

// -----------------------------------------------------------------------------
// SubID parsing — the [tenant_slug]:[page_slug]:[cohort] join key.
// -----------------------------------------------------------------------------

describe("parseSubId", () => {
  it("parses a well-formed subid", () => {
    expect(parseSubId("expertgids:beste-airfryer:organic")).toEqual({
      tenantSlug: "expertgids",
      pageSlug: "beste-airfryer",
      cohort: "organic",
    });
  });

  it("round-trips with formatSubId", () => {
    const parts = { tenantSlug: "t", pageSlug: "p", cohort: "c" };
    expect(parseSubId(formatSubId(parts))).toEqual(parts);
  });

  it("returns null on the wrong number of segments", () => {
    expect(parseSubId("only:two")).toBeNull();
    expect(parseSubId("a:b:c:d")).toBeNull();
    expect(parseSubId("")).toBeNull();
  });

  it("returns null when any segment is empty", () => {
    expect(parseSubId("t::c")).toBeNull();
    expect(parseSubId(":p:c")).toBeNull();
  });

  it("trims surrounding whitespace from the raw value", () => {
    expect(parseSubId("  t:p:c  ")).toEqual({ tenantSlug: "t", pageSlug: "p", cohort: "c" });
  });
});

// -----------------------------------------------------------------------------
// Timing-safe token comparison (the {token} path segment on the webhook URL).
// -----------------------------------------------------------------------------

describe("verifyWebhookToken", () => {
  it("accepts an exact match", () => {
    expect(verifyWebhookToken("s3cret-token", "s3cret-token")).toBe(true);
  });

  it("rejects a mismatch", () => {
    expect(verifyWebhookToken("s3cret-token", "wrong")).toBe(false);
  });

  it("rejects when the expected token is empty/undefined (network not configured)", () => {
    expect(verifyWebhookToken("anything", "")).toBe(false);
    expect(verifyWebhookToken("anything", undefined)).toBe(false);
  });

  it("rejects when the provided token is missing", () => {
    expect(verifyWebhookToken(undefined, "expected")).toBe(false);
  });

  it("rejects different-length tokens without throwing", () => {
    expect(verifyWebhookToken("short", "a-much-longer-token")).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// HMAC signature verification (networks that sign the postback body).
// -----------------------------------------------------------------------------

describe("verifyHmacSignature", () => {
  const secret = "shared-signing-secret";
  const payload = '{"transactionId":"abc","commission":12.5}';
  const goodSig = createHmac("sha256", secret).update(payload).digest("hex");

  it("accepts a valid hex signature", () => {
    expect(verifyHmacSignature({ payload, signature: goodSig, secret })).toBe(true);
  });

  it("accepts a valid base64 signature", () => {
    const b64 = createHmac("sha256", secret).update(payload).digest("base64");
    expect(verifyHmacSignature({ payload, signature: b64, secret, encoding: "base64" })).toBe(true);
  });

  it("tolerates a sha256= prefix", () => {
    expect(verifyHmacSignature({ payload, signature: `sha256=${goodSig}`, secret })).toBe(true);
  });

  it("rejects a tampered payload", () => {
    expect(verifyHmacSignature({ payload: `${payload} `, signature: goodSig, secret })).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyHmacSignature({ payload, signature: goodSig, secret: "nope" })).toBe(false);
  });

  it("rejects an empty/missing signature without throwing", () => {
    expect(verifyHmacSignature({ payload, signature: "", secret })).toBe(false);
    expect(verifyHmacSignature({ payload, signature: undefined, secret })).toBe(false);
  });

  it("rejects a malformed (non-hex) signature without throwing", () => {
    expect(verifyHmacSignature({ payload, signature: "zzzz", secret })).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Conversion-status canonicalization + revenue policy.
// -----------------------------------------------------------------------------

describe("canonicalConversionStatus", () => {
  it("maps Bol/Awin/Daisycon approved-ish statuses to 'approved'", () => {
    for (const s of ["approved", "confirmed", "accepted", "paid", "APPROVED"]) {
      expect(canonicalConversionStatus(s)).toBe("approved");
    }
  });

  it("maps pending-ish statuses to 'pending'", () => {
    for (const s of ["pending", "open", "new", "PENDING"]) {
      expect(canonicalConversionStatus(s)).toBe("pending");
    }
  });

  it("maps declined/cancelled statuses to 'declined'", () => {
    for (const s of ["declined", "disapproved", "cancelled", "rejected", "deleted"]) {
      expect(canonicalConversionStatus(s)).toBe("declined");
    }
  });

  it("falls back to 'pending' for unknown/empty status (conservative)", () => {
    expect(canonicalConversionStatus("wat")).toBe("pending");
    expect(canonicalConversionStatus(undefined)).toBe("pending");
  });
});

describe("conversionCountsAsRevenue", () => {
  it("never counts a declined conversion", () => {
    expect(conversionCountsAsRevenue("declined")).toBe(false);
  });

  it("always counts an approved conversion", () => {
    expect(conversionCountsAsRevenue("approved")).toBe(true);
  });
});
