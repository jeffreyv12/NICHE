// Phase 4.2 — Claim Verifier (CLAUDE.md non-negotiable #6).
//
// Every factual claim on a page must trace to either a source URL or an
// operator-marked first-party test. A page with any un-sourced claim is blocked
// from publish. This module is the pure gate; the publish/approval flow loads a
// page's claims + claim_sources and refuses the transition when ok === false,
// surfacing `unsourced` as "operator must add a source" todos.

export interface ClaimSourceInput {
  /** A web citation. Must be an http(s) URL to count. */
  sourceUrl?: string | null;
  /** An operator first-party test row id. */
  firstPartyTestId?: string | null;
}

export interface ClaimInput {
  id: string;
  claimText: string;
  claimType: string;
  sources: ClaimSourceInput[];
}

export interface ClaimVerdict {
  claimId: string;
  claimText: string;
  claimType: string;
  sourced: boolean;
}

export interface ClaimVerificationResult {
  /** True iff every claim is sourced (page may proceed). */
  ok: boolean;
  total: number;
  sourcedCount: number;
  /** The claims blocking publish — operator todos. */
  unsourced: ClaimVerdict[];
  verdicts: ClaimVerdict[];
}

function isValidSourceUrl(url: string | null | undefined): boolean {
  if (typeof url !== "string") return false;
  return /^https?:\/\/\S+/i.test(url.trim());
}

function hasFirstPartyTest(id: string | null | undefined): boolean {
  return typeof id === "string" && id.trim() !== "";
}

/** A claim is sourced when at least one of its sources has a valid url or a
 *  first-party test id. */
export function isClaimSourced(claim: ClaimInput): boolean {
  return claim.sources.some(
    (s) => isValidSourceUrl(s.sourceUrl) || hasFirstPartyTest(s.firstPartyTestId),
  );
}

/** Verify every claim on a page. ok === false blocks the publish transition. */
export function verifyClaims(claims: ClaimInput[]): ClaimVerificationResult {
  const verdicts: ClaimVerdict[] = claims.map((c) => ({
    claimId: c.id,
    claimText: c.claimText,
    claimType: c.claimType,
    sourced: isClaimSourced(c),
  }));
  const unsourced = verdicts.filter((v) => !v.sourced);
  return {
    ok: unsourced.length === 0,
    total: verdicts.length,
    sourcedCount: verdicts.length - unsourced.length,
    unsourced,
    verdicts,
  };
}
