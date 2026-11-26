-- public.jobs takes ~1–2k new listings an hour and an update for every re-seen one, plus the stale sweep's deletes.
-- With Postgres' default autovacuum thresholds (20% of the table changed) dead rows pile up between passes and every
-- read of the table walks past them (in October jobs held 625 MB for 54 MB of live rows). Vacuum and re-analyse it
-- after 2% has changed instead. Settings only: nothing is locked or rewritten.
alter table public.jobs set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_limit = 1000
);
