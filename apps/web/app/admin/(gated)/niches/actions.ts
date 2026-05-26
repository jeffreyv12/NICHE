"use server";

// Server Actions for niche triage.
//
// CLAUDE.md non-negotiable #1: human approval at the three gates. These
// actions are invoked only from the gated admin UI; both verify auth and the
// presence of the candidate before mutating, then re-validate the page.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "../../../../lib/auth";
import { getServiceRoleSupabase } from "../../../../lib/supabase";

export interface ActionResult {
  ok: boolean;
  error?: string;
  nicheId?: string;
}

/**
 * Promote a scored candidate to a niche row with state=approved_for_validation.
 * Idempotent: if a niche row already exists for this candidate, returns its id.
 */
export async function approveForValidationAction(candidateId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!candidateId) return { ok: false, error: "candidateId required" };

  const supabase = getServiceRoleSupabase();

  const { data: cand, error: candErr } = await supabase
    .from("niche_candidates")
    .select("id, topic, topic_slug")
    .eq("id", candidateId)
    .single();
  if (candErr || !cand) return { ok: false, error: candErr?.message ?? "candidate not found" };

  const { data: existing } = await supabase
    .from("niches")
    .select("id")
    .eq("candidate_id", candidateId)
    .maybeSingle();

  if (existing) {
    const { error: updErr } = await supabase
      .from("niches")
      .update({
        state: "approved_for_validation",
        approved_for_validation_at: new Date().toISOString(),
        notes: `Approved by ${admin.email}`,
      })
      .eq("id", existing.id);
    if (updErr) return { ok: false, error: updErr.message };
    revalidatePath("/admin/niches");
    return { ok: true, nicheId: existing.id };
  }

  const { data: inserted, error: insErr } = await supabase
    .from("niches")
    .insert({
      candidate_id: candidateId,
      topic: cand.topic,
      topic_slug: cand.topic_slug,
      state: "approved_for_validation",
      approved_for_validation_at: new Date().toISOString(),
      notes: `Approved by ${admin.email}`,
    })
    .select("id")
    .single();
  if (insErr || !inserted) return { ok: false, error: insErr?.message ?? "insert failed" };

  revalidatePath("/admin/niches");
  return { ok: true, nicheId: inserted.id };
}

const ALLOWED_REJECT_REASONS = [
  "manual_operator_kill",
  "kill_list_match",
  "duplicate_topic",
  "other",
] as const;
type RejectReason = (typeof ALLOWED_REJECT_REASONS)[number];

function isRejectReason(value: string): value is RejectReason {
  return (ALLOWED_REJECT_REASONS as readonly string[]).includes(value);
}

/**
 * Reject a candidate. Creates (or updates) a niches row with state=killed and
 * inserts a kills row recording the reason and operator. The schema requires a
 * niche_id on kills, so a niche row is created even for "never-was" rejections.
 */
export async function rejectCandidateAction(
  candidateId: string,
  reason: string,
  details: string | null,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!candidateId) return { ok: false, error: "candidateId required" };
  if (!isRejectReason(reason)) return { ok: false, error: `unknown reason: ${reason}` };

  const supabase = getServiceRoleSupabase();

  const { data: cand, error: candErr } = await supabase
    .from("niche_candidates")
    .select("id, topic, topic_slug")
    .eq("id", candidateId)
    .single();
  if (candErr || !cand) return { ok: false, error: candErr?.message ?? "candidate not found" };

  const { data: existing } = await supabase
    .from("niches")
    .select("id")
    .eq("candidate_id", candidateId)
    .maybeSingle();

  let nicheId = existing?.id as string | undefined;
  const killedAt = new Date().toISOString();

  if (nicheId) {
    const { error: updErr } = await supabase
      .from("niches")
      .update({
        state: "killed",
        killed_at: killedAt,
        kill_reason: reason,
        notes: `Rejected by ${admin.email}${details ? `: ${details}` : ""}`,
      })
      .eq("id", nicheId);
    if (updErr) return { ok: false, error: updErr.message };
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from("niches")
      .insert({
        candidate_id: candidateId,
        topic: cand.topic,
        topic_slug: cand.topic_slug,
        state: "killed",
        killed_at: killedAt,
        kill_reason: reason,
        notes: `Rejected by ${admin.email}${details ? `: ${details}` : ""}`,
      })
      .select("id")
      .single();
    if (insErr || !inserted) return { ok: false, error: insErr?.message ?? "insert failed" };
    nicheId = inserted.id;
  }

  const { error: killErr } = await supabase.from("kills").insert({
    niche_id: nicheId,
    reason,
    details: details ?? null,
    decided_by: admin.email,
  });
  if (killErr) return { ok: false, error: killErr.message };

  revalidatePath("/admin/niches");
  return { ok: true, nicheId };
}
