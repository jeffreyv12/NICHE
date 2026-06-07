-- Phase 5.5 — promotion migration state machine.
--
-- Tracks progress through the 13-step promotion procedure
-- (docs/PROMOTION_GATE.md). Each row = one niche-promotion run.
-- Steps are numbered 0–12. On failure the operator retries from the
-- failed step; completed steps are not re-run.

create table promotion_migrations (
  id                    uuid primary key default gen_random_uuid(),
  niche_id              uuid references niches(id) on delete set null,
  domain_registration_id uuid references domain_registrations(id) on delete set null,
  -- 'pending' | 'running' | 'paused' | 'done' | 'failed'
  status                text not null default 'pending',
  current_step          integer not null default 0,
  -- jsonb array of {step, status, started_at, finished_at, error}
  step_logs             jsonb not null default '[]',
  operator_email        text,
  started_at            timestamptz not null default now(),
  completed_at          timestamptz,
  failed_at             timestamptz,
  failed_step           integer,
  created_at            timestamptz not null default now()
);

create index promotion_migrations_niche_idx
  on promotion_migrations (niche_id, started_at desc);

-- Only one running migration per niche at a time.
create unique index promotion_migrations_one_running_per_niche
  on promotion_migrations (niche_id)
  where status in ('pending', 'running', 'paused');

alter table promotion_migrations enable row level security;

create policy "admins read promotion_migrations"
  on promotion_migrations for select using (is_admin());
