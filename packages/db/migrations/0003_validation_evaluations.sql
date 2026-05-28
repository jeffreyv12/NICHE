-- =============================================================================
-- NicheFinder — Migration 0003: validation_evaluations
-- =============================================================================
-- Phase 3.3 Validation Agent.
--
-- The agent produces a GO/PIVOT/KILL *recommendation* per niche under
-- validation; it does NOT change niches.state itself (CLAUDE.md non-negotiable
-- #1 + #13 — human approves at the gate). Each agent run writes one row here.
-- The operator later confirms a row in the admin UI, which is what transitions
-- niches.state and stamps confirmed_at / confirmed_by_email / resulting_state.
--
-- Mirrors promotion_evaluations (migration 0001) in shape and access model.
-- =============================================================================

create table validation_evaluations (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid not null references niches(id) on delete cascade,
  evaluated_at timestamptz not null default now(),
  window_days integer not null,
  -- Final (post-safeguard) recommendation surfaced to the operator.
  decision text not null check (decision in ('go', 'pivot', 'kill')),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  -- The model's pre-safeguard decision, preserved for telemetry / audit.
  model_decision text not null check (model_decision in ('go', 'pivot', 'kill')),
  -- Which host safeguard amended the decision, if any.
  safeguard_reason text,
  rationale text not null,
  key_metrics jsonb not null,
  next_actions jsonb not null,
  -- Full metrics bundle handed to the agent (ValidationInput) for audit.
  metrics jsonb not null,
  agent_run_id uuid,
  -- Operator confirmation (the approval gate).
  confirmed_at timestamptz,
  confirmed_by_email text,
  resulting_state niche_state,
  created_at timestamptz not null default now()
);

create index validation_evaluations_niche_eval_idx
  on validation_evaluations (niche_id, evaluated_at desc);

-- Unconfirmed evaluations are the operator's work queue.
create index validation_evaluations_unconfirmed_idx
  on validation_evaluations (evaluated_at desc)
  where confirmed_at is null;

-- RLS: admin read; writes via service-role (agent plane + confirm action).
alter table validation_evaluations enable row level security;

create policy "admins read validation_evaluations"
  on validation_evaluations for select using (is_admin());
