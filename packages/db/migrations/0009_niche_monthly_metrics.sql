-- =============================================================================
-- NicheFinder — Migration 0009: niche_monthly_metrics (per-niche monthly close)
-- =============================================================================
-- Phase 5.4 support. The promotion gate (docs/PROMOTION_GATE.md) is expressed in
-- CONSECUTIVE CALENDAR MONTHS (≥€150 avg, no month below €75, 3 months running).
--
-- Before this table, the promotion job aggregated revenue/clicks by TENANT_ID —
-- so every niche under the `main` authority tenant (subfolder model) was judged
-- against tenant-wide totals, not its own. This table holds an immutable monthly
-- close PER NICHE, so the gate reads stable per-niche figures and a late refund
-- only mutates a recent month rather than silently re-deriving all history.
--
-- The nightly rollup job (apps/scrapers/src/jobs/nicheMonthlyMetrics.ts) writes
-- here from conversions → pages.niche_id, counting only countable conversions.
--
-- SCOPE: revenue only. organic_clicks is intentionally NULLABLE and unset — per-
-- niche organic clicks are not derivable yet (gsc_metrics is tenant-grain; the
-- GSC pull omits the `page` dimension). A follow-up adds page-level attribution
-- and backfills this column. TODO(gsc-page-dim).
-- =============================================================================

create table niche_monthly_metrics (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid not null references niches(id) on delete cascade,
  -- Denormalised tenant for tenant-scoped reads; mirrors niches.tenant_id which
  -- is nullable + ON DELETE SET NULL.
  tenant_id uuid references tenants(id) on delete set null,
  -- First-of-month (UTC) bucket key, e.g. 2026-06-01.
  month date not null,
  -- Countable commission for the month, EUR.
  revenue_eur numeric(12, 2) not null default 0,
  -- Number of countable conversions in the month.
  conversions_count integer not null default 0,
  -- Per-niche organic clicks — NULL until the GSC page-dimension pull lands.
  organic_clicks integer,
  -- When this monthly close was last (re)computed by the rollup job.
  computed_at timestamptz not null default now(),
  unique (niche_id, month)
);

create index niche_monthly_metrics_niche_month_idx
  on niche_monthly_metrics (niche_id, month desc);
create index niche_monthly_metrics_tenant_idx
  on niche_monthly_metrics (tenant_id);

-- RLS: admin read only; the rollup job writes via the service role (which
-- bypasses RLS). Mirrors kill_flags / promotion_evaluations. No tenant on the
-- public read path touches this table (CLAUDE.md #9).
alter table niche_monthly_metrics enable row level security;

create policy "admins read niche_monthly_metrics"
  on niche_monthly_metrics for select using (is_admin());
