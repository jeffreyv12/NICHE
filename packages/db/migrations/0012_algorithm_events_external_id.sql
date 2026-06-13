-- =============================================================================
-- NicheFinder — Migration 0012: algorithm_events.external_id (idempotent ingest)
-- =============================================================================
-- The daily Google Search Status ingestion (apps/scrapers algorithmEventsIngest)
-- re-fetches the full incidents feed each run. Without a stable external key it
-- would INSERT a fresh row for the same ranking update on every run, and an
-- ongoing core update would never have its `ended_at` filled in when Google
-- later closes the rollout. `external_id` is the Google incident id; the unique
-- (source, external_id) lets the job UPSERT instead of duplicating.
--
-- NULL external_id stays allowed (Postgres treats NULLs as distinct in a unique
-- index), so the operator can still hand-seed historical core-update dates with
-- no external id — those never collide with the ingestion's keyed rows.
-- =============================================================================

alter table algorithm_events
  add column external_id text;

-- Provenance + external id together are unique. Two ingested rows for the same
-- Google incident collide and upsert; hand-seeded rows (external_id NULL) don't.
create unique index algorithm_events_source_external_id_key
  on algorithm_events (source, external_id);
