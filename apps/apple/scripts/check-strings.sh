#!/bin/sh
# Checks a String Catalog against the keys the compiler extracted from its target's code (the .stringsdata files of
# a build): every key the code uses is in the catalog, no key in the catalog is unused, and each has a non-empty,
# translated English and German value. scripts/test.sh runs it after each build.
# Usage: scripts/check-strings.sh <catalog> <stringsdata>... | scripts/check-strings.sh --self-test
set -eu

check() {
  catalog=$1
  shift
  # xcstringstool sync only warns about a missing or broken .stringsdata and then compares nothing, so check them
  # first. An unmatched glob in test.sh arrives here as a path that doesn't exist.
  if [ $# -eq 0 ]; then
    echo "error: $catalog: no .stringsdata files to compare with" >&2
    return 1
  fi
  for data in "$@"; do
    if ! [ -s "$data" ] || ! jq -e '.tables | type == "object"' "$data" >/dev/null 2>&1; then
      echo "error: $catalog: $data is missing, empty or not extracted strings data" >&2
      return 1
    fi
  done
  work=$(mktemp -d)
  cp "$catalog" "$work/"
  synced="$work/$(basename "$catalog")"
  # Valid compiler output syncs silently. Any message means the tool skipped or rejected input (e.g. "Couldn't read
  # stringsdata file …, so will skip staleness checking", which still exits 0), so it fails the check.
  if ! output=$(xcrun xcstringstool sync "$synced" --stringsdata "$@" 2>&1) || [ -n "$output" ]; then
    echo "$output" | sed "s|^|error: $catalog: xcstringstool sync: |" >&2
    rm -rf "$work"
    return 1
  fi
  problems=$(jq -r '.strings | to_entries[] | select(.value.shouldTranslate != false) | .key as $key | .value
    | if .extractionState == "stale" then "\($key) is not used in the code"
      else ("en", "de") as $language | select(.localizations[$language].stringUnit
        | .state != "translated" or ((.value // "") | gsub("\\s"; "")) == "") | "\($key) has no \($language) value"
      end' "$synced")
  rm -rf "$work"
  if [ -n "$problems" ]; then
    echo "$problems" | sed "s|^|error: $catalog: |" >&2
    return 1
  fi
}

self_test() {
  dir=$(mktemp -d)
  printf 'import Foundation\nlet tagline = String(localized: "shell.tagline")\n' >"$dir/Uses.swift"
  xcrun xcstringstool extract --modern-localizable-strings "$dir/Uses.swift" --output-directory "$dir"
  catalog() {
    mkdir -p "$dir/$1"
    jq "$2" >"$dir/$1/Localizable.xcstrings" <<'JSON'
{"sourceLanguage": "en", "version": "1.0", "strings": {"shell.tagline": {"localizations": {
  "de": {"stringUnit": {"state": "translated", "value": "Hallo"}},
  "en": {"stringUnit": {"state": "translated", "value": "Hello"}}}}}}
JSON
  }
  catalog good '.'
  catalog empty '.strings["shell.tagline"].localizations.de.stringUnit.value = " "'
  catalog untranslated 'del(.strings["shell.tagline"].localizations.de)'
  catalog missing '.strings = {}'
  catalog unused '.strings["shell.unused"] = .strings["shell.tagline"]'
  check "$dir/good/Localizable.xcstrings" "$dir/Uses-swift.stringsdata"
  for case in empty untranslated missing unused; do
    if check "$dir/$case/Localizable.xcstrings" "$dir/Uses-swift.stringsdata" 2>/dev/null; then
      echo "error: self-test: the check accepted a catalog with the $case case" >&2
      exit 1
    fi
  done
  good="$dir/good/Localizable.xcstrings"
  : >"$dir/empty.stringsdata"
  echo '{"source": "Uses.swift"' >"$dir/invalid.stringsdata"
  # Valid JSON that xcstringstool rejects (it warns and skips the staleness check), alone and next to real data.
  echo '{"tables": {}}' >"$dir/rejected.stringsdata"
  for data in "" "$dir/absent.stringsdata" "$dir/empty.stringsdata" "$dir/invalid.stringsdata" \
    "$dir/rejected.stringsdata" "$dir/Uses-swift.stringsdata $dir/rejected.stringsdata"; do
    # shellcheck disable=SC2086 # an empty $data passes no extraction file at all
    if check "$good" $data 2>/dev/null; then
      echo "error: self-test: the check accepted the extraction input \"${data:-none}\"" >&2
      exit 1
    fi
  done
  rm -rf "$dir"
  echo "check-strings self-test passed"
}

if [ "${1:-}" = --self-test ]; then self_test; else check "$@"; fi
