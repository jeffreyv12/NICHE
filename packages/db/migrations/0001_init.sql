-- =============================================================================
-- NicheFinder — Migration 0001: initial schema
-- =============================================================================
-- Mirrors docs/DATABASE_SCHEMA.sql lines 17-591 (extensions, enums, tables,
-- triggers, views). RLS policies live in 0002_rls.sql.
--
-- Conventions:
-- - All tables have `id uuid primary key default gen_random_uuid()`
-- - All tables have `created_at timestamptz not null default now()`
-- - Updated-at handled by trigger (end of file)
-- - All tenant-scoped tables have `tenant_id uuid not null references tenants(id)`
-- - All money in cents (integer), FX in EUR
-- - All percentages as integer 0..100
-- =============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ENUMS --------------------------------------------------------------------

create type niche_state as enum (
  'candidate', 'approved_for_validation', 'validating',
  'go', 'pivot', 'building', 'mature', 'promoted', 'killed', 'archived'
);

create type page_state as enum (
  'draft', 'pending_review', 'approved', 'published', 'rejected', 'archived'
);

create type approval_decision as enum (
  'approved', 'rejected', 'changes_requested'
);

create type page_kind as enum (
  'homepage', 'category', 'product_review', 'comparison',
  'buying_guide', 'how_to', 'informational', 'legal', 'test_page', 'about'
);

create type agent_name as enum (
  'discovery', 'scoring', 'validation', 'content', 'promotion', 'orchestrator'
);

create type claude_model as enum (
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-7'
);

create type affiliate_network as enum (
  'bol', 'awin', 'daisycon', 'digistore24', 'impact', 'other'
);

create type tenant_kind as enum (
  'main_authority', 'subfolder_niche', 'promoted_niche'
);

create type click_outcome as enum (
  'pending', 'converted', 'rejected', 'expired'
);

create type kill_reason as enum (
  'low_revenue_month_6', 'low_traffic_month_6', 'manual_operator_kill',
  'kill_list_match', 'duplicate_topic', 'google_penalty', 'other'
);

create type promotion_evaluation_result as enum (
  'not_ready', 'ready', 'blocked_by_update_window', 'blocked_by_single_source'
);

-- TENANTS -----------------------------------------------------------------

create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  kind tenant_kind not null,
  hostname text,
  path_prefix text,
  is_active boolean not null default true,
  is_promoted boolean not null default false,
  promoted_at timestamptz,
  previous_path_prefix text,
  niche_id uuid,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hostname_or_path check (hostname is not null or path_prefix is not null)
);

create unique index tenants_hostname_unique on tenants (hostname) where hostname is not null;
create unique index tenants_path_prefix_unique on tenants (path_prefix) where path_prefix is not null;

-- ADMIN -------------------------------------------------------------------

create table allowed_admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  added_at timestamptz not null default now()
);

-- NICHE CANDIDATES --------------------------------------------------------

create table niche_candidates (
  id uuid primary key default gen_random_uuid(),
  surfaced_at timestamptz not null default now(),
  source text not null,
  raw jsonb not null,
  topic text not null,
  topic_slug text not null,
  related_keywords text[] not null default '{}',
  trademark_check_state text not null default 'pending',
  trademark_check_at timestamptz,
  trademark_conflicts jsonb,
  kill_list_match jsonb,
  created_at timestamptz not null default now()
);

create index niche_candidates_topic_slug_idx on niche_candidates (topic_slug);
create index niche_candidates_source_surfaced_idx on niche_candidates (source, surfaced_at desc);

-- NICHE SCORES ------------------------------------------------------------

create table niche_scores (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references niche_candidates(id) on delete cascade,
  scored_at timestamptz not null default now(),
  model claude_model not null,
  total_score integer not null check (total_score between 0 and 100),
  breakdown jsonb not null,
  rubric_version text not null,
  agent_run_id uuid,
  notes text
);

create index niche_scores_candidate_idx on niche_scores (candidate_id, scored_at desc);
create index niche_scores_total_idx on niche_scores (total_score desc, scored_at desc);

-- NICHES ------------------------------------------------------------------

