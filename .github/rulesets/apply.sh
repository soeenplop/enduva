#!/usr/bin/env bash
# Applies the repository rulesets in this directory (repository rulesets API, task 0.5).
# Idempotent: a ruleset with the same name is updated, otherwise it is created.
# Needs `gh` authenticated as a repository admin. Usage: .github/rulesets/apply.sh [owner/repo]
#
# main.json: PRs required (0 approvals: all agents share the owner's account, so approvals are
# impossible), the CI jobs as required checks on the latest commit, only GitHub Actions
# (integration 15368) may report them, no force pushes, no deletion, merge commits only,
# and no bypass actors (a bypass for admins would be a bypass for every agent).
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
repo="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

for file in "$dir"/*.json; do
  name="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).name' "$file")"
  id="$(gh api --paginate "repos/$repo/rulesets?includes_parents=false" \
    --jq ".[] | select(.name == \"$name\" and .source_type == \"Repository\") | .id")"
  if [ -n "$id" ]; then
    echo "Updating ruleset \"$name\" ($id) on $repo"
    gh api --method PUT "repos/$repo/rulesets/$id" --input "$file" --jq '{id, name, enforcement}'
  else
    echo "Creating ruleset \"$name\" on $repo"
    gh api --method POST "repos/$repo/rulesets" --input "$file" --jq '{id, name, enforcement}'
  fi
done
