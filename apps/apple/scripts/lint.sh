#!/bin/sh
# Lints the Swift code (swift-format from the selected Xcode, then SwiftLint) and checks that every String Catalog
# entry is translated to English and German and that the app icon layers match the brand assets.
# SWIFTLINT overrides the SwiftLint binary (CI passes the pinned one).
set -eu
cd "$(dirname "$0")/.."

xcrun swift-format lint --strict --recursive Enduva EnduvaWatch EnduvaTests EnduvaWatchTests EnduvaKit/Package.swift \
  EnduvaKit/Sources EnduvaKit/Tests EnduvaAPIClient/Package.swift EnduvaAPIClient/Tests \
  EnduvaAPIClient/Sources/EnduvaAPIClient/*.swift
"${SWIFTLINT:-swiftlint}" lint --strict --quiet

status=0
for catalog in $(find Enduva EnduvaWatch EnduvaKit/Sources -name '*.xcstrings'); do
  missing=$(jq -r '.strings | to_entries[] | select(.value.shouldTranslate != false)
    | select(.value.localizations.en.stringUnit.state != "translated"
      or .value.localizations.de.stringUnit.state != "translated") | .key' "$catalog")
  if [ -n "$missing" ]; then
    echo "error: $catalog: not translated to en and de: $missing" >&2
    status=1
  fi
done

for layer in sun bowl; do
  for pair in "Enduva ios/light" "EnduvaWatch watchos"; do
    set -- $pair
    if ! cmp -s "$1/AppIcon.icon/Assets/$layer.svg" "../../assets/brand/final/$2/$layer.svg"; then
      echo "error: $1/AppIcon.icon/Assets/$layer.svg differs from assets/brand/final/$2/$layer.svg" >&2
      status=1
    fi
  done
done
exit $status
