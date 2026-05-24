-- =============================================================================
-- NicheFinder — Supabase Postgres Migration 0001 (initial schema)
-- =============================================================================
-- This is the canonical schema. Run with `pnpm db:migrate`.
--
-- Conventions:
-- - All tables have `id uuid primary key default gen_random_uuid()`
-- - All tables have `created_at timestamptz not null default now()`
-- - Updated-at handled by trigger (see end of file)
-- - All tenant-scoped tables have `tenant_id uuid not null references tenants(id) on delete cascade`
-- - RLS enabled on every table; policies at the bottom
-- - Service-role key bypasses RLS (used by agents)
-- - All money in cents (integer), all FX in EUR
-- - All percentages as integer 0..100 (e.g. score=72 means 72%)
-- =============================================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- =============================================================================
-- ENUMS
-- =============================================================================

create type niche_state as enum (
  'candidate',
  'approved_for_validation',
  'validating',
  'go',
  'pivot',
  'building',
  'mature',
  'promoted',
  'killed',
  'archived'
);

create type page_state as enum (
  'draft',
  'pending_review',
  'approved',
  'published',
  'rejected',
  'archived'
);

create type approval_decision as enum (
  'approved',
  'rejected',
  'changes_requested'
);

create type page_kind as enum (
  'homepage',
  'category',
  'product_review',
  'comparison',
  'buying_guide',
  'how_to',
  'informational',
  'legal',
  'test_page',
  'about'
);

create type agent_name as enum (
  'discovery',
  'scoring',
  'validation',
  'content',
  'promotion',
  'orchestrator'
);

create type claude_model as enum (
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-7'
);

create type affiliate_network as enum (
  'bol',
  'awin',
  'daisycon',
  'digistore24',
  'impact',
  'other'
);

create type tenant_kind as enum (
  'main_authority',
  'subfolder_niche',
  'promoted_niche'
);

create type click_outcome as enum (
  'pending',
  'converted',
  'rejected',
  'expired'
);

create type kill_reason as enum (
  'low_revenue_month_6',
  'low_traffic_month_6',
  'manual_operator_kill',
  'kill_list_match',
  'duplicate_topic',
  'google_penalty',
  'other'
);

create type promotion_evaluation_result as enum (
  'not_ready',
  'ready',
  'blocked_by_update_window',
  'blocked_by_single_source'
);

-- =============================================================================
-- TENANTS — every niche subfolder + every promoted domain + the main authority
-- =============================================================================

create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                          -- 'main', 'koffie', 'fietsen', etc.
  kind tenant_kind not null,
  hostname text,                                       -- 'expertgids.nl' or 'koffie-expert.nl'; null for subfolder-only
  path_prefix text,                                    -- '/koffie' for subfolder; null for own-domain
  is_active boolean not null default true,
  is_promoted boolean not null default false,         -- true after promotion gate fires + operator approves
  promoted_at timestamptz,
  previous_path_prefix text,                          -- on a promoted tenant, the original subfolder for 301s
  niche_id uuid,                                      -- back-reference (set after niche row exists)
  config jsonb not null default '{}'::jsonb,          -- brand, seo, locale, analytics, affiliate
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hostname_or_path check (hostname is not null or path_prefix is not null)
);

create unique index tenants_hostname_unique on tenants (hostname) where hostname is not null;
create unique index tenants_path_prefix_unique on tenants (path_prefix) where path_prefix is not null;

-- =============================================================================
-- ADMIN — allowed admin users (mirror of env ADMIN_ALLOWED_EMAILS for fast lookup)
-- =============================================================================

create table allowed_admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  added_at timestamptz not null default now()
);

-- =============================================================================
-- NICHE CANDIDATES — raw discovery output, not yet scored
-- =============================================================================

create table niche_candidates (
  id uuid primary key default gen_random_uuid(),
  surfaced_at timestamptz not null default now(),
  source text not null,                                -- 'dataforseo', 'bol_trends', 'awin_programmes', 'yt_trending', 'wiki_pageviews'
  raw jsonb not null,                                  -- the original signal payload
  topic text not null,                                 -- short noun phrase, e.g. 'specialty coffee gear'
  topic_slug text not null,                            -- 'specialty-coffee-gear'
  related_keywords text[] not null default '{}',
  trademark_check_state text not null default 'pending', -- 'pending', 'clear', 'conflict', 'review'
  trademark_check_at timestamptz,
  trademark_conflicts jsonb,
  kill_list_match jsonb,                               -- non-null if matched a forbidden pattern
  created_at timestamptz not null default now()
);

