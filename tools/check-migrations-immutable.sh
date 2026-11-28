#!/usr/bin/env bash
# Merged migrations are immutable (06-deployment.md, "Production requires a receipt"). The isolated verifier replays
# production's applied history from the migration files in the checkout, and production only stores which versions
# ran, so an edited migration would be verified as something production never got. Fails if any migration file that
# exists on the base (main) differs in this checkout. Removing one is caught by the verifier, which refuses a
# candidate without every applied version. Run by the `supabase-bootstrap` CI job.
#
# Usage: tools/check-migrations-immutable.sh <base commit, e.g. FETCH_HEAD after `git fetch origin main`>
set -euo pipefail
base="${1:?base commit is required}"
cd "$(dirname "$0")/.."

changed=0
while IFS= read -r file; do
  if [ -f "$file" ] && ! git diff --quiet "$base" -- "$file"; then
    echo "::error file=$file::$file is already on main and must not change. Add a new migration instead."
    changed=1
  fi
done < <(git ls-tree --name-only "$base" supabase/migrations/ | grep '\.sql$')
[ "$changed" -eq 0 ] && echo 'Merged migrations are unchanged.'
exit "$changed"
