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

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'langfuse') THEN
    CREATE DATABASE langfuse;
  END IF;
END
$$;
