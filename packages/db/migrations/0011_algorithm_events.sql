-- =============================================================================
-- NicheFinder — Migration 0011: algorithm_events (Google ranking-update windows)
-- =============================================================================
-- Phase 6.1 / Promotion Gate criterion 6 ("No active Google update window",
-- docs/PROMOTION_GATE.md). A GLOBAL (not tenant-scoped) log of Google broad core
-- updates, Helpful-Content rollouts, spam updates, etc., sourced from the Google
-- Search Status dashboard. `ended_at` NULL means the rollout is STILL ongoing.
--
-- The promotion gate reads any event overlapping the trailing 30 days; if a core
-- update is rolling it returns blocked_by_update_window regardless of the other
-- criteria. The weekly orchestrator surfaces the same events in its review.
--
-- Until the daily Search-Status ingestion lands, this table is empty — which is
-- the safe default (no event = criterion passes, same as the old hardcoded []),
-- but the read path is now correct-by-construction the moment a row exists.
-- RLS: admin read only; the ingestion writes via the service role.
-- =============================================================================

create table algorithm_events (
  id uuid primary key default gen_random_uuid(),
  -- Update category, e.g. 'core_update', 'helpful_content_update', 'spam_update',
  -- 'reviews_update', 'other'. Free text (kept flexible for new Google labels).
  kind text not null,
  -- Human label as published, e.g. "March 2026 core update".
  name text,
  started_at timestamptz not null,
  -- NULL while the rollout is still in progress; set when Google marks complete.
  ended_at timestamptz,
  -- Provenance, e.g. 'google_search_status'.
  source text not null default 'google_search_status',
  created_at timestamptz not null default now()
);

-- The 30-day-window query filters/sorts by start; ongoing events (ended_at null)
-- are always candidates regardless.
create index algorithm_events_started_idx on algorithm_events (started_at);

-- RLS: admin read only; the daily ingestion writes via the service role (which
-- bypasses RLS). Global table — no tenant dimension (Google updates are global).
alter table algorithm_events enable row level security;

create policy "admins read algorithm_events"
  on algorithm_events for select using (is_admin());
