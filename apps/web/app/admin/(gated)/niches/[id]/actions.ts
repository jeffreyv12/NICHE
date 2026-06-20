"use server";

// Phase 3.1 — admin actions for a single niche.
//
// Approve / reject a Content-Agent test-page draft. The operator reviews the
// drafted body off-page (preview or external editor) and uses these actions
// to flip state. Approval is the gate before the page becomes publicly
// renderable (CLAUDE.md non-negotiable #1).

import { verifyClaims } from "@nichefinder/shared";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "../../../../../lib/auth";
import { pageTag, tenantTag } from "../../../../../lib/cache";
import { loadPageClaims } from "../../../../../lib/claims";
import { buildCanonicalUrl, pingIndexNow } from "../../../../../lib/indexnow";
import { getServiceRoleSupabase } from "../../../../../lib/supabase";

export interface PageActionResult {
  ok: boolean;
  error?: string;
  /** Phase 4.2 — claims blocking approval; operator must add a source. */
  unsourcedClaims?: Array<{ claimId: string; claimText: string }>;
}

async function loadPageForAdmin(pageId: string): Promise<{
  id: string;
  tenantId: string;
  nicheId: string | null;
  state: string;
  fullPath: string;
} | null> {
  if (!pageId) return null;
  const supabase = getServiceRoleSupabase();
  const { data } = await supabase
    .from("pages")
    .select("id, tenant_id, niche_id, state, full_path")
    .eq("id", pageId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    tenantId: data.tenant_id,
    nicheId: data.niche_id,
    state: data.state,
    fullPath: data.full_path,
  };
}

/** Bust the public ISR cache for a page once it becomes (or stops being)
 *  publicly visible. Resolves and returns the tenant slug. */
async function revalidatePublicPage(tenantId: string, fullPath: string): Promise<string | null> {
  const supabase = getServiceRoleSupabase();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("slug")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant?.slug) return null;
  revalidateTag(pageTag(tenant.slug, fullPath), {});
  revalidateTag(tenantTag(tenant.slug), {});
  return tenant.slug;
}

/**
 * Move a draft test page to approved. From `approved` the page renders on
 * the public test-page route and starts collecting clicks.
 */
export async function approvePageAction(pageId: string): Promise<PageActionResult> {
  const admin = await requireAdmin();
  const page = await loadPageForAdmin(pageId);
  if (!page) return { ok: false, error: "page not found" };
  if (page.state !== "draft" && page.state !== "rejected") {
    return { ok: false, error: `cannot approve from state=${page.state}` };
  }

  // Claim Verifier gate (CLAUDE.md #6): no page goes live with an un-sourced
  // factual claim. Blocked claims surface as operator "add a source" todos.
  const verdict = verifyClaims(await loadPageClaims(pageId));
  if (!verdict.ok) {
    return {
      ok: false,
      error: `${verdict.unsourced.length} claim(s) need a source before approval`,
      unsourcedClaims: verdict.unsourced.map((u) => ({
        claimId: u.claimId,
        claimText: u.claimText,
      })),
    };
  }

  const supabase = getServiceRoleSupabase();
  const { error } = await supabase
    .from("pages")
    .update({
      state: "approved",
      approved_at: new Date().toISOString(),
      approved_by_email: admin.email,
    })
    .eq("id", pageId);
  if (error) return { ok: false, error: error.message };

  // The page is now publicly visible — bust its ISR cache so it appears within
  // seconds rather than waiting out the 24h window (Phase 4.4.2).
  const tenantSlug = await revalidatePublicPage(page.tenantId, page.fullPath);
  if (page.nicheId) revalidatePath(`/admin/niches/${page.nicheId}`);

  // Phase 4.4.3: tell Bing about the new URL (fire-and-forget; never blocks).
  if (tenantSlug) {
    void pingIndexNow(buildCanonicalUrl(tenantSlug, page.fullPath));
  }

  return { ok: true };
}

