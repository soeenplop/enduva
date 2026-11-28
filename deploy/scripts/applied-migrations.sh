#!/usr/bin/env bash
# Prints the migration history production has applied, one version per line, nothing before the first migration
# (06-deployment.md, "Production requires a receipt"). Used by db-push.sh under the production lock and by the
# pipeline's `baseline` job, whose output the isolated verifier replays.
#
# Usage: SUPABASE_DB_URL=… deploy/scripts/applied-migrations.sh
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set}"

# A failed probe or query aborts (set -e): an unreadable history must never count as an empty one.
exists="$(psql "$SUPABASE_DB_URL" -Atc "select to_regclass('supabase_migrations.schema_migrations') is not null")"
case "$exists" in
  t) psql "$SUPABASE_DB_URL" -Atc 'select version from supabase_migrations.schema_migrations order by version' ;;
  f) ;;
  *)
    echo "::error::Could not read the production migration history (got '$exists'). Refusing to write." >&2
    exit 1
    ;;
esac