create index niche_candidates_topic_slug_idx on niche_candidates (topic_slug);
create index niche_candidates_source_surfaced_idx on niche_candidates (source, surfaced_at desc);

-- =============================================================================
-- NICHE SCORES — Scoring Agent output, one row per candidate per scoring run
-- =============================================================================

create table niche_scores (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references niche_candidates(id) on delete cascade,
  scored_at timestamptz not null default now(),
  model claude_model not null,
  total_score integer not null check (total_score between 0 and 100),
  breakdown jsonb not null,                            -- per-criterion scores per the rubric
  rubric_version text not null,                        -- semver of the rubric used
  agent_run_id uuid,                                   -- foreign key to agent_runs
  notes text
);

create index niche_scores_candidate_idx on niche_scores (candidate_id, scored_at desc);
create index niche_scores_total_idx on niche_scores (total_score desc, scored_at desc);

-- =============================================================================
-- NICHES — promoted-from-candidate niches with a state machine
-- =============================================================================

create table niches (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references niche_candidates(id),  -- may be null if hand-added by operator
  tenant_id uuid references tenants(id) on delete set null,  -- assigned when subfolder created
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

-- =============================================================================
-- PAGES — every page on every tenant
-- =============================================================================

create table pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  niche_id uuid references niches(id) on delete set null,
  slug text not null,                                  -- 'beste-espressomachines-2026'
  full_path text not null,                             -- '/koffie/beste-espressomachines-2026' (subfolder) or '/beste-espressomachines-2026' (promoted)
  kind page_kind not null,
  title text not null,
  meta_description text,
  body_md text not null,                               -- canonical content as Markdown
  body_html text,                                      -- rendered HTML cache (regenerated on publish)
  schema_jsonld jsonb,                                 -- structured data block(s)
  author_name text not null default '',
  author_byline_jsonld jsonb,                          -- author Person schema
  ai_assisted boolean not null default true,           -- if any AI was used in drafting
  ai_disclosure_jsonld jsonb,                          -- aiContentDeclaration
  state page_state not null default 'draft',
  approved_at timestamptz,
  approved_by_email text,
  published_at timestamptz,
  last_edited_at timestamptz,
  archived_at timestamptz,
  redirect_to_full_path text,                          -- on archive, send 301 here
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create index pages_tenant_state_idx on pages (tenant_id, state);
create index pages_full_path_idx on pages (full_path);
create index pages_niche_idx on pages (niche_id);

-- =============================================================================
-- CLAIMS — factual claims on pages; every claim must have a source
-- =============================================================================

create table claims (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  claim_text text not null,
  claim_type text not null,                            -- 'price', 'spec', 'rating', 'test_result', 'fact'
  is_sourced boolean not null default false,
  created_at timestamptz not null default now()
);

create index claims_page_idx on claims (page_id);

create table claim_sources (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references claims(id) on delete cascade,
  source_kind text not null,                           -- 'url', 'first_party_test'
  source_url text,                                     -- if url-backed
  first_party_test_id uuid,                            -- set below
  fetched_at timestamptz,
  excerpt text,                                        -- short quote backing the claim
  created_at timestamptz not null default now()
);

create index claim_sources_claim_idx on claim_sources (claim_id);

-- =============================================================================
-- FIRST-PARTY TESTS — operator-logged hands-on tests with photos
-- =============================================================================

create table first_party_tests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  niche_id uuid references niches(id),
  product_name text not null,
  test_started_at date,
  test_finished_at date,
  test_summary_md text,
  photos jsonb,                                        -- array of {url, alt, takenAt}
  rating integer check (rating between 1 and 10),
  pros text[],
  cons text[],
  affiliate_links jsonb,                               -- preferred links for this product
  created_by_email text,
  created_at timestamptz not null default now()
);

alter table claim_sources
  add constraint claim_sources_fpt_fk foreign key (first_party_test_id) references first_party_tests(id);

-- =============================================================================
-- PRODUCTS — entities mentioned on pages; linked to affiliate offers
-- =============================================================================

create table products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,  -- nullable for cross-tenant products
  niche_id uuid references niches(id),
  external_id text,                                    -- e.g. Bol EAN, Awin product ID
  source affiliate_network,                            -- where the product feed came from
  name text not null,
  brand text,
  category text,
  description text,
  image_url text,
  price_cents integer,
  currency text not null default 'EUR',
  fetched_at timestamptz,
  raw jsonb,                                           -- full feed payload
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_tenant_idx on products (tenant_id);
create index products_external_idx on products (source, external_id);

