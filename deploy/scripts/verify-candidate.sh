#!/usr/bin/env bash
# Isolated candidate verifier (task 0.12c; 06-deployment.md, "Candidate verifier"). In CI, never against a hosted
# project: a fresh Supabase local stack gets exactly the migrations production has applied (BASELINE), then the
# candidate's remaining migrations, then the seed. The cross-tenant suite runs against it, the candidate's images
# start by digest (deploy/compose.yaml) and the smoke tests run. Only if all of that passes does it write the
# production receipt (tools/receipt-gate.mjs) that authorises the production write of this SHA.
#
# Usage: SHA=<commit> DIGESTS=<json file> BASELINE=<file, one applied version per line> RECEIPT=<output file> \
#          deploy/scripts/verify-candidate.sh
set -euo pipefail
: "${SHA:?SHA is not set}" "${DIGESTS:?DIGESTS is not set}" "${BASELINE:?BASELINE is not set}"
: "${RECEIPT:?RECEIPT is not set}"
cd "$(dirname "$0")/../.."
registry="${IMAGE_REGISTRY:-ghcr.io/soeenplop}"
local_db=postgresql://postgres:postgres@127.0.0.1:54322/postgres

# Production can't have applied a migration this SHA doesn't have: that candidate is behind production.
for version in $(cat "$BASELINE"); do
  if ! compgen -G "supabase/migrations/${version}_*.sql" >/dev/null; then
    echo "::error::Production has applied migration $version, which $SHA doesn't contain. Refusing to verify." >&2
    exit 1
  fi
done

# Hold back every migration production hasn't applied, and the seed (it needs the roles of the first migration).
held="$(mktemp -d)"
restore() { find "$held" -name '*.sql' -exec mv {} supabase/migrations/ \; && mv -f "$held/seed" supabase/seed.sql; }
mv supabase/seed.sql "$held/seed"
for file in supabase/migrations/*.sql; do
  version="$(basename "$file" | cut -d_ -f1)"
  grep -qx "$version" "$BASELINE" || mv "$file" "$held/"
done
trap restore EXIT

echo "Replaying the production history: $(wc -l <"$BASELINE" | tr -d ' ') migration(s)."
pnpm --filter @enduva/db db:keys
supabase start --exclude studio,imgproxy,edge-runtime,logflare,vector,realtime,postgres-meta,storage-api
restore
trap - EXIT
echo 'Applying the candidate migrations, then the seed.'
supabase migration up --local
psql "$local_db" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql

pnpm --filter @enduva/db test:integration

# No `--wait`: the worker and auth-forward have no healthcheck. smoke.sh polls every service until it answers.
image() { echo "$registry/enduva-$1@$(jq -r --arg image "$1" '.[$image]' "$DIGESTS")"; }
since="$(psql "$local_db" -Atc 'select now()')"
ENDUVA_AUTH_PUBLISHABLE_KEY="$(supabase status -o json | jq -r .PUBLISHABLE_KEY)" \
  API_IMAGE="$(image api)" WEB_IMAGE="$(image web)" LANDING_IMAGE="$(image landing)" \
  docker compose -f deploy/compose.yaml up --no-build --quiet-pull --detach
API_URL=http://127.0.0.1:3000 WEB_URL=http://127.0.0.1:3001 LANDING_URL=http://127.0.0.1:3002 \
  DB_URL="$local_db" SINCE="$since" deploy/scripts/smoke.sh

node tools/receipt-gate.mjs --write "$RECEIPT" --sha "$SHA" --digests "$DIGESTS" --applied "$BASELINE"
