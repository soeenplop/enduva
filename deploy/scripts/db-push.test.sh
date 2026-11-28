#!/usr/bin/env bash
# Tests for db-push.sh with stubbed psql and supabase: a failed or unexpected history probe must abort before any
# push. Run by `pnpm --filter @enduva/tools test`.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
stubs="$(mktemp -d)"
trap 'rm -rf "$stubs"' EXIT
printf '#!/bin/sh\necho pushed >"%s/pushed"\n' "$stubs" >"$stubs/supabase"
chmod +x "$stubs/supabase"

for probe in 'exit 2' 'echo nonsense'; do
  printf '#!/bin/sh\n%s\n' "$probe" >"$stubs/psql"
  chmod +x "$stubs/psql"
  if PATH="$stubs:$PATH" SUPABASE_DB_URL="postgresql://x?sslmode=require" RECEIPT=x SHA=x DIGESTS=x "$root/deploy/scripts/db-push.sh" 2>/dev/null; then
    echo "FAIL probe '$probe': db-push.sh succeeded"
    exit 1
  fi
  if [ -e "$stubs/pushed" ]; then
    echo "FAIL probe '$probe': supabase db push ran"
    exit 1
  fi
  echo "ok   probe '$probe' aborts without a push"
done
echo 'db-push test passed.'