-- =============================================================================
-- AFFILIATE LINKS — generated tracked URLs per tenant per product per network
-- =============================================================================

create table affiliate_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  niche_id uuid references niches(id),
  product_id uuid references products(id),
  network affiliate_network not null,
  destination_url text not null,                       -- what the user lands on
  tracking_url text not null,                          -- the affiliate-network URL with subids
  subid text not null,                                 -- encodes tenant+page+cohort
  short_code text not null unique,                     -- used for /r/[short_code] redirect
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

create index affiliate_links_tenant_idx on affiliate_links (tenant_id);
create index affiliate_links_short_code_idx on affiliate_links (short_code);

-- =============================================================================
-- CLICKS — every affiliate-link click that hits our /r/[short_code] redirect
-- =============================================================================

create table clicks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  affiliate_link_id uuid not null references affiliate_links(id) on delete cascade,
  page_id uuid references pages(id),
  occurred_at timestamptz not null default now(),
  ip_hash text,                                        -- never raw IP
  user_agent text,
  referrer text,
  is_bot boolean not null default false,
  bot_score integer,
  cohort text,                                         -- 'organic', 'paid_test', 'social', etc.
  outcome click_outcome not null default 'pending',
  outcome_set_at timestamptz
);

create index clicks_tenant_occurred_idx on clicks (tenant_id, occurred_at desc);
create index clicks_link_idx on clicks (affiliate_link_id);

-- =============================================================================
-- CONVERSIONS — postback events from affiliate networks
-- =============================================================================

create table conversions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  network affiliate_network not null,
  network_transaction_id text not null,                -- the network's own ID
  affiliate_link_id uuid references affiliate_links(id),
  click_id uuid references clicks(id),
  page_id uuid references pages(id),
  product_external_id text,
  amount_cents integer not null,
  commission_cents integer not null,
  currency text not null default 'EUR',
  occurred_at timestamptz not null,
  status text not null,                                -- 'pending' | 'approved' | 'rejected' | 'paid'
  status_set_at timestamptz,
  raw jsonb,                                           -- full postback payload
  created_at timestamptz not null default now(),
  unique (network, network_transaction_id)
);

create index conversions_tenant_occurred_idx on conversions (tenant_id, occurred_at desc);
create index conversions_status_idx on conversions (status);

-- =============================================================================
-- GSC METRICS — daily Google Search Console roll-up per tenant
-- =============================================================================

create table gsc_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  date date not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  ctr numeric(6,4),
  avg_position numeric(6,2),
  branded_clicks integer not null default 0,          -- queries containing the brand name
  non_brand_long_tail_clicks integer not null default 0,
  by_query jsonb,                                      -- top 100 queries with metrics
  fetched_at timestamptz not null default now(),
  unique (tenant_id, date)
);

create index gsc_metrics_tenant_date_idx on gsc_metrics (tenant_id, date desc);

-- =============================================================================
-- PROMOTION EVALUATIONS — Promotion Agent output, daily audit trail
-- =============================================================================

create table promotion_evaluations (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid not null references niches(id) on delete cascade,
  evaluated_at timestamptz not null default now(),
  result promotion_evaluation_result not null,
  criteria jsonb not null,                             -- per-criterion pass/fail with values
  recommendation text,
  agent_run_id uuid
);

create index promotion_evaluations_niche_eval_idx on promotion_evaluations (niche_id, evaluated_at desc);

-- =============================================================================
-- DOMAIN REGISTRATIONS — record of every domain we've registered
-- =============================================================================

