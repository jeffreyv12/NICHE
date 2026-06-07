"use server";

// Phase 5.1.4 — operator confirms domain registration + starts migration.
//
// CLAUDE.md non-negotiable #1: human approval is required.
// This action is the approval gate — it runs only after the operator
// explicitly clicks "Confirm registration" in the admin UI.
//
// Steps:
//  1. Insert domain_registrations row (status = pending)
//  2. Insert promotion_migrations row (status = pending)
//
// The migration-once cron (apps/scrapers/src/bin/migration-once.ts) picks up
// the pending row and runs the 13-step state machine.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "../../../../lib/auth";
import { getServiceRoleSupabase } from "../../../../lib/supabase";

export async function confirmRegistrationAction(
  nicheId: string,
  hostname: string,
  registrar: "cloudflare" | "transip",
  tenantId: string,
  operatorEmail: string,
): Promise<void> {
  await requireAdmin();
  const supabase = getServiceRoleSupabase();

  // 1. Insert domain_registrations row
  const { data: drData, error: drError } = await supabase
    .from("domain_registrations")
    .insert({
      niche_id: nicheId,
      tenant_id: tenantId,
      hostname,
      registrar,
      status: "pending",
      auto_renew: true,
    })
    .select("id")
    .single();

  if (drError || !drData) {
    throw new Error(drError?.message ?? "Failed to create domain registration");
  }

  // 2. Insert promotion_migrations row
  const { data: migData, error: migError } = await supabase
    .from("promotion_migrations")
    .insert({
      niche_id: nicheId,
      domain_registration_id: drData.id,
      status: "pending",
      current_step: 0,
      step_logs: [],
      operator_email: operatorEmail,
    })
    .select("id")
    .single();

  if (migError || !migData) {
    // Roll back the domain_registrations row to avoid orphan
    await supabase.from("domain_registrations").delete().eq("id", drData.id);
    throw new Error(migError?.message ?? "Failed to create migration record");
  }

  revalidatePath("/admin/promotions");
}
