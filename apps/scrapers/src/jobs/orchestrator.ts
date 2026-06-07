// Phase 6.1 — weekly portfolio orchestrator job.
//
// Mon 06:00 NL cron in production (orchestrator-once.ts CLI). Gathers a
// portfolio snapshot from the DB, calls the Orchestrator Agent (Opus 4.7),
// and optionally POSTs the headline + action items to a Slack or Discord
// webhook. NEVER auto-kills or auto-promotes — it only writes a report
// (CLAUDE.md non-negotiables #1 + #13).

import { type RunAgentRuntime, orchestratorAgent } from "@nichefinder/agent-sdk";
import {
  type ServiceDb,
  agentRuns,
  costLedger,
  gscMetrics,
  kills,
  niches,
  pages,
  promotionEvaluations,
} from "@nichefinder/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface RunOrchestratorJobOptions {
  db: ServiceDb;
  runtime: RunAgentRuntime;
  /** Injectable snapshot builder for tests. Defaults to the DB adapter. */
  snapshot?: PortfolioSnapshotAdapter;
  /** ISO timestamp "now". Default real now. */
  asOf?: string;
  /** Slack webhook URL (optional). Env: SLACK_WEBHOOK_URL. */
  slackWebhookUrl?: string;
  /** Discord webhook URL (optional). Env: DISCORD_WEBHOOK_URL. */
  discordWebhookUrl?: string;
  /** Claude monthly budget for mechanical budget alerts. */
  claudeBudgetEur?: number;
}

export interface RunOrchestratorJobResult {
  headline: string;
  alertCount: number;
  syntheticAlertCount: number;
  actionItemCount: number;
  agentRunId: string;
  costEur: number;
  webhookPosted: boolean;
}

// ---------------------------------------------------------------------------
// Snapshot adapter (injectable for unit tests)
// ---------------------------------------------------------------------------