create table domain_registrations (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid references niches(id),
  tenant_id uuid references tenants(id),
  hostname text not null unique,
  registrar text not null,                             -- 'cloudflare' | 'transip'
  registered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  auto_renew boolean not null default true,
  registration_cost_cents integer,
  ssl_provisioned_at timestamptz,
  dns_propagated_at timestamptz,
  vercel_attached_at timestamptz,
  status text not null default 'pending',              -- 'pending' | 'live' | 'expired' | 'transferred'
  notes text,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- AGENT RUNS — every Claude call, cost-tracked
-- =============================================================================

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent agent_name not null,
  model claude_model not null,
  parent_run_id uuid references agent_runs(id),
  niche_id uuid references niches(id),
  page_id uuid references pages(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',              -- 'running' | 'success' | 'failed'
  error text,
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  cost_eur numeric(10,4),
  is_batch boolean not null default false,
  batch_id text,
  input_hash text,
  output_hash text
);

create index agent_runs_agent_started_idx on agent_runs (agent, started_at desc);
create index agent_runs_niche_idx on agent_runs (niche_id);
create index agent_runs_cost_idx on agent_runs (started_at desc, cost_eur desc);

-- =============================================================================
-- KILLS — audit trail of every niche kill decision
-- =============================================================================

create table kills (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid not null references niches(id),
  killed_at timestamptz not null default now(),
  reason kill_reason not null,
  details text,
  redirect_to_niche_id uuid references niches(id),     -- where the topic hub now points
  decided_by text                                       -- 'orchestrator' | operator email
);

-- =============================================================================
-- COST LEDGER — non-Claude operational costs (Vercel, Hetzner, registrars, etc.)
-- =============================================================================

create table cost_ledger (
  id uuid primary key default gen_random_uuid(),
  occurred_on date not null,
  category text not null,                              -- 'vercel' | 'supabase' | 'hetzner' | 'registrar' | 'dataforseo' | 'paid_traffic' | 'other'
  description text,
  amount_cents integer not null,
  currency text not null default 'EUR',
  tenant_id uuid references tenants(id),
  niche_id uuid references niches(id),
  created_at timestamptz not null default now()
);

create index cost_ledger_occurred_idx on cost_ledger (occurred_on desc);

-- =============================================================================
-- TIMESTAMPS — generic updated_at trigger
-- =============================================================================

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

-- =============================================================================
-- VIEWS — convenience for the admin dashboard
-- =============================================================================

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

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- Enabled on every table. Policies:
-- - Public (anon): may read 'published' pages and the tenant config to render the site
-- - Admin (allowed_admins): full read; writes go through service-role from app routes
-- - Service-role (agent plane): bypasses RLS

alter table tenants enable row level security;
alter table allowed_admins enable row level security;
alter table niche_candidates enable row level security;
alter table niche_scores enable row level security;
alter table niches enable row level security;
alter table pages enable row level security;
alter table claims enable row level security;
alter table claim_sources enable row level security;
alter table first_party_tests enable row level security;
alter table products enable row level security;
alter table affiliate_links enable row level security;
alter table clicks enable row level security;
alter table conversions enable row level security;
alter table gsc_metrics enable row level security;
alter table promotion_evaluations enable row level security;
alter table domain_registrations enable row level security;
alter table agent_runs enable row level security;
alter table kills enable row level security;
alter table cost_ledger enable row level security;

-- Public read policies — only what's needed to render a page
create policy "public reads active tenants" on tenants
  for select using (is_active = true);

create policy "public reads published pages" on pages
  for select using (state = 'published');

-- Admin policies — anyone whose JWT email is in allowed_admins gets full read
-- (writes are service-role only)
create policy "admins read everything" on tenants
  for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));

-- Repeat the admin read policy for the rest of the tables
-- (kept inline for clarity; in a real migration, factor into a function)
create policy "admins read niche_candidates" on niche_candidates for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));
create policy "admins read niche_scores" on niche_scores for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));
create policy "admins read niches" on niches for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));
create policy "admins read pages" on pages for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));
create policy "admins read claims" on claims for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));
create policy "admins read claim_sources" on claim_sources for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));
create policy "admins read first_party_tests" on first_party_tests for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));
create policy "admins read products" on products for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));
create policy "admins read affiliate_links" on affiliate_links for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));
create policy "admins read clicks" on clicks for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));
create policy "admins read conversions" on conversions for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));
create policy "admins read gsc_metrics" on gsc_metrics for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));
create policy "admins read promotion_evaluations" on promotion_evaluations for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));
create policy "admins read domain_registrations" on domain_registrations for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));
create policy "admins read agent_runs" on agent_runs for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));
create policy "admins read kills" on kills for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));
create policy "admins read cost_ledger" on cost_ledger for select using (auth.jwt() ->> 'email' in (select email from allowed_admins));

-- =============================================================================
-- SEED — main authority tenant (run only on fresh install)
-- =============================================================================
-- The Phase-1 seed script in apps/web/scripts/seed.ts inserts:
--   - 1 row in tenants with kind='main_authority' and hostname=$PRIMARY_TENANT_HOSTNAME
--   - 1 row in allowed_admins per email in $ADMIN_ALLOWED_EMAILS
-- Don't seed niches or pages — those come from the engine.
