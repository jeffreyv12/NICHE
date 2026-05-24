-- =============================================================================
-- NicheFinder — Migration 0002: Row Level Security
-- =============================================================================
-- Public (anon): read 'published' pages and active tenant config (for rendering).
-- Admin (auth.jwt() email in allowed_admins): full read.
-- Service-role (agent plane): bypasses RLS entirely.
--
-- All writes go through service-role from Next.js Route Handlers or scrapers.
-- No client-side writes for content.
-- =============================================================================

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

-- PUBLIC READS ------------------------------------------------------------

create policy "public reads active tenants" on tenants
  for select using (is_active = true);

create policy "public reads published pages" on pages
  for select using (state = 'published');

-- ADMIN READS -------------------------------------------------------------
-- Helper: factor the JWT-email-in-allowed_admins check into a SQL function
-- so every policy can call it.

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from allowed_admins a
    where a.email = (auth.jwt() ->> 'email')
  );
$$;

create policy "admins read tenants"               on tenants               for select using (is_admin());
create policy "admins read niche_candidates"      on niche_candidates      for select using (is_admin());
create policy "admins read niche_scores"          on niche_scores          for select using (is_admin());
create policy "admins read niches"                on niches                for select using (is_admin());
create policy "admins read pages"                 on pages                 for select using (is_admin());
create policy "admins read claims"                on claims                for select using (is_admin());
create policy "admins read claim_sources"         on claim_sources         for select using (is_admin());
create policy "admins read first_party_tests"     on first_party_tests     for select using (is_admin());
create policy "admins read products"              on products              for select using (is_admin());
create policy "admins read affiliate_links"       on affiliate_links       for select using (is_admin());
create policy "admins read clicks"                on clicks                for select using (is_admin());
create policy "admins read conversions"           on conversions           for select using (is_admin());
create policy "admins read gsc_metrics"           on gsc_metrics           for select using (is_admin());
create policy "admins read promotion_evaluations" on promotion_evaluations for select using (is_admin());
create policy "admins read domain_registrations"  on domain_registrations  for select using (is_admin());
create policy "admins read agent_runs"            on agent_runs            for select using (is_admin());
create policy "admins read kills"                 on kills                 for select using (is_admin());
create policy "admins read cost_ledger"           on cost_ledger           for select using (is_admin());
create policy "admins read allowed_admins"        on allowed_admins        for select using (is_admin());