create table niches (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references niche_candidates(id),
  tenant_id uuid references tenants(id) on delete set null,
  topic text not null,
  topic_slug text not null unique,
  state niche_state not null default 'candidate',
  approved_for_validation_at timestamptz,
  validation_started_at timestamptz,
  validation_decided_at timestamptz,
  building_started_at timestamptz,
  mature_at timestamptz,
  promoted_at timestamptz,
  killed_at timestamptz,
  kill_reason kill_reason,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index niches_state_idx on niches (state);
create index niches_tenant_idx on niches (tenant_id);

alter table tenants add constraint tenants_niche_fk foreign key (niche_id) references niches(id);

-- PAGES -------------------------------------------------------------------

create table pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  niche_id uuid references niches(id) on delete set null,
  slug text not null,
  full_path text not null,
  kind page_kind not null,
  title text not null,
  meta_description text,
  body_md text not null,
  body_html text,
  schema_jsonld jsonb,
  author_name text not null default '',
  author_byline_jsonld jsonb,
  ai_assisted boolean not null default true,
  ai_disclosure_jsonld jsonb,
  state page_state not null default 'draft',
  approved_at timestamptz,
  approved_by_email text,
  published_at timestamptz,
  last_edited_at timestamptz,
  archived_at timestamptz,
  redirect_to_full_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create index pages_tenant_state_idx on pages (tenant_id, state);
create index pages_full_path_idx on pages (full_path);
create index pages_niche_idx on pages (niche_id);

-- CLAIMS + CLAIM SOURCES --------------------------------------------------

create table claims (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  claim_text text not null,
  claim_type text not null,
  is_sourced boolean not null default false,
  created_at timestamptz not null default now()
);

create index claims_page_idx on claims (page_id);

create table claim_sources (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references claims(id) on delete cascade,
  source_kind text not null,
  source_url text,
  first_party_test_id uuid,
  fetched_at timestamptz,
  excerpt text,
  created_at timestamptz not null default now()
);

create index claim_sources_claim_idx on claim_sources (claim_id);

-- FIRST-PARTY TESTS -------------------------------------------------------

create table first_party_tests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  niche_id uuid references niches(id),
  product_name text not null,
  test_started_at date,
  test_finished_at date,
  test_summary_md text,
  photos jsonb,
  rating integer check (rating between 1 and 10),
  pros text[],
  cons text[],
  affiliate_links jsonb,
  created_by_email text,
  created_at timestamptz not null default now()
);

alter table claim_sources
  add constraint claim_sources_fpt_fk foreign key (first_party_test_id) references first_party_tests(id);

-- PRODUCTS ----------------------------------------------------------------

create table products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  niche_id uuid references niches(id),
  external_id text,
  source affiliate_network,
  name text not null,
  brand text,
  category text,
  description text,
  image_url text,
  price_cents integer,
  currency text not null default 'EUR',
  fetched_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_tenant_idx on products (tenant_id);
create index products_external_idx on products (source, external_id);

-- AFFILIATE LINKS ---------------------------------------------------------

create table affiliate_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  niche_id uuid references niches(id),
  product_id uuid references products(id),
  network affiliate_network not null,
  destination_url text not null,
  tracking_url text not null,
  subid text not null,
  short_code text not null unique,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

create index affiliate_links_tenant_idx on affiliate_links (tenant_id);
create index affiliate_links_short_code_idx on affiliate_links (short_code);

-- CLICKS ------------------------------------------------------------------

create table clicks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  affiliate_link_id uuid not null references affiliate_links(id) on delete cascade,
  page_id uuid references pages(id),
  occurred_at timestamptz not null default now(),
  ip_hash text,
  user_agent text,
  referrer text,
  is_bot boolean not null default false,
  bot_score integer,
  cohort text,
  outcome click_outcome not null default 'pending',
  outcome_set_at timestamptz
);

create index clicks_tenant_occurred_idx on clicks (tenant_id, occurred_at desc);
create index clicks_link_idx on clicks (affiliate_link_id);

-- CONVERSIONS -------------------------------------------------------------

create table conversions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  network affiliate_network not null,
  network_transaction_id text not null,
  affiliate_link_id uuid references affiliate_links(id),
  click_id uuid references clicks(id),
  page_id uuid references pages(id),
  product_external_id text,
  amount_cents integer not null,
  commission_cents integer not null,
  currency text not null default 'EUR',
  occurred_at timestamptz not null,
  status text not null,
  status_set_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (network, network_transaction_id)
);

create index conversions_tenant_occurred_idx on conversions (tenant_id, occurred_at desc);
create index conversions_status_idx on conversions (status);

-- GSC METRICS -------------------------------------------------------------

