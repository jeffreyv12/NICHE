-- =============================================================================
-- NicheFinder — Migration 0010: gsc_page_metrics (page-grain daily GSC clicks)
-- =============================================================================
-- Phase 3.2 / 5.4 support. Closes TODO(gsc-page-dim): per-niche organic clicks.
--
-- `gsc_metrics` is TENANT-grain (unique on tenant_id+date) — it cannot answer
-- "how many organic clicks did THIS NICHE get", only the whole site. This table
-- stores GSC's `page` dimension at (tenant_id, date, page_path) grain. The
-- nightly niche-monthly-metrics rollup attributes each page to its niche via
-- page_path → pages.full_path → niche_id and writes the per-niche monthly total
-- into niche_monthly_metrics.organic_clicks (which 0009 left NULLABLE for this).
--
-- gsc_metrics is intentionally left UNTOUCHED: the tenant-grain branded-clicks
-- (C4) and non-brand-long-tail-share (C2 sub-check) criteria still read it.
--
-- page_path is stored ALREADY-NORMALIZED by the GSC pull (scheme/host/query
-- stripped, trailing slash dropped) so it compares equal to a normalized
-- full_path. RLS: admin read only; the pull writes via the service role.
-- =============================================================================

create table gsc_page_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- GSC date for the row.
  date date not null,
  -- Normalized page path, e.g. "/test/koffie/beste-machine" (no host/query/slash).
  page_path text not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  fetched_at timestamptz not null default now(),
  unique (tenant_id, date, page_path)
);

-- Rollup reads a trailing date window for all pages of a tenant.
create index gsc_page_metrics_tenant_date_idx
  on gsc_page_metrics (tenant_id, date);

-- RLS: admin read only; the daily GSC pull writes via the service role (which
-- bypasses RLS). Mirrors gsc_metrics / niche_monthly_metrics. No tenant on the
-- public read path touches this table (CLAUDE.md #9).
alter table gsc_page_metrics enable row level security;

create policy "admins read gsc_page_metrics"
  on gsc_page_metrics for select using (is_admin());
