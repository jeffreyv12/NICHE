// Phase 4.2 — claim loading for the Claim Verifier gate.
//
// Shared by the approval server action (single page) and the niche detail page
// (batch, to render unsourced-claim todos before the operator clicks Approve).

import type { ClaimInput, ClaimSourceInput } from "@nichefinder/shared";
import { getServiceRoleSupabase } from "./supabase";

interface SourceRow {
  claim_id: string;
  source_url: string | null;
  first_party_test_id: string | null;
}

/** Load claims (+ their sources) for several pages at once, keyed by page id. */
export async function loadClaimsByPage(pageIds: string[]): Promise<Map<string, ClaimInput[]>> {
  const byPage = new Map<string, ClaimInput[]>();
  if (pageIds.length === 0) return byPage;

  const supabase = getServiceRoleSupabase();
  const { data: claimRows } = (await supabase
    .from("claims")
    .select("id, page_id, claim_text, claim_type")
    .in("page_id", pageIds)) as {
    data: Array<{ id: string; page_id: string; claim_text: string; claim_type: string }> | null;
  };
  if (!claimRows || claimRows.length === 0) return byPage;

  const { data: sourceRows } = (await supabase
    .from("claim_sources")
    .select("claim_id, source_url, first_party_test_id")
    .in(
      "claim_id",
      claimRows.map((c) => c.id),
    )) as { data: SourceRow[] | null };

  const sourcesByClaim = new Map<string, ClaimSourceInput[]>();
  for (const s of sourceRows ?? []) {
    const arr = sourcesByClaim.get(s.claim_id) ?? [];
    arr.push({ sourceUrl: s.source_url, firstPartyTestId: s.first_party_test_id });
    sourcesByClaim.set(s.claim_id, arr);
  }

  for (const c of claimRows) {
    const arr = byPage.get(c.page_id) ?? [];
    arr.push({
      id: c.id,
      claimText: c.claim_text,
      claimType: c.claim_type,
      sources: sourcesByClaim.get(c.id) ?? [],
    });
    byPage.set(c.page_id, arr);
  }
  return byPage;
}

/** Load claims (+ sources) for a single page. */
export async function loadPageClaims(pageId: string): Promise<ClaimInput[]> {
  return (await loadClaimsByPage([pageId])).get(pageId) ?? [];
}
