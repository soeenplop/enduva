#!/usr/bin/env bash
# Checks what the root .dockerignore lets into the build context of deploy/Dockerfile (task 0.12a).
#
#   tools/check-docker-context.sh [repo-root]
#
# Plants synthetic credential files at nested paths inside the allowed directories, copies the real context into a
# `FROM scratch` image exported to a local directory, and fails if
#   - any planted credential arrived,
#   - any dotfile or key/credential-named file arrived at all (planted or not),
#   - the controls are missing (a tracked build input and a planted non-secret file next to the secrets).
# Only files this script created are removed again; it refuses to run if one of them already exists.
set -euo pipefail

root=$(cd "${1:-.}" && pwd)
cd "$root"

secrets=(
  apps/api/.npmrc
  apps/api/.docker/config.json
  apps/api/src/.aws/credentials
  apps/web/.env
  apps/web/.ssh/id_ed25519
  apps/web/src/.envrc.local
  apps/web/src/id_rsa
  apps/landing/src/key.pem
  apps/landing/tls.key
  packages/db/.env.production.local
  packages/contracts/signing_keys.json
  packages/domain/service-account-prod.json
  packages/ui/.config/gcloud/application_default_credentials.json
)
probe=apps/web/src/context-probe.txt
controls=(apps/web/package.json "$probe")

planted=()
work=$(mktemp -d)
cleanup() {
  for file in "${planted[@]}"; do rm -f "$file"; done
  for file in "${planted[@]}"; do rmdir -p "$(dirname "$file")" 2>/dev/null || true; done
  rm -rf "$work"
}
trap cleanup EXIT

for file in "${secrets[@]}" "$probe"; do
  if [ -e "$file" ]; then
    echo "error: $file already exists; refusing to plant over it" >&2
    exit 2
  fi
done
for file in "${secrets[@]}" "$probe"; do
  mkdir -p "$(dirname "$file")"
  planted+=("$file")
  echo "synthetic test file from tools/check-docker-context.sh" >"$file"
done

printf 'FROM scratch\nCOPY . /\n' | docker buildx build --quiet --file - --output "type=local,dest=$work/context" . >/dev/null

failures=0
for file in "${secrets[@]}"; do
  if [ -e "$work/context/$file" ]; then
    echo "FAIL planted credential reached the context: $file"
    failures=$((failures + 1))
  fi
done
for file in "${controls[@]}"; do
  if [ ! -e "$work/context/$file" ]; then
    echo "FAIL control missing from the context: $file"
    failures=$((failures + 1))
  fi
done
# Nothing dot-named or key/credential-named may be there at all, planted or not.
while IFS= read -r path; do
  echo "FAIL forbidden file in the context: ${path#"$work/context/"}"
  failures=$((failures + 1))
done < <(find "$work/context" -mindepth 1 \( -name '.*' -o -name '*.pem' -o -name '*.key' -o -name '*.p12' \
  -o -name '*.pfx' -o -name 'id_rsa*' -o -name 'id_ed25519*' -o -name '*credentials*' -o -name 'signing_keys.json' \
  -o -name 'service-account*.json' \) -print)

if [ "$failures" -gt 0 ]; then
  echo "$failures problem(s) in the Docker build context (.dockerignore)"
  exit 1
fi
echo "ok   ${#secrets[@]} planted credential files kept out of the Docker build context, controls present"
