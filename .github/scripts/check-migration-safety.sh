#!/usr/bin/env bash
set -euo pipefail

if [ -n "${MIGRATION_SAFETY_BASE:-}" ]; then
  base_ref="$MIGRATION_SAFETY_BASE"
elif [ -n "${GITHUB_BASE_REF:-}" ]; then
  git fetch origin "$GITHUB_BASE_REF" --depth=1 >/dev/null 2>&1 || true
  base_ref="origin/$GITHUB_BASE_REF"
elif git rev-parse --verify origin/main >/dev/null 2>&1; then
  base_ref="origin/main"
else
  base_ref="HEAD^"
fi

changed_files="$(git diff --name-only "$base_ref"...HEAD -- 'packages/database/prisma/migrations/*/migration.sql' || true)"

if [ -z "$changed_files" ]; then
  echo "No changed migration.sql files detected."
  exit 0
fi

echo "Checking migration safety against $base_ref:"
printf "%s\n" "$changed_files"

failed=0

while IFS= read -r file; do
  [ -n "$file" ] || continue
  [ -f "$file" ] || continue

  if grep -qi "trustloop-migration: reviewed-destructive-change" "$file"; then
    echo "Reviewed destructive-change marker present in $file."
    continue
  fi

  if grep -Eiq '(^|[[:space:];])(DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|TRUNCATE[[:space:]]+TABLE|ALTER[[:space:]]+TABLE[^;]+ALTER[[:space:]]+COLUMN[^;]+SET[[:space:]]+NOT[[:space:]]+NULL|ALTER[[:space:]]+TABLE[^;]+ALTER[[:space:]]+COLUMN[^;]+TYPE)' "$file"; then
    echo "::error file=$file::Potentially destructive migration statement found. Add '-- trustloop-migration: reviewed-destructive-change <reason>' after explicit review."
    failed=1
  fi

  if perl -0ne 'exit(/(^|[;\n]\s*)DELETE\s+FROM\b(?![^;]*\bWHERE\b)/is ? 0 : 1)' "$file"; then
    echo "::error file=$file::DELETE FROM without a WHERE clause found. Add a reviewed destructive-change marker if intentional."
    failed=1
  fi
done <<< "$changed_files"

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "Migration safety scan passed."

