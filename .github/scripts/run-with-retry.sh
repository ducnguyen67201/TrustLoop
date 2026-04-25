#!/usr/bin/env bash
set -euo pipefail

max_attempts="${MAX_ATTEMPTS:-3}"
backoff_seconds="${INITIAL_BACKOFF_SECONDS:-5}"
attempt=1

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

while [ "$attempt" -le "$max_attempts" ]; do
  output_file="$(mktemp)"
  echo "Attempt $attempt of $max_attempts: $*"

  set +e
  "$@" >"$output_file" 2>&1
  status=$?
  set -e

  cat "$output_file"
  output="$(cat "$output_file")"
  rm -f "$output_file"

  if [ "$status" -eq 0 ]; then
    echo "Command succeeded on attempt $attempt."
    exit 0
  fi

  if ! printf "%s" "$output" | grep -Eq "P1001|P1002|ECONNRESET|ECONNREFUSED|Can't reach database server|Connection terminated unexpectedly"; then
    echo "Command failed with a non-transient error. Not retrying." >&2
    exit "$status"
  fi

  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "Maximum retry attempts reached." >&2
    exit "$status"
  fi

  echo "Transient database connection error detected. Retrying in ${backoff_seconds}s..."
  sleep "$backoff_seconds"
  attempt=$((attempt + 1))
  backoff_seconds=$((backoff_seconds * 2))
done

