"use server";

// Admin job-trigger server action.
// Inserts a queued row into `job_triggers`; the Hetzner job-dispatcher
// picks it up within 30 s and spawns the matching bin.
//
// CLAUDE.md #13: operator initiates, automation executes.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "../../../../lib/auth";
import { getServiceRoleSupabase } from "../../../../lib/supabase";

// Must mirror ALLOWED_JOBS in apps/scrapers/src/jobs/dispatcher.ts.
const ALLOWED_JOB_IDS = new Set([
  "discovery",
  "scoring",
  "validation",
  "kill-scan",
  "niche-monthly-metrics",
  "algorithm-events-ingest",
  "promotion",
  "gsc-pull",
  "reconciliation",
  "bol-feed-sync",
  "orchestrator",
  "test-page-draft",
  "content-polish",
]);

export async function triggerJobAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const jobId = formData.get("job_id");

  if (typeof jobId !== "string" || !ALLOWED_JOB_IDS.has(jobId)) {
    throw new Error(`Invalid job_id: ${jobId}`);
  }

  const supabase = getServiceRoleSupabase();
  const { error } = await supabase.from("job_triggers").insert({
    job_id: jobId,
    status: "queued",
    triggered_by_email: admin.email,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/admin/jobs");
}
