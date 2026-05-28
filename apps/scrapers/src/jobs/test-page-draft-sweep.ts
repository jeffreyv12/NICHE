// Phase 3.1 — Sweep wrapper around runTestPageDraftJob.
//
// Picks up every niche in state=approved_for_validation that has no `pages`
// rows yet, ensures it's attached to the main_authority tenant, drafts its
// test pages, then advances the niche to state=validating.
//
// Architecture: web app sets niches.state=approved_for_validation via the
// admin triage action; this sweep (cron on Hetzner) is what actually triggers
// the Content Agent. Decoupling keeps the long-running agent calls off the
// Vercel request path (CLAUDE.md non-negotiable #1 + tech-stack split).

import { type ServiceDb, niches, pages, tenants } from "@nichefinder/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  type RunTestPageDraftJobOptions,
  type RunTestPageDraftJobResult,
  runTestPageDraftJob,
} from "./test-page-draft.js";

export interface RunTestPageDraftSweepOptions {
  db: ServiceDb;
  runtime: RunTestPageDraftJobOptions["runtime"];
  /** Override per-job knobs (planner, buildTrackingUrl, generateShortCode). */
  jobOverrides?: Pick<
    RunTestPageDraftJobOptions,
    "planner" | "buildTrackingUrl" | "generateShortCode"
  >;
  /** Max niches to draft in one sweep. Default 5. Agent cost compounds fast. */
  limit?: number;
}

export interface RunTestPageDraftSweepResult {
  considered: number;
  drafted: number;
  advanced: number;
  totalCostEur: number;
  jobs: Array<{
    nicheId: string;
    topicSlug: string;
    ok: boolean;
    error?: string;
    job?: RunTestPageDraftJobResult;
  }>;
}

export async function runTestPageDraftSweep(
  opts: RunTestPageDraftSweepOptions,
): Promise<RunTestPageDraftSweepResult> {
  const limit = opts.limit ?? 5;
  const candidates = await selectReadyNiches(opts.db, limit);

  const result: RunTestPageDraftSweepResult = {
    considered: candidates.length,
    drafted: 0,
    advanced: 0,
    totalCostEur: 0,
    jobs: [],
  };

  for (const niche of candidates) {
    try {
      if (!niche.tenantId) {
        const mainTenantId = await resolveMainAuthorityTenant(opts.db);
        await opts.db.update(niches).set({ tenantId: mainTenantId }).where(eq(niches.id, niche.id));
      }

      const job = await runTestPageDraftJob({
        db: opts.db,
        runtime: opts.runtime,
        nicheId: niche.id,
        ...opts.jobOverrides,
      });

      result.totalCostEur += job.totalCostEur;
      if (job.drafted.length > 0) result.drafted += 1;

      // Advance to `validating` only when at least one draft landed.
      if (job.drafted.length > 0 && job.failures.length === 0) {
        await opts.db
          .update(niches)
          .set({ state: "validating", validationStartedAt: new Date() })
          .where(eq(niches.id, niche.id));
        result.advanced += 1;
      }

      result.jobs.push({ nicheId: niche.id, topicSlug: niche.topicSlug, ok: true, job });
    } catch (err) {
      result.jobs.push({
        nicheId: niche.id,
        topicSlug: niche.topicSlug,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// -----------------------------------------------------------------------------
// Selection: niches in approved_for_validation with zero `pages` rows.
// -----------------------------------------------------------------------------

interface ReadyNicheRow {
  id: string;
  tenantId: string | null;
  topicSlug: string;
}

async function selectReadyNiches(db: ServiceDb, limit: number): Promise<ReadyNicheRow[]> {
  const existingPage = db
    .select({ nicheId: pages.nicheId })
    .from(pages)
    .where(sql`${pages.nicheId} is not null`)
    .as("existing_page");

  const rows: ReadyNicheRow[] = await db
    .select({
      id: niches.id,
      tenantId: niches.tenantId,
      topicSlug: niches.topicSlug,
    })
    .from(niches)
    .leftJoin(existingPage, eq(existingPage.nicheId, niches.id))
    .where(and(eq(niches.state, "approved_for_validation"), isNull(existingPage.nicheId)))
    .limit(limit);

  return rows;
}

async function resolveMainAuthorityTenant(db: ServiceDb): Promise<string> {
  const rows = (await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.kind, "main_authority"), eq(tenants.isActive, true)))
    .limit(1)) as Array<{ id: string }>;
  const row = rows[0];
  if (!row) {
    throw new Error(
      "no active main_authority tenant — seed one before sweeping (pnpm --filter @nichefinder/web db:seed)",
    );
  }
  return row.id;
}