export interface PortfolioSnapshotAdapter {
  buildInput(asOf: Date): Promise<orchestratorAgent.OrchestratorInput>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runOrchestratorJob(
  opts: RunOrchestratorJobOptions,
): Promise<RunOrchestratorJobResult> {
  const asOf = new Date(opts.asOf ?? new Date().toISOString());
  const weekOf = asOf.toISOString().slice(0, 10);
  const claudeBudgetEur =
    opts.claudeBudgetEur ?? Number(process.env.CLAUDE_MONTHLY_BUDGET_EUR ?? 200);

  const adapter = opts.snapshot ?? createDefaultSnapshotAdapter(opts.db, claudeBudgetEur);
  const input = await adapter.buildInput(asOf);

  const { output, syntheticAlerts, agentRunId, costEur } =
    await orchestratorAgent.runOrchestratorAgent(opts.runtime, {
      ...input,
      week_of: weekOf,
    });

  let webhookPosted = false;
  const webhookUrl = opts.slackWebhookUrl ?? opts.discordWebhookUrl;
  if (webhookUrl) {
    webhookPosted = await postWebhook(webhookUrl, output.headline, output.operator_action_items);
  }

  return {
    headline: output.headline,
    alertCount: output.alerts.length,
    syntheticAlertCount: syntheticAlerts.length,
    actionItemCount: output.operator_action_items.length,
    agentRunId,
    costEur,
    webhookPosted,
  };
}

// ---------------------------------------------------------------------------
// Webhook post (Slack + Discord both accept { text: "..." })
// ---------------------------------------------------------------------------

async function postWebhook(url: string, headline: string, actionItems: string[]): Promise<boolean> {
  const lines = ["*NicheFinder weekly review*", headline];
  if (actionItems.length > 0) {
    lines.push("", "*Action items:*");
    for (const item of actionItems) lines.push(`• ${item}`);
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n") }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Default DB snapshot adapter
// ---------------------------------------------------------------------------

export function createDefaultSnapshotAdapter(
  db: ServiceDb,
  claudeBudgetEur: number,
): PortfolioSnapshotAdapter {
  return {
    async buildInput(asOf: Date): Promise<orchestratorAgent.OrchestratorInput> {
      const monthStart = new Date(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1).toISOString();
      const cutoff90d = new Date(asOf.getTime() - 90 * 86_400_000).toISOString();

      const [nicheRows, claudeMtd, ledgerRows, killRows, promotionRows, heroEdits, tenantClicks] =
        await Promise.all([
          fetchNiches(db),
          fetchClaudeMtdSpend(db, monthStart),
          fetchCostLedger(db, monthStart),
          fetchKills90d(db, cutoff90d),
          fetchPromotions90d(db, cutoff90d),
          fetchHeroEdits(db),
          fetchTenantClicks(
            db,
            new Date(asOf.getTime() - 30 * 86_400_000).toISOString().slice(0, 10),
          ),
        ]);

      const asOfMs = asOf.getTime();
      const nicheSnapshots = nicheRows.map((n) => ({
        topic: n.topic,
        topic_slug: n.topicSlug,
        state: n.state,
        days_in_state: Math.max(
          0,
          Math.floor((asOfMs - stateEnteredAt(n, asOf).getTime()) / 86_400_000),
        ),
        organic_clicks_last_month: tenantClicks.get(n.tenantId ?? "") ?? undefined,
        last_hero_edit_days_ago: heroEditDaysAgo(heroEdits, n.id, asOf),
      }));

      const infraMtdEur = ledgerRows.reduce((sum, r) => sum + r.amountCents / 100, 0);
      const costLedgerMtd = groupLedger(ledgerRows);

      return {
        week_of: asOf.toISOString().slice(0, 10),
        niches: nicheSnapshots,
        spend: {
          claude_mtd_eur: claudeMtd,
          claude_budget_eur: claudeBudgetEur,
          cost_ledger_mtd: costLedgerMtd,
          paid_traffic_mtd_eur: 0,
        },
        kills_90d: killRows,
        promotions_90d: promotionRows,
        algorithm_events_30d: [],
      };
    },
  };
}

// ---------------------------------------------------------------------------
// DB queries
// ---------------------------------------------------------------------------

interface NicheSnapshotRow {
  id: string;
  topic: string;
  topicSlug: string;
  tenantId: string | null;
  state: string;
  createdAt: Date;
  validationStartedAt: Date | null;
  buildingStartedAt: Date | null;
  matureAt: Date | null;
  promotedAt: Date | null;
  killedAt: Date | null;
}

async function fetchNiches(db: ServiceDb): Promise<NicheSnapshotRow[]> {
  return db
    .select({
      id: niches.id,
      topic: niches.topic,
      topicSlug: niches.topicSlug,
      tenantId: niches.tenantId,
      state: niches.state,
      createdAt: niches.createdAt,
      validationStartedAt: niches.validationStartedAt,
      buildingStartedAt: niches.buildingStartedAt,
      matureAt: niches.matureAt,
      promotedAt: niches.promotedAt,
      killedAt: niches.killedAt,
    })
    .from(niches) as Promise<NicheSnapshotRow[]>;
}

function stateEnteredAt(n: NicheSnapshotRow, asOf: Date): Date {
  switch (n.state) {
    case "validating":
      return n.validationStartedAt ?? n.createdAt;
    case "go":
      return n.validationStartedAt ?? n.createdAt;
    case "building":
      return n.buildingStartedAt ?? n.createdAt;
    case "mature":
      return n.matureAt ?? n.createdAt;
    case "promoted":
      return n.promotedAt ?? n.createdAt;
    case "killed":
      return n.killedAt ?? n.createdAt;
    default:
      return n.createdAt;
  }
}

async function fetchClaudeMtdSpend(db: ServiceDb, monthStart: string): Promise<number> {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(cost_eur), 0)` })
    .from(agentRuns)
    .where(gte(agentRuns.startedAt, new Date(monthStart)));
  return Number(rows[0]?.total ?? 0);
}

interface LedgerRow {
  category: string;
  amountCents: number;
}

async function fetchCostLedger(db: ServiceDb, monthStart: string): Promise<LedgerRow[]> {
  return db
    .select({ category: costLedger.category, amountCents: costLedger.amountCents })
    .from(costLedger)
    .where(gte(costLedger.occurredOn, monthStart.slice(0, 10))) as Promise<LedgerRow[]>;
}

function groupLedger(rows: LedgerRow[]): Array<{ category: string; mtd_eur: number }> {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.category, (map.get(r.category) ?? 0) + r.amountCents / 100);
  return Array.from(map.entries()).map(([category, mtd_eur]) => ({ category, mtd_eur }));
}

interface KillRow {
  niche_slug: string;
  reason: string;
  killed_at: string;
}

async function fetchKills90d(db: ServiceDb, cutoff: string): Promise<KillRow[]> {
  const rows = await db
    .select({
      topicSlug: niches.topicSlug,
      reason: kills.reason,
      killedAt: kills.killedAt,
    })
    .from(kills)
    .innerJoin(niches, eq(kills.nicheId, niches.id))
    .where(gte(kills.killedAt, new Date(cutoff)));

  return rows.map((r) => ({
    niche_slug: r.topicSlug,
    reason: r.reason,
    killed_at: r.killedAt.toISOString(),
  }));
}

interface PromotionRow {
  niche_slug: string;
  result: string;
  evaluated_at: string;
  ready_since?: string;
}

async function fetchPromotions90d(db: ServiceDb, cutoff: string): Promise<PromotionRow[]> {
  const rows = await db
    .select({
      topicSlug: niches.topicSlug,
      result: promotionEvaluations.result,
      evaluatedAt: promotionEvaluations.evaluatedAt,
    })
    .from(promotionEvaluations)
    .innerJoin(niches, eq(promotionEvaluations.nicheId, niches.id))
    .where(gte(promotionEvaluations.evaluatedAt, new Date(cutoff)));

  return rows.map((r) => ({
    niche_slug: r.topicSlug,
    result: r.result,
    evaluated_at: r.evaluatedAt.toISOString(),
  }));
}

interface HeroEditRow {
  nicheId: string | null;
  lastEditedAt: Date | null;
}

// "Hero" in the promotion sense = the commercial page kinds that operators edit.
const HERO_KINDS = ["product_review", "comparison", "buying_guide"] as const;

async function fetchHeroEdits(db: ServiceDb): Promise<HeroEditRow[]> {
  return db
    .select({ nicheId: pages.nicheId, lastEditedAt: pages.lastEditedAt })
    .from(pages)
    .where(and(inArray(pages.kind, [...HERO_KINDS]), sql`last_edited_at is not null`)) as Promise<
    HeroEditRow[]
  >;
}

function heroEditDaysAgo(heroEdits: HeroEditRow[], nicheId: string, asOf: Date): number | null {
  const row = heroEdits.find((r) => r.nicheId === nicheId);
  if (!row?.lastEditedAt) return null;
  return Math.max(0, Math.floor((asOf.getTime() - row.lastEditedAt.getTime()) / 86_400_000));
}

async function fetchTenantClicks(db: ServiceDb, cutoffDate: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      tenantId: gscMetrics.tenantId,
      clicks: gscMetrics.clicks,
    })
    .from(gscMetrics)
    .where(gte(gscMetrics.date, cutoffDate));

  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.tenantId, (map.get(r.tenantId) ?? 0) + (r.clicks ?? 0));
  }
  return map;
}
