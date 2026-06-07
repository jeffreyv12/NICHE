// Phase 6.2 — daily kill-list automation scan.
//
// For each live niche, evaluate the automatable kill criteria and, when any
// match, write ONE open kill_flags recommendation. NEVER kills — the operator
// confirms/dismisses in the admin UI (CLAUDE.md #2 + #13). Mirrors validation.ts:
// injected db + an injectable metrics adapter so it is unit-testable.

import { type ServiceDb, conversions, gscMetrics, killFlags, niches, pages } from "@nichefinder/db";
import {
  type KillCriteriaInput,
  type KillCriteriaThresholds,
  canonicalConversionStatus,
  conversionCountsAsRevenue,
  evaluateKillCriteria,
  matchKillList,
} from "@nichefinder/shared";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

// States where a niche is "live" enough to be a kill candidate.
const SCANNABLE_STATES = ["validating", "go", "building", "mature", "promoted"] as const;

export interface NicheKillMetrics {
  trailing30dRevenueEur: number;
  trailing30dOrganicClicks: number;
  hasGoogleManualAction: boolean;
}

export interface KillMetricsAdapter {
  fetch(niche: { id: string; tenantId: string | null }, cutoff: Date): Promise<NicheKillMetrics>;
}

export interface RunKillScanJobOptions {
  db: ServiceDb;
  /** Revenue/traffic/penalty source. Defaults to the DB adapter. */
  metrics?: KillMetricsAdapter;
  /** Only scan this niche (operator on-demand). Default: all live niches. */
  nicheId?: string;
  limit?: number;
  thresholds?: KillCriteriaThresholds;
  /** ISO timestamp "now". Default real now. */
  asOf?: string;
}

export interface KillScanOutcome {
  nicheId: string;
  topicSlug: string;
  reasons: string[];
  flagId: string | null;
  skippedExistingOpen: boolean;
}

export interface RunKillScanJobResult {
  considered: number;
  flagged: number;
  skippedExistingOpen: number;
  healthy: number;
  outcomes: KillScanOutcome[];
  failures: Array<{ nicheId: string; topicSlug: string; error: string }>;
}

interface NicheRow {
  id: string;
  topic: string;
  topicSlug: string;
  tenantId: string | null;
  createdAt: Date;
  state: string;
}

export async function runKillScanJob(opts: RunKillScanJobOptions): Promise<RunKillScanJobResult> {
  const limit = opts.limit ?? 200;
  const asOf = opts.asOf ?? new Date().toISOString();
  const asOfMs = new Date(asOf).getTime();
  const cutoff = new Date(asOfMs - 30 * 86_400_000);
  const metrics = opts.metrics ?? createDefaultKillMetricsAdapter(opts.db);

  const candidates = await selectNiches(opts.db, opts.nicheId, limit);
  const result: RunKillScanJobResult = {
    considered: candidates.length,
    flagged: 0,
    skippedExistingOpen: 0,
    healthy: 0,
    outcomes: [],
    failures: [],
  };

  for (const niche of candidates) {
    try {
      const m = await metrics.fetch({ id: niche.id, tenantId: niche.tenantId }, cutoff);
      const match = matchKillList({ topic: niche.topic, topicSlug: niche.topicSlug });
      const input: KillCriteriaInput = {
        nicheAgeDays: Math.max(0, Math.floor((asOfMs - niche.createdAt.getTime()) / 86_400_000)),
        trailing30dRevenueEur: m.trailing30dRevenueEur,
        trailing30dOrganicClicks: m.trailing30dOrganicClicks,
        killListHardBlock: match?.category.severity === "hard_block",
        hasGoogleManualAction: m.hasGoogleManualAction,
      };

      const flags = evaluateKillCriteria(input, opts.thresholds);
      if (flags.length === 0) {
        result.healthy += 1;
        continue;
      }

      if (await hasOpenFlag(opts.db, niche.id)) {
        result.skippedExistingOpen += 1;
        result.outcomes.push({
          nicheId: niche.id,
          topicSlug: niche.topicSlug,
          reasons: flags.map((f) => f.reason),
          flagId: null,
          skippedExistingOpen: true,
        });
        continue;
      }

      const inserted = await opts.db
        .insert(killFlags)
        .values({
          nicheId: niche.id,
          reasons: flags.map((f) => f.reason),
          details: flags,
          metrics: input,
        })
        .returning({ id: killFlags.id });

      result.flagged += 1;
      result.outcomes.push({
        nicheId: niche.id,
        topicSlug: niche.topicSlug,
        reasons: flags.map((f) => f.reason),
        flagId: inserted[0]?.id ?? null,
        skippedExistingOpen: false,
      });
    } catch (err) {
      result.failures.push({
        nicheId: niche.id,
        topicSlug: niche.topicSlug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

async function selectNiches(
  db: ServiceDb,
  nicheId: string | undefined,
  limit: number,
): Promise<NicheRow[]> {
  const cols = {
    id: niches.id,
    topic: niches.topic,
    topicSlug: niches.topicSlug,
    tenantId: niches.tenantId,
    createdAt: niches.createdAt,
    state: niches.state,
  };
  if (nicheId) {
    return db.select(cols).from(niches).where(eq(niches.id, nicheId)).limit(1) as Promise<
      NicheRow[]
    >;
  }
  return db
    .select(cols)
    .from(niches)
    .where(inArray(niches.state, [...SCANNABLE_STATES]))
    .limit(limit) as Promise<NicheRow[]>;
}

async function hasOpenFlag(db: ServiceDb, nicheId: string): Promise<boolean> {
  const rows = await db
    .select({ id: killFlags.id })
    .from(killFlags)
    .where(and(eq(killFlags.nicheId, nicheId), sql`confirmed_at is null and dismissed_at is null`))
    .limit(1);
  return rows.length > 0;
}

// -----------------------------------------------------------------------------
// Default metrics adapter (DB). Revenue from countable conversions on the
// niche's pages; organic clicks from the niche tenant's GSC rows. Google
// manual actions aren't in the DB (external GSC) → false until wired.
// -----------------------------------------------------------------------------

export function createDefaultKillMetricsAdapter(db: ServiceDb): KillMetricsAdapter {
  return {
    async fetch(niche, cutoff) {
      const pageRows = await db
        .select({ id: pages.id })
        .from(pages)
        .where(eq(pages.nicheId, niche.id));
      const pageIds = pageRows.map((p) => p.id);

      let trailing30dRevenueEur = 0;
      if (pageIds.length > 0) {
        const convRows = await db
          .select({ commissionCents: conversions.commissionCents, status: conversions.status })
          .from(conversions)
          .where(and(gte(conversions.occurredAt, cutoff), inArray(conversions.pageId, pageIds)));
        trailing30dRevenueEur =
          convRows
            .filter((c) => conversionCountsAsRevenue(canonicalConversionStatus(c.status)))
            .reduce((sum, c) => sum + c.commissionCents, 0) / 100;
      }

      let trailing30dOrganicClicks = 0;
      if (niche.tenantId) {
        const cutoffDate = cutoff.toISOString().slice(0, 10);
        const gscRows = await db
          .select({ clicks: gscMetrics.clicks })
          .from(gscMetrics)
          .where(and(eq(gscMetrics.tenantId, niche.tenantId), gte(gscMetrics.date, cutoffDate)));
        trailing30dOrganicClicks = gscRows.reduce((sum, g) => sum + (g.clicks ?? 0), 0);
      }

      return { trailing30dRevenueEur, trailing30dOrganicClicks, hasGoogleManualAction: false };
    },
  };
}
