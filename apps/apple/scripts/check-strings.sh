#!/bin/sh
# Checks a String Catalog against the keys the compiler extracted from its target's code (the .stringsdata files of
# a build): every key the code uses is in the catalog, no key in the catalog is unused, and each has a non-empty,
# translated English and German value. scripts/test.sh runs it after each build.
# Usage: scripts/check-strings.sh <catalog> <stringsdata>... | scripts/check-strings.sh --self-test
set -eu

check() {
  catalog=$1
  shift
  work=$(mktemp -d)
  cp "$catalog" "$work/"
  synced="$work/$(basename "$catalog")"
  xcrun xcstringstool sync "$synced" --stringsdata "$@"
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
  rm -rf "$dir"
  echo "check-strings self-test passed"
}

if [ "${1:-}" = --self-test ]; then self_test; else check "$@"; fi