create table gsc_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  date date not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  ctr numeric(6, 4),
  avg_position numeric(6, 2),
  branded_clicks integer not null default 0,
  non_brand_long_tail_clicks integer not null default 0,
  by_query jsonb,
  fetched_at timestamptz not null default now(),
  unique (tenant_id, date)
);

create index gsc_metrics_tenant_date_idx on gsc_metrics (tenant_id, date desc);

-- PROMOTION EVALUATIONS ---------------------------------------------------

create table promotion_evaluations (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid not null references niches(id) on delete cascade,
  evaluated_at timestamptz not null default now(),
  result promotion_evaluation_result not null,
  criteria jsonb not null,
  recommendation text,
  agent_run_id uuid
);

create index promotion_evaluations_niche_eval_idx on promotion_evaluations (niche_id, evaluated_at desc);

-- DOMAIN REGISTRATIONS ----------------------------------------------------

create table domain_registrations (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid references niches(id),
  tenant_id uuid references tenants(id),
  hostname text not null unique,
  registrar text not null,
  registered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  auto_renew boolean not null default true,
  registration_cost_cents integer,
  ssl_provisioned_at timestamptz,
  dns_propagated_at timestamptz,
  vercel_attached_at timestamptz,
  status text not null default 'pending',
  notes text,
  created_at timestamptz not null default now()
);

-- AGENT RUNS --------------------------------------------------------------

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent agent_name not null,
  model claude_model not null,
  parent_run_id uuid references agent_runs(id),
  niche_id uuid references niches(id),
  page_id uuid references pages(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  error text,
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  cost_eur numeric(10, 4),
  is_batch boolean not null default false,
  batch_id text,
  input_hash text,
  output_hash text
);

create index agent_runs_agent_started_idx on agent_runs (agent, started_at desc);
create index agent_runs_niche_idx on agent_runs (niche_id);
create index agent_runs_cost_idx on agent_runs (started_at desc, cost_eur desc);

-- KILLS -------------------------------------------------------------------

create table kills (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid not null references niches(id),
  killed_at timestamptz not null default now(),
  reason kill_reason not null,
  details text,
  redirect_to_niche_id uuid references niches(id),
  decided_by text
);

-- COST LEDGER -------------------------------------------------------------

create table cost_ledger (
  id uuid primary key default gen_random_uuid(),
  occurred_on date not null,
  category text not null,
  description text,
  amount_cents integer not null,
  currency text not null default 'EUR',
  tenant_id uuid references tenants(id),
  niche_id uuid references niches(id),
  created_at timestamptz not null default now()
);

create index cost_ledger_occurred_idx on cost_ledger (occurred_on desc);

-- TRIGGERS: updated_at on every table that has the column --------------------

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_attribute a on a.attrelid = c.oid
    where a.attname = 'updated_at'
      and c.relkind = 'r'
      and c.relnamespace = (select oid from pg_namespace where nspname = 'public')
  loop
    execute format('create trigger %I_set_updated_at before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end$$;

-- VIEWS -------------------------------------------------------------------

create or replace view v_niche_kpis_90d as
select
  n.id as niche_id,
  n.tenant_id,
  n.topic,
  n.state,
  coalesce(sum(c.commission_cents) filter (where c.occurred_at >= now() - interval '90 days'), 0) / 100.0 as revenue_eur_90d,
  count(distinct c.id) filter (where c.occurred_at >= now() - interval '90 days') as conversions_90d,
  coalesce(sum(g.clicks) filter (where g.date >= current_date - 90), 0) as organic_clicks_90d,
  coalesce(sum(g.branded_clicks) filter (where g.date >= current_date - 90), 0) as branded_clicks_90d,
  count(distinct c.network) filter (where c.occurred_at >= now() - interval '90 days') as active_networks_90d
from niches n
left join conversions c on c.tenant_id = n.tenant_id and c.status in ('approved', 'paid')
left join gsc_metrics g on g.tenant_id = n.tenant_id
group by n.id, n.tenant_id, n.topic, n.state;

create or replace view v_claude_spend_mtd as
select
  date_trunc('month', started_at) as month,
  agent,
  model,
  count(*) as call_count,
  sum(cost_eur) as cost_eur_total,
  avg(cost_eur) as cost_eur_avg
from agent_runs
where status = 'success'
  and started_at >= date_trunc('month', now())
group by date_trunc('month', started_at), agent, model
order by month desc, agent, model;
