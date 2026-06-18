-- Migration 0013: store structured orchestrator output on agent_runs rows.
-- The orchestrator agent returns a validated OrchestratorOutput object; persisting
-- it as JSONB lets the admin UI display the full report without re-running the agent.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS output_json jsonb;
