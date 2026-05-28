"use server";

// Phase 3.1 — admin actions for a single niche.
//
// Approve / reject a Content-Agent test-page draft. The operator reviews the
// drafted body off-page (preview or external editor) and uses these actions
// to flip state. Approval is the gate before the page becomes publicly
// renderable (CLAUDE.md non-negotiable #1).

import { revalidatePath } from "next/cache";
import { requireAdmin } from "../../../../../lib/auth";
import { getServiceRoleSupabase } from "../../../../../lib/supabase";

export interface PageActionResult {
  ok: boolean;
  error?: string;
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
