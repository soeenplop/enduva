#!/usr/bin/env bash
# Deploys image digests to the Dokploy production compose (task 0.12c; 06-deployment.md, "Promote, don't rebuild").
# Renders deploy/compose.production.yaml with `ghcr.io/<owner>/enduva-<image>@<digest>` for each image, stores it as
# the compose's raw file, starts a deploy and waits until Dokploy reports it done or failed. It talks to the same
# Dokploy API the Dokploy CLI (v0.30) wraps, with curl, so it needs no npm install and reads no `.env` file.
#
# The pipeline runs it only from the receipt-gated deploy job, right after the migrations of the same SHA. Before any
# change it waits until no earlier deployment of the compose is queued or running, so work a cancelled or timed-out
# job left behind in Dokploy can't overlap this one; `--wait-idle` does only that (the deploy job runs it before
# migrating). The enqueue is never retried, so one call queues at most one deployment.
#
# Usage: DOKPLOY_URL=https://… DOKPLOY_API_KEY=… DOKPLOY_COMPOSE_ID=… DIGESTS=<json file> TITLE=<text> \
#          deploy/scripts/deploy.sh [--render-only | --wait-idle]
set -euo pipefail
cd "$(dirname "$0")/../.."
mode="${1:-deploy}"
polls="${POLLS:-90}" # × POLL_SECONDS (10) = 15 minutes

# tRPC over HTTP: POST takes {"json": input}, GET takes ?input={"json": input}; the result is in .result.data.json.
dokploy_post() {
  curl -fsS -X POST "$DOKPLOY_URL/api/trpc/$1" -H "x-api-key: $DOKPLOY_API_KEY" \
    -H 'content-type: application/json' --data-binary @- >/dev/null
}
dokploy_get() {
  curl -fsS --retry 3 -G "$DOKPLOY_URL/api/trpc/$1" -H "x-api-key: $DOKPLOY_API_KEY" \
    ${2:+--data-urlencode "input=$2"} | jq '.result.data.json'
}

# Waits until Dokploy has no queued job for this compose and the compose isn't running a deployment.
wait_idle() {
  local input queued status
  input="$(jq -nc --arg id "$DOKPLOY_COMPOSE_ID" '{json: {composeId: $id}}')"
  for _ in $(seq 1 "$polls"); do
    queued="$(dokploy_get deployment.queueList |
      jq --arg id "$DOKPLOY_COMPOSE_ID" '[.[] | select(.data.composeId == $id)] | length')"
    status="$(dokploy_get compose.one "$input" | jq -r .composeStatus)"
    if [ "$queued" -eq 0 ] && [ "$status" != running ]; then
      return 0
    fi
    echo "Waiting for earlier Dokploy work on the compose: $queued queued, status $status."
    sleep "${POLL_SECONDS:-10}"
  done
  echo "::error::Earlier Dokploy work on the compose didn't finish within the wait. Refusing to change production." >&2
  exit 1
}

if [ "$mode" != "--render-only" ]; then
  : "${DOKPLOY_URL:?DOKPLOY_URL is not set}" "${DOKPLOY_API_KEY:?DOKPLOY_API_KEY is not set}"
  : "${DOKPLOY_COMPOSE_ID:?DOKPLOY_COMPOSE_ID is not set}"
fi
if [ "$mode" = "--wait-idle" ]; then
  wait_idle
  echo 'Dokploy is idle for the compose.'
  exit 0
fi
: "${DIGESTS:?DIGESTS is not set}"
registry="${IMAGE_REGISTRY:-ghcr.io/soeenplop}"

# Every placeholder gets a sha256 digest, or nothing is sent.
rendered="$(mktemp)"
trap 'rm -f "$rendered"' EXIT
cp deploy/compose.production.yaml "$rendered"
for image in api web landing; do
  digest="$(jq -r --arg image "$image" '.[$image] // ""' "$DIGESTS")"
  if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "::error::No sha256 digest for the $image image in $DIGESTS. Refusing to deploy." >&2
    exit 1
  fi
  placeholder="@IMAGE_$(tr '[:lower:]' '[:upper:]' <<<"$image")@"
  sed -i.bak "s|$placeholder|$registry/enduva-$image@$digest|g" "$rendered"
done
rm -f "$rendered.bak"
if grep -q "'@IMAGE_" "$rendered"; then
  echo "::error::Unrendered image placeholder in deploy/compose.production.yaml." >&2
  exit 1
fi
if [ "$mode" = "--render-only" ]; then
  cat "$rendered"
  exit 0
fi

: "${TITLE:?TITLE is not set}"
wait_idle

jq -n --arg id "$DOKPLOY_COMPOSE_ID" --rawfile file "$rendered" \
  '{json: {composeId: $id, sourceType: "raw", composeFile: $file}}' | dokploy_post compose.update
echo "Compose file updated with the digests from $DIGESTS."
jq -n --arg id "$DOKPLOY_COMPOSE_ID" --arg title "$TITLE" '{json: {composeId: $id, title: $title}}' |
  dokploy_post compose.deploy
echo "Deploy '$TITLE' queued."

# Dokploy deploys asynchronously. Wait for this deploy (matched by its title, unique per run attempt) to finish.
input="$(jq -nc --arg id "$DOKPLOY_COMPOSE_ID" '{json: {composeId: $id}}')"
status=queued
for _ in $(seq 1 "$polls"); do
  sleep "${POLL_SECONDS:-10}"
  status="$(dokploy_get deployment.allByCompose "$input" |
    jq -r --arg title "$TITLE" '[.[] | select(.title == $title)][0].status // "queued"')"
  case "$status" in
    done)
      echo "Deploy '$TITLE' done."
      exit 0
      ;;
    error | cancelled)
      echo "::error::Dokploy reports the deploy '$TITLE' as $status. See its log in Dokploy." >&2
      exit 1
      ;;
  esac
done
echo "::error::Deploy '$TITLE' did not finish within the wait (last status: $status). The next deploy waits for it." >&2
exit 1
