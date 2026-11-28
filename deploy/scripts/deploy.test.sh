#!/usr/bin/env bash
# Tests for deploy.sh with a stubbed curl in place of the Dokploy API: a missing digest sends nothing, the stored
# compose file carries the digests, and the deploy's final status decides the exit code. Run by
# `pnpm --filter @enduva/tools test`.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
stubs="$(mktemp -d)"
trap 'rm -rf "$stubs"' EXIT
# Records each call's endpoint and body; answers the deployment list with $STUB_STATUS for the deploy's title, the
# queue with $STUB_QUEUE and the compose status with $STUB_COMPOSE.
cat >"$stubs/curl" <<'STUB'
#!/usr/bin/env bash
endpoint="$(printf '%s\n' "$@" | grep -o 'api/trpc/[a-zA-Z.]*' | sed 's|api/trpc/||')"
echo "$endpoint" >>"$STUB_DIR/calls"
case "$endpoint" in
  deployment.allByCompose)
    jq -n --arg t "$TITLE" --arg s "$STUB_STATUS" '{result: {data: {json: [{title: "old", status: "done"}, {title: $t, status: $s}]}}}' ;;
  deployment.queueList) jq -n --argjson q "${STUB_QUEUE:-[]}" '{result: {data: {json: $q}}}' ;;
  compose.one) jq -n --arg s "${STUB_COMPOSE:-done}" '{result: {data: {json: {composeStatus: $s}}}}' ;;
  *) cat >"$STUB_DIR/$endpoint.json" ;;
esac
STUB
chmod +x "$stubs/curl"

digest() { printf 'sha256:%064d' "$1"; }
jq -n --arg a "$(digest 1)" --arg w "$(digest 2)" --arg l "$(digest 3)" '{api: $a, web: $w, landing: $l}' >"$stubs/ok.json"
jq -n --arg a "$(digest 1)" '{api: $a, web: "latest"}' >"$stubs/bad.json"
export STUB_DIR="$stubs" TITLE=t1 DOKPLOY_URL=https://dokploy.invalid DOKPLOY_API_KEY=k DOKPLOY_COMPOSE_ID=c1
export POLL_SECONDS=0 POLLS=3
run() { PATH="$stubs:$PATH" DIGESTS="$stubs/$1.json" STUB_STATUS="$2" "$root/deploy/scripts/deploy.sh" >/dev/null 2>&1; }

if run bad done || [ -e "$stubs/calls" ]; then
  echo 'FAIL a missing or tag-only digest must stop the deploy before any API call'
  exit 1
fi
echo 'ok   missing digest: nothing sent'

run ok done
if ! jq -r .json.composeFile "$stubs/compose.update.json" | grep -q "enduva-web@$(digest 2)"; then
  echo 'FAIL the stored compose file lacks the web digest'
  exit 1
fi
[ "$(jq -r .json.title "$stubs/compose.deploy.json")" = t1 ] || { echo 'FAIL deploy title'; exit 1; }
echo 'ok   compose file stored with the digests, deploy started and finished'

[ "$(grep -c '^compose.deploy$' "$stubs/calls")" = 1 ] || { echo 'FAIL the deploy must be queued exactly once'; exit 1; }

rm -f "$stubs"/calls "$stubs"/compose.*.json
if STUB_QUEUE='[{"data": {"composeId": "c1"}, "state": "waiting"}]' run ok done || [ -e "$stubs/compose.update.json" ]; then
  echo 'FAIL a queued earlier deployment must stop the deploy before the compose file changes'
  exit 1
fi
if STUB_COMPOSE=running run ok done || [ -e "$stubs/compose.update.json" ]; then
  echo 'FAIL a running earlier deployment must stop the deploy before the compose file changes'
  exit 1
fi
STUB_QUEUE='[{"data": {"composeId": "other"}, "state": "active"}]' run ok done
echo 'ok   earlier work on the compose blocks the deploy, other composes do not'

if run ok error; then
  echo 'FAIL a failed Dokploy deploy must fail the script'
  exit 1
fi
echo 'ok   failed Dokploy deploy fails'
echo 'deploy test passed.'
