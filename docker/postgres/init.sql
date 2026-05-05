DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'trustloop') THEN
    CREATE DATABASE trustloop;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'temporal') THEN
    CREATE DATABASE temporal;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'temporal_visibility') THEN
    CREATE DATABASE temporal_visibility;
  END IF;
END
$$;

-- This script runs only on a fresh Postgres data dir. Existing volumes won't
-- pick up new databases added below — for those, run manually:
--   docker exec trustloop-postgres psql -U postgres -c "CREATE DATABASE langfuse;"
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'langfuse') THEN
    CREATE DATABASE langfuse;
  END IF;
END
$$;
