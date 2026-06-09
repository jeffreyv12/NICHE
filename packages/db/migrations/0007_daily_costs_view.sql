-- Migration 0007: daily_costs view (Phase 6.3.1)
--
-- Aggregates agent_runs by calendar day so the costs dashboard can query
-- pre-rolled numbers instead of scanning every run row. A plain view is used
-- rather than a materialized view: at MVP scale (hundreds of runs/day) the
-- query planner handles the aggregation efficiently; we can convert to MATVIEW
-- + cron refresh once row counts make it necessary.

create or replace view daily_costs as
select
  date_trunc('day', started_at)::date            as day,
  agent,
  model,
  count(*)                                        as run_count,
  coalesce(sum(cost_eur), 0)                      as cost_eur,
  coalesce(sum(input_tokens), 0)                  as input_tokens,
  coalesce(sum(cache_read_tokens), 0)             as cache_read_tokens,
  coalesce(sum(output_tokens), 0)                 as output_tokens,
  count(*) filter (where is_batch = true)         as batch_runs,
  count(*) filter (where status = 'failed')       as failed_runs
from agent_runs
group by 1, 2, 3;

comment on view daily_costs is
  'Per-day per-agent per-model cost roll-up. Replaces scanning agent_runs for historical cost analysis.';
