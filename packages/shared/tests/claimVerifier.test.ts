import { describe, expect, it } from "vitest";
import { type ClaimInput, isClaimSourced, verifyClaims } from "../src/claimVerifier";

function claim(over: Partial<ClaimInput> = {}): ClaimInput {
  return {
    id: "c1",
    claimText: "Deze airfryer haalt 200°C in 3 minuten.",
    claimType: "spec",
    sources: [],
    ...over,
  };
}

describe("isClaimSourced", () => {
  it("is sourced by a valid http(s) source url", () => {
    expect(isClaimSourced(claim({ sources: [{ sourceUrl: "https://brand.nl/spec" }] }))).toBe(true);
  });

  it("is sourced by a first-party test id", () => {
    expect(isClaimSourced(claim({ sources: [{ firstPartyTestId: "fpt-1" }] }))).toBe(true);
  });

  it("is NOT sourced with no sources", () => {
    expect(isClaimSourced(claim({ sources: [] }))).toBe(false);
  });

  it("is NOT sourced by a blank or non-http url", () => {
    expect(isClaimSourced(claim({ sources: [{ sourceUrl: "" }] }))).toBe(false);
    expect(isClaimSourced(claim({ sources: [{ sourceUrl: "   " }] }))).toBe(false);
    expect(isClaimSourced(claim({ sources: [{ sourceUrl: "not-a-url" }] }))).toBe(false);
    expect(isClaimSourced(claim({ sources: [{ sourceUrl: "javascript:alert(1)" }] }))).toBe(false);
  });

  it("is NOT sourced by an empty first-party test id", () => {
    expect(isClaimSourced(claim({ sources: [{ firstPartyTestId: "" }] }))).toBe(false);
  });

  it("is sourced if ANY of several sources is valid", () => {
    expect(
      isClaimSourced(
        claim({ sources: [{ sourceUrl: "" }, { sourceUrl: "https://example.com/x" }] }),
      ),
    ).toBe(true);
  });
});

describe("verifyClaims", () => {
  it("passes when every claim is sourced", () => {
    const r = verifyClaims([
      claim({ id: "a", sources: [{ sourceUrl: "https://x.nl/1" }] }),
      claim({ id: "b", sources: [{ firstPartyTestId: "fpt-9" }] }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.total).toBe(2);
    expect(r.sourcedCount).toBe(2);
    expect(r.unsourced).toEqual([]);
  });

  it("blocks and lists the unsourced claims", () => {
    const r = verifyClaims([
      claim({ id: "a", sources: [{ sourceUrl: "https://x.nl/1" }] }),
      claim({ id: "b", claimText: "Beste op de markt.", sources: [] }),
      claim({ id: "c", claimType: "price", sources: [{ sourceUrl: "garbage" }] }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.total).toBe(3);
    expect(r.sourcedCount).toBe(1);
    expect(r.unsourced.map((u) => u.claimId)).toEqual(["b", "c"]);
    expect(r.unsourced[0]).toMatchObject({
      claimId: "b",
      claimText: "Beste op de markt.",
      sourced: false,
    });
  });

  it("passes a page with zero claims (nothing to block)", () => {
    const r = verifyClaims([]);
    expect(r.ok).toBe(true);
    expect(r.total).toBe(0);
    expect(r.unsourced).toEqual([]);
  });
});