export async function rejectPageAction(pageId: string): Promise<PageActionResult> {
  const _admin = await requireAdmin();
  const page = await loadPageForAdmin(pageId);
  if (!page) return { ok: false, error: "page not found" };
  if (page.state === "rejected") return { ok: true };

  const supabase = getServiceRoleSupabase();
  const { error } = await supabase.from("pages").update({ state: "rejected" }).eq("id", pageId);
  if (error) return { ok: false, error: error.message };

  if (page.nicheId) revalidatePath(`/admin/niches/${page.nicheId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phase 4.2.4 / 4.3.3 — attach a source to an unsourced claim.
//
// The operator resolves a Claim-Verifier block by attaching either a web
// citation or a logged first-party test. Both clear the block (the verifier
// re-checks live), so the page can then be approved.
// ---------------------------------------------------------------------------

async function revalidateNicheForClaim(claimId: string): Promise<void> {
  const supabase = getServiceRoleSupabase();
  const { data: claim } = await supabase
    .from("claims")
    .select("page_id")
    .eq("id", claimId)
    .maybeSingle();
  if (!claim?.page_id) return;
  const { data: page } = await supabase
    .from("pages")
    .select("niche_id")
    .eq("id", claim.page_id)
    .maybeSingle();
  if (page?.niche_id) revalidatePath(`/admin/niches/${page.niche_id}`);
}

export async function attachClaimUrlSourceAction(
  claimId: string,
  sourceUrl: string,
  excerpt: string,
): Promise<PageActionResult> {
  await requireAdmin();
  const url = sourceUrl.trim();
  const ex = excerpt.trim();
  if (!/^https?:\/\/\S+/i.test(url)) return { ok: false, error: "Geldige http(s)-URL vereist" };
  if (!ex) return { ok: false, error: "Excerpt vereist" };

  const supabase = getServiceRoleSupabase();
  const { error } = await supabase
    .from("claim_sources")
    .insert({ claim_id: claimId, source_kind: "web", source_url: url, excerpt: ex });
  if (error) return { ok: false, error: error.message };
  await supabase.from("claims").update({ is_sourced: true }).eq("id", claimId);
  await revalidateNicheForClaim(claimId);
  return { ok: true };
}

export async function attachClaimTestSourceAction(
  claimId: string,
  firstPartyTestId: string,
): Promise<PageActionResult> {
  await requireAdmin();
  if (!firstPartyTestId) return { ok: false, error: "Kies een test" };

  const supabase = getServiceRoleSupabase();
  const { error } = await supabase.from("claim_sources").insert({
    claim_id: claimId,
    source_kind: "first_party_test",
    first_party_test_id: firstPartyTestId,
  });
  if (error) return { ok: false, error: error.message };
  await supabase.from("claims").update({ is_sourced: true }).eq("id", claimId);
  await revalidateNicheForClaim(claimId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phase 6.2 — confirm or dismiss an automated kill recommendation.
//
// The scan writes an open kill_flags row; the operator decides here (CLAUDE.md
// #2 + #13). Confirm → niche killed + kills audit row; dismiss → flag closed,
// niche untouched.
// ---------------------------------------------------------------------------

const KILL_REASON_ENUM = new Set([
  "low_revenue_month_6",
  "low_traffic_month_6",
  "manual_operator_kill",
  "kill_list_match",
  "duplicate_topic",
  "google_penalty",
  "other",
]);

export async function confirmKillFlagAction(flagId: string): Promise<PageActionResult> {
  const admin = await requireAdmin();
  if (!flagId) return { ok: false, error: "missing flag id" };

  const supabase = getServiceRoleSupabase();
  const { data: flag } = await supabase
    .from("kill_flags")
    .select("id, niche_id, reasons, confirmed_at, dismissed_at")
    .eq("id", flagId)
    .maybeSingle();
  if (!flag) return { ok: false, error: "flag not found" };
  if (flag.confirmed_at || flag.dismissed_at) return { ok: false, error: "already decided" };

  const { data: niche } = await supabase
    .from("niches")
    .select("id, state, notes")
    .eq("id", flag.niche_id)
    .maybeSingle();
  if (!niche) return { ok: false, error: "niche not found" };

  const reasons: string[] = Array.isArray(flag.reasons) ? flag.reasons : [];
  const reason = reasons.find((r) => KILL_REASON_ENUM.has(r)) ?? "manual_operator_kill";
  const now = new Date().toISOString();
  const noteLine = `[kill ${reason} · ${now} · ${admin.email}] auto-flag bevestigd`;

  const { error: nicheErr } = await supabase
    .from("niches")
    .update({
      state: "killed",
      killed_at: now,
      kill_reason: reason,
      notes: niche.notes ? `${niche.notes}\n${noteLine}` : noteLine,
    })
    .eq("id", niche.id);
  if (nicheErr) return { ok: false, error: nicheErr.message };

  const { data: kill } = await supabase
    .from("kills")
    .insert({
      niche_id: niche.id,
      reason,
      details: `auto kill-flag: ${reasons.join(", ")}`,
      decided_by: admin.email,
    })
    .select("id")
    .maybeSingle();

  const { error: flagErr } = await supabase
    .from("kill_flags")
    .update({
      confirmed_at: now,
      confirmed_by_email: admin.email,
      resulting_kill_id: kill?.id ?? null,
    })
    .eq("id", flagId);
  if (flagErr) return { ok: false, error: flagErr.message };

  // Phase 6.2.3 — archive all pages belonging to the killed niche so they 404
  // on the public site immediately. The middleware rewrite still routes to the
  // tenant slug, but the page renderer only shows approved/published state.
  await supabase
    .from("pages")
    .update({ state: "archived" })
    .eq("niche_id", niche.id)
    .in("state", ["draft", "approved", "published"]);

  revalidatePath(`/admin/niches/${niche.id}`);
  return { ok: true };
}

export async function dismissKillFlagAction(flagId: string): Promise<PageActionResult> {
  const admin = await requireAdmin();
  if (!flagId) return { ok: false, error: "missing flag id" };

  const supabase = getServiceRoleSupabase();
  const { data: flag } = await supabase
    .from("kill_flags")
    .select("id, niche_id, confirmed_at, dismissed_at")
    .eq("id", flagId)
    .maybeSingle();
  if (!flag) return { ok: false, error: "flag not found" };
  if (flag.confirmed_at || flag.dismissed_at) return { ok: false, error: "already decided" };

  const { error } = await supabase
    .from("kill_flags")
    .update({ dismissed_at: new Date().toISOString(), dismissed_by_email: admin.email })
    .eq("id", flagId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/niches/${flag.niche_id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phase 3.3 — confirm a Validation Agent recommendation.
//
// The agent writes a recommendation to validation_evaluations; it does NOT
// move niches.state. This action is the operator approval gate (CLAUDE.md #1,
// #13): only here does the niche transition. The operator may accept the
// recommended decision or override it with a different one.
// ---------------------------------------------------------------------------

export type ValidationDecision = "go" | "pivot" | "kill";

// decision → niche_state. "kill" maps to the "killed" state.
const DECISION_TO_STATE: Record<ValidationDecision, string> = {
  go: "go",
  pivot: "pivot",
  kill: "killed",
};

export async function confirmValidationAction(
  evaluationId: string,
  decision: ValidationDecision,
): Promise<PageActionResult> {
  const admin = await requireAdmin();
  if (!evaluationId) return { ok: false, error: "missing evaluation id" };
  if (!(decision in DECISION_TO_STATE)) return { ok: false, error: `bad decision: ${decision}` };

  const supabase = getServiceRoleSupabase();

  const { data: evaluation } = await supabase
    .from("validation_evaluations")
    .select("id, niche_id, confirmed_at, rationale")
    .eq("id", evaluationId)
    .maybeSingle();
  if (!evaluation) return { ok: false, error: "evaluation not found" };
  if (evaluation.confirmed_at) return { ok: false, error: "already confirmed" };

  const { data: niche } = await supabase
    .from("niches")
    .select("id, state, notes")
    .eq("id", evaluation.niche_id)
    .maybeSingle();
  if (!niche) return { ok: false, error: "niche not found" };
  if (niche.state !== "validating") {
    return { ok: false, error: `cannot confirm validation from state=${niche.state}` };
  }

  const now = new Date().toISOString();
  const newState = DECISION_TO_STATE[decision];
  const noteLine =
    `[validation ${decision} · ${now} · ${admin.email}] ${evaluation.rationale ?? ""}`.trim();
  const notes = niche.notes ? `${niche.notes}\n${noteLine}` : noteLine;

  const nicheUpdate: Record<string, unknown> = {
    state: newState,
    validation_decided_at: now,
    notes,
  };
  if (decision === "kill") {
    nicheUpdate.killed_at = now;
    nicheUpdate.kill_reason = "manual_operator_kill";
  }

  const { error: nicheErr } = await supabase.from("niches").update(nicheUpdate).eq("id", niche.id);
  if (nicheErr) return { ok: false, error: nicheErr.message };

  const { error: evalErr } = await supabase
    .from("validation_evaluations")
    .update({
      confirmed_at: now,
      confirmed_by_email: admin.email,
      resulting_state: newState,
    })
    .eq("id", evaluationId);
  if (evalErr) return { ok: false, error: evalErr.message };

  // A confirmed kill leaves a kills-table audit row (mirrors kill-list flow).
  if (decision === "kill") {
    await supabase.from("kills").insert({
      niche_id: niche.id,
      reason: "manual_operator_kill",
      details: evaluation.rationale ?? "validation kill",
      decided_by: admin.email,
    });
  }

  revalidatePath(`/admin/niches/${niche.id}`);
  return { ok: true };
}
