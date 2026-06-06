-- =============================================================================
-- NicheFinder — Migration 0004: page polish fields
-- =============================================================================
-- Phase 4.1 Content Agent polish pass (Opus 4.7).
--
-- The polish pass returns operator advisories the review gate must show before
-- approval: operator_todos (e.g. "[BLOCKER] add affiliate disclosure"),
-- polish_notes (what the pass changed), and needs_polish_pass (host set this
-- true when a structural invariant failed). These had nowhere to live, so they
-- were dropped — now they persist on the page. polished_at stamps the last
-- Opus pass. None of this changes the approval flow: the operator still
-- approves (CLAUDE.md non-negotiable #1).
-- =============================================================================

alter table pages
  add column operator_todos text[] not null default '{}',
  add column polish_notes text,
  add column needs_polish_pass boolean not null default false,
  add column polished_at timestamptz;
