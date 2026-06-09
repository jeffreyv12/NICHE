-- =============================================================================
-- NicheFinder — Migration 0008: harden views (security_invoker) + fn search_path
-- =============================================================================
-- Closes the RLS-bypass surfaced by the Supabase security advisor after 0001/0007.
--
-- Postgres views default to SECURITY DEFINER semantics: they execute as the view
-- OWNER (postgres), so they bypass the row-level security of the *querying* role.
-- Because these three views live in `public`, PostgREST exposes them to the
-- `anon` role at /rest/v1/<view>. That means an unauthenticated request could
-- read admin-only aggregates (Claude spend, revenue, organic traffic) straight
-- out of agent_runs / conversions / gsc_metrics — defeating the admin-only RLS
-- those base tables carry. This violates CLAUDE.md non-negotiable #9 (RLS strict;
-- never let a read escape) and the "no RLS bypass on user-facing read paths" rule.
--
-- Fix: switch each view to security_invoker = on (Postgres 15+). The view then
-- runs with the CALLER's permissions and RLS, so an anon/authenticated request
-- resolves the base tables under their own policies (admin-only → empty result),
-- while the admin dashboard (admin JWT / service-role) keeps full visibility.
-- ALTER VIEW ... SET is used instead of CREATE OR REPLACE so the view bodies are
-- untouched and the change is trivially reversible (set security_invoker = off).
--
-- Also fixes WARN 0011: set_updated_at() had a mutable search_path. Pinning it to
-- empty removes the search-path-injection vector; now() resolves from pg_catalog
-- (always implicitly present), so the trigger behaviour is unchanged.
--
-- Deliberately DEFERRED (logged, not fixed here, to keep this migration small):
--   * pg_trgm installed in public (WARN 0014) — moving it to a dedicated schema
--     is more invasive; no trigram indexes exist yet, so risk is currently nil.
--   * is_admin() / rls_auto_enable() executable by anon/authenticated (WARN
--     0028/0029) — is_admin() is intended to be called inside RLS policies and
--     only ever returns the caller's own admin boolean; rls_auto_enable() is an
--     event-trigger function that is inert outside DDL context. Both low-risk.
-- =============================================================================

alter view v_niche_kpis_90d  set (security_invoker = on);
alter view v_claude_spend_mtd set (security_invoker = on);
alter view daily_costs        set (security_invoker = on);

alter function set_updated_at() set search_path = '';
