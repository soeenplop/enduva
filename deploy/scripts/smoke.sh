#!/usr/bin/env bash
# Smoke tests after a deploy (task 0.12c), the same for the isolated candidate environment and for production.
# Each URL must answer exactly 200, without following redirects, with a body marker of the service that should
# answer, within about 5 minutes: API readiness (database reachable as the API login), the web server and its SSR
# home page, the landing page. With DB_URL and SINCE, a `smoke` job must also have completed
# after SINCE: the worker enqueues and consumes one at every start, over its pooler (apps/api README, Worker).
#
# Usage: API_URL=… WEB_URL=… LANDING_URL=… [DB_URL=… SINCE=<timestamptz>] deploy/scripts/smoke.sh
set -euo pipefail
: "${API_URL:?API_URL is not set}" "${WEB_URL:?WEB_URL is not set}" "${LANDING_URL:?LANDING_URL is not set}"

failed=0
body="$(mktemp)"
trap 'rm -f "$body"' EXIT
# check <url> <fixed string the body must contain>
check() {
  local status=''
  for _ in $(seq 1 30); do
    status="$(curl -sS -o "$body" -w '%{http_code}' --max-time 10 "$1" || true)"
    if [ "$status" = 200 ] && grep -qF -- "$2" "$body"; then
      echo "ok   $1"
      return 0
    fi
    sleep 10
  done
  echo "::error::smoke: $1 did not answer 200 with '$2' (last status: ${status:-none})"
  failed=1
}

check "$API_URL/v1/health/ready" '"status":"ok"'
check "$WEB_URL/healthz" 'ok'
check "$WEB_URL/" 'id="home-title"'
check "$LANDING_URL/de/" 'id="hero-title"'

if [ -n "${DB_URL:-}" ]; then
  : "${SINCE:?SINCE is not set}"
  for _ in $(seq 1 30); do
    completed="$(psql "$DB_URL" -At -v since="$SINCE" <<<"select count(*) from pgboss.job
      where name = 'smoke' and state = 'completed' and created_on >= :'since'::timestamptz")"
    [ "$completed" -gt 0 ] && break
    sleep 10
  done
  if [ "$completed" -gt 0 ]; then
    echo "ok   worker: a smoke job was enqueued and consumed after $SINCE"
  else
    echo "::error::smoke: no smoke job completed after $SINCE (worker not running or not consuming)"
    failed=1
  fi
fi

exit "$failed"
