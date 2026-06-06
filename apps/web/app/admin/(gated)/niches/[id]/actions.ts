"use server";

// Phase 3.1 — admin actions for a single niche.
//
// Approve / reject a Content-Agent test-page draft. The operator reviews the
// drafted body off-page (preview or external editor) and uses these actions
// to flip state. Approval is the gate before the page becomes publicly
// renderable (CLAUDE.md non-negotiable #1).

import { verifyClaims } from "@nichefinder/shared";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "../../../../../lib/auth";
import { loadPageClaims } from "../../../../../lib/claims";
import { getServiceRoleSupabase } from "../../../../../lib/supabase";

export interface PageActionResult {
  ok: boolean;
  error?: string;
  /** Phase 4.2 — claims blocking approval; operator must add a source. */
  unsourcedClaims?: Array<{ claimId: string; claimText: string }>;
}

async function loadPageForAdmin(
  pageId: string,
): Promise<{ id: string; tenantId: string; nicheId: string | null; state: string } | null> {
  if (!pageId) return null;
  const supabase = getServiceRoleSupabase();
  const { data } = await supabase
    .from("pages")
    .select("id, tenant_id, niche_id, state")
    .eq("id", pageId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    tenantId: data.tenant_id,
    nicheId: data.niche_id,
    state: data.state,
  };
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

  if (page.nicheId) revalidatePath(`/admin/niches/${page.nicheId}`);
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
