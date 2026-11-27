#!/usr/bin/env bash
# Secret scan of the full git history with gitleaks (task 0.5, required check `gitleaks`).
#
# gitleaks walks `git log -p`, and Git prints no patch for a merge commit unless a merge diff mode
# is selected. So a secret that first appears in a conflict resolution would never be scanned.
# GITLEAKS_LOG_OPTS keeps gitleaks' default traversal (`--full-history --all --diff-filter=tuxdb`,
# gitleaks 8.30.1 sources/git.go) and adds each merge commit's diff against its first parent, which
# contains every line the merge introduced on that side, including its conflict resolution.
#
# Usage: tools/gitleaks-scan.sh <gitleaks-binary> <repo>      scan the repo's full history
#        tools/gitleaks-scan.sh <gitleaks-binary> --self-test  prove that a secret added only in a
#                                                              merge resolution is found
set -euo pipefail

GITLEAKS_LOG_OPTS='--full-history --all --diff-filter=tuxdb --diff-merges=first-parent'

scan() {
  "$gitleaks" git --redact --no-banner --exit-code 1 --log-opts="$GITLEAKS_LOG_OPTS" "$@"
}

self_test() {
  local repo
  repo="$(mktemp -d)"
  trap 'rm -rf "$repo"' RETURN
  # Throwaway repo: per-command settings only, no hooks, no signing, no global config touched.
  g() { git -C "$repo" -c user.name=selftest -c user.email=selftest@example.invalid \
    -c commit.gpgsign=false -c core.hooksPath=/dev/null "$@"; }
  g init -q -b main
  printf 'region = eu\n' >"$repo/config.ini"
  g add config.ini && g commit -q -m 'chore: base'
  g switch -q -c feature
  printf 'region = us\n' >"$repo/config.ini"
  g commit -q -am 'chore: feature side'
  g switch -q main
  printf 'region = ap\n' >"$repo/config.ini"
  g commit -q -am 'chore: main side'
  if g merge -q feature >/dev/null 2>&1; then
    echo 'FAIL self-test setup: expected a merge conflict' >&2
    return 1
  fi
  # The secret exists in neither parent, only in the resolution. Generated per run, so this file
  # never contains a key itself.
  local alphabet=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567 key=AKIA i
  for i in {1..16}; do key+="${alphabet:RANDOM%32:1}"; done
  printf 'region = us\naws_access_key_id = %s\n' "$key" >"$repo/config.ini"
  g add config.ini && g commit -q --no-edit

  # Exactly one finding: the AWS key rule, attributed to the merge commit.
  local report="$repo.report.json" merge findings
  merge="$(g rev-parse HEAD)"
  scan --report-format json --report-path "$report" "$repo" >/dev/null 2>&1 || true
  findings="$(node -e 'const r = require(process.argv[1]); console.log(r.map((f) => `${f.RuleID}@${f.Commit}`).join(" "))' "$report" 2>/dev/null || true)"
  rm -f "$report"
  if [[ "$findings" != "aws-access-token@$merge" ]]; then
    echo "FAIL self-test: expected aws-access-token@$merge (the merge resolution), got: ${findings:-nothing}" >&2
    return 1
  fi
  echo 'ok   self-test: a secret added only in a merge resolution is found'
  # Informational: gitleaks' default log options miss it (the reason for GITLEAKS_LOG_OPTS).
  if "$gitleaks" git --redact --no-banner --exit-code 1 "$repo" >/dev/null 2>&1; then
    echo 'info gitleaks defaults miss the merge-resolution secret'
  else
    echo 'info gitleaks defaults now find the merge-resolution secret too'
  fi
}

gitleaks="${1:?usage: gitleaks-scan.sh <gitleaks-binary> <repo>|--self-test}"
target="${2:?usage: gitleaks-scan.sh <gitleaks-binary> <repo>|--self-test}"
if [[ "$target" == '--self-test' ]]; then
  self_test
else
  scan "$target"
fi
