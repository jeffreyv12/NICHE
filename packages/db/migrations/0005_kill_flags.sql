-- =============================================================================
-- NicheFinder — Migration 0005: kill_flags
-- =============================================================================
-- Phase 6.2 kill-list automation.
--
-- The daily job evaluates the automatable kill criteria per niche and writes a
-- *recommendation* here; it NEVER kills (CLAUDE.md #2 + #13). The operator
-- confirms (→ a kills row + niches.state='killed') or dismisses. Mirrors
-- validation_evaluations / promotion_evaluations in shape and access model.
-- =============================================================================

create table kill_flags (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid not null references niches(id) on delete cascade,
  flagged_at timestamptz not null default now(),
  -- Matched automatable reasons (subset of kill_reason): kill_list_match,
  -- google_penalty, low_revenue_month_6, low_traffic_month_6.
  reasons text[] not null,
  -- Per-reason human-readable detail strings (KillFlag[]).
  details jsonb not null,
  -- The criteria inputs handed to the evaluator, for audit.
  metrics jsonb not null,
  -- Operator decision (the gate).
  confirmed_at timestamptz,
  confirmed_by_email text,
  resulting_kill_id uuid references kills(id),
  dismissed_at timestamptz,
  dismissed_by_email text,
  created_at timestamptz not null default now()
);

create index kill_flags_niche_idx on kill_flags (niche_id, flagged_at desc);

-- Open flags (neither confirmed nor dismissed) are the operator's work queue,
-- and at most one may exist per niche.
create unique index kill_flags_one_open_per_niche
  on kill_flags (niche_id)
  where confirmed_at is null and dismissed_at is null;

-- RLS: admin read; writes via service-role (job plane + confirm/dismiss action).
alter table kill_flags enable row level security;

create policy "admins read kill_flags"
  on kill_flags for select using (is_admin());
