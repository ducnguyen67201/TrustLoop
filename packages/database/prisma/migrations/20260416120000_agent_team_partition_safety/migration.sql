-- Widen AgentTeamRunEvent's forward partition margin.
--
-- The original migration pre-created 4 months of partitions and the rotation
-- activity initially kept 3 months ahead. A single missed cron across a
-- month boundary could exhaust the margin and start failing inserts. With
-- this migration + the widened FUTURE_PARTITIONS_TO_KEEP=6 constant, a
-- multi-month scheduler outage is tolerated without insert failure.
--
-- We intentionally do NOT add a DEFAULT partition: once rows land in the
-- default, subsequent CREATE TABLE … PARTITION OF … FOR VALUES FROM (…)
-- fails with "updated partition constraint ... would be violated" if any
-- default-partition rows match the new range. Operators who want the
-- additional safety net should add it with a documented runbook for
-- draining the default before reattaching a range partition.

DO $$
DECLARE
  start_of_month DATE := date_trunc('month', CURRENT_DATE)::DATE;
  m              INT;
  lo             DATE;
  hi             DATE;
  part_name      TEXT;
BEGIN
  -- Months 4..6 relative to CURRENT_DATE. Combined with months 0..3 from
  -- the initial migration, this gives 7 months of forward margin the day
  -- this ships. Nightly rotation keeps that buffer rolling forward.
  FOR m IN 4..6 LOOP
    lo := (start_of_month + (m    || ' month')::INTERVAL)::DATE;
    hi := (start_of_month + ((m+1)|| ' month')::INTERVAL)::DATE;
    part_name := 'AgentTeamRunEvent_' || to_char(lo, 'YYYYMM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF "AgentTeamRunEvent" FOR VALUES FROM (%L) TO (%L)',
      part_name, lo, hi
    );
  END LOOP;
END $$;
