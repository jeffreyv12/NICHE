-- =============================================================================
-- NicheFinder — Migration 0014: job_triggers (admin-initiated job queue)
-- =============================================================================
-- Lets the admin UI queue a one-off run of any background job without SSH.
-- The Hetzner job-dispatcher service polls this table every 30 s and spawns
-- the appropriate bin. Only jobs in the fixed ALLOWED_JOBS allowlist can be
-- triggered; the dispatcher rejects any unknown job_id.
--
-- Web app (Vercel) INSERTs rows via the service role (server action).
-- Dispatcher (Hetzner) UPDATEs rows via the service role (bypasses RLS).
-- Admin UI reads via the is_admin() policy (SELECT only).
-- =============================================================================

create table job_triggers (
  id          uuid        primary key default gen_random_uuid(),
  -- Matches the id field in the JOBS catalogue, e.g. 'discovery', 'scoring'.
  job_id      text        not null,
  -- queued | running | done | failed
  status      text        not null default 'queued'
                constraint job_triggers_status_check
                check (status in ('queued','running','done','failed')),
  triggered_by_email text,
  queued_at   timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz,
  exit_code   integer,
  -- Short error summary (first 500 chars of stderr on non-zero exit).
  error       text,
  -- Last 4 000 chars of combined stdout+stderr for quick inspection.
  output      text
);

-- Fast lookup for the dispatcher: find oldest queued row.
create index job_triggers_queued_idx on job_triggers (queued_at)
  where status = 'queued';

-- Admin can read all rows; dispatcher uses service role (bypasses RLS).
alter table job_triggers enable row level security;

create policy "admins read job_triggers"
  on job_triggers for select using (is_admin());

-- Admin can also insert (queueing a job from the server action which calls
-- requireAdmin() before running, but RLS adds a second layer).
create policy "admins insert job_triggers"
  on job_triggers for insert with check (is_admin());
