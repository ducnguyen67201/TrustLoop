#!/usr/bin/env bash
set -euo pipefail

DOPPLER_PROJECT="${DOPPLER_PROJECT:-trustloop}"

if [ -z "${DOPPLER_CONFIG:-}" ]; then
  echo "DOPPLER_CONFIG is required." >&2
  exit 2
fi

if [ -z "${DOPPLER_TOKEN:-}" ]; then
  echo "DOPPLER_TOKEN is required." >&2
  exit 2
fi

database_url="$(doppler secrets get DATABASE_URL \
  --project "$DOPPLER_PROJECT" \
  --config "$DOPPLER_CONFIG" \
  --plain 2>/dev/null || true)"

if [ -z "$database_url" ]; then
  echo "DATABASE_URL was not found in Doppler project '$DOPPLER_PROJECT' config '$DOPPLER_CONFIG'." >&2
  exit 1
fi

echo "::add-mask::$database_url"

psql_url="$(DATABASE_URL="$database_url" node -e '
const url = new URL(process.env.DATABASE_URL);
url.search = "";
process.stdout.write(url.toString());
')"
echo "::add-mask::$psql_url"

database_host="$(DATABASE_URL="$database_url" node -e '
process.stdout.write(new URL(process.env.DATABASE_URL).hostname);
')"

echo "Doppler project: $DOPPLER_PROJECT"
echo "Doppler config:  $DOPPLER_CONFIG"
echo "Target DB host:  $database_host"

if command -v psql >/dev/null 2>&1; then
  echo "Checking database connectivity..."
  psql "$psql_url" -c "\\q"
else
  echo "psql not found, skipping explicit connectivity probe."
fi

echo "Generating Prisma client..."
npm run db:generate

echo "Pre-migration Prisma status:"
set +e
doppler run \
  --project "$DOPPLER_PROJECT" \
  --config "$DOPPLER_CONFIG" \
  -- npm --workspace @shared/database exec -- prisma migrate status
status_code=$?
set -e

if [ "$status_code" -ne 0 ]; then
  echo "Pre-migration status reported drift or pending work. Continuing to migrate deploy."
fi

echo "Applying migrations..."
doppler run \
  --project "$DOPPLER_PROJECT" \
  --config "$DOPPLER_CONFIG" \
  -- .github/scripts/run-with-retry.sh npm run db:migrate:deploy

echo "Post-migration Prisma status:"
doppler run \
  --project "$DOPPLER_PROJECT" \
  --config "$DOPPLER_CONFIG" \
  -- npm --workspace @shared/database exec -- prisma migrate status

echo "Migration gate passed."

