#!/usr/bin/env bash
# Receipt-gated `supabase db push` (roadmap 0.12b; 06-deployment.md, "Production requires a receipt").
# The production deploy job (0.12c) runs it under the `deploy-production` lock, right before it deploys the same
# image digests in the same job. It reads the migration history production has applied, refuses unless
# tools/receipt-gate.mjs accepts the receipt for exactly this SHA against that history, and only then pushes the
# migrations of this checkout. Nothing calls it with production credentials yet (0.12c wires that).
#
# Usage: SUPABASE_DB_URL=… RECEIPT=<file> SHA=<commit> DIGESTS=<json file> deploy/scripts/db-push.sh [--dry-run]
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set}"
: "${RECEIPT:?RECEIPT is not set}" "${SHA:?SHA is not set}" "${DIGESTS:?DIGESTS is not set}"
cd "$(dirname "$0")/../.."

# Applied history, one version per line. Before the first migration the history table doesn't exist yet.
applied="$(mktemp)"
trap 'rm -f "$applied"' EXIT
# A failed probe or query aborts (set -e): an unreadable history must never count as an empty one.
exists="$(psql "$SUPABASE_DB_URL" -Atc "select to_regclass('supabase_migrations.schema_migrations') is not null")"
case "$exists" in
  t) psql "$SUPABASE_DB_URL" -Atc 'select version from supabase_migrations.schema_migrations order by version' >"$applied" ;;
  f) ;;
  *)
    echo "::error::Could not read the production migration history (got '$exists'). Refusing to write." >&2
    exit 1
    ;;
esac

node tools/receipt-gate.mjs --receipt "$RECEIPT" --sha "$SHA" --digests "$DIGESTS" --applied "$applied"
supabase db push --db-url "$SUPABASE_DB_URL" "$@"
