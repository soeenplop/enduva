#!/usr/bin/env bash
# Lints every non-merge commit in <base>..<head> with commitlint (required check `commitlint`).
#
# commitlint's default ignores are off (commitlint.config.mjs), so a message is never skipped for
# what it says. Merge commits (`git merge main` once review has started) are skipped for what they
# are: `git rev-list --no-merges` leaves out commits with more than one parent. commitlint's own
# `--git-log-args` can't do this, it drops `--no-merges` (commitlint 21.2.4).
#
# Usage: tools/commitlint-range.sh <base> <head>
set -euo pipefail

base="${1:?usage: commitlint-range.sh <base> <head>}"
head="${2:?usage: commitlint-range.sh <base> <head>}"
git merge-base "$base" "$head" >/dev/null # fails on incomplete history instead of linting a partial range

commits="$(git rev-list --no-merges --reverse "$base..$head")"
status=0
count=0
for sha in $commits; do
  count=$((count + 1))
  echo "--- $(git log -1 --format='%h %s' "$sha")"
  git log -1 --format=%B "$sha" | pnpm exec commitlint --verbose || status=1
done
echo "Linted $count non-merge commit(s) in ${base:0:12}..${head:0:12}."
exit "$status"
