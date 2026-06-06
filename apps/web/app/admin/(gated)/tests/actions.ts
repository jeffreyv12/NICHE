"use server";

// Phase 4.3 — first-party test logging.
//
// The operator logs a hands-on product test here; it can then be attached to a
// claim (see niches/[id]/actions.ts) to satisfy the Claim Verifier without a
// web source. Photo upload to R2 (4.3.2) is deferred — text fields only for now.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "../../../../lib/auth";
import { getServiceRoleSupabase } from "../../../../lib/supabase";

function splitLines(v: FormDataEntryValue | null): string[] {
  if (typeof v !== "string") return [];
  return v
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Create a first_party_tests row. Throws on validation failure (internal tool). */
export async function createFirstPartyTestAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();

  const productName = str(formData.get("product_name"));
  const summary = str(formData.get("summary"));
  if (!productName) throw new Error("Productnaam is verplicht.");
  if (!summary) throw new Error("Samenvatting is verplicht.");

  const ratingRaw = str(formData.get("rating"));
  let rating: number | null = ratingRaw ? Number(ratingRaw) : null;
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) rating = null;

  const supabase = getServiceRoleSupabase();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("kind", "main_authority")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!tenant) throw new Error("Geen actieve main_authority tenant gevonden.");

  const nicheId = str(formData.get("niche_id")) || null;
  const { error } = await supabase.from("first_party_tests").insert({
    tenant_id: tenant.id,
    niche_id: nicheId,
    product_name: productName,
    test_summary_md: summary,
    rating,
    pros: splitLines(formData.get("pros")),
    cons: splitLines(formData.get("cons")),
    test_started_at: str(formData.get("test_started_at")) || null,
    test_finished_at: str(formData.get("test_finished_at")) || null,
    created_by_email: admin.email,
  });
  if (error) throw new Error(`Opslaan mislukt: ${error.message}`);

  revalidatePath("/admin/tests");
}
