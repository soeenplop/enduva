#!/bin/sh
# Lints the Swift code (swift-format from the selected Xcode, then SwiftLint), self-tests the String Catalog check
# (scripts/test.sh runs it after the build) and checks that the app icon layers match the brand assets.
# SWIFTLINT overrides the SwiftLint binary (CI passes the pinned one).
set -eu
cd "$(dirname "$0")/.."

xcrun swift-format lint --strict --recursive Enduva EnduvaWatch EnduvaTests EnduvaKit/Package.swift \
  EnduvaKit/Sources EnduvaKit/Tests EnduvaAPIClient/Package.swift EnduvaAPIClient/Tests \
  EnduvaAPIClient/Sources/EnduvaAPIClient/*.swift
"${SWIFTLINT:-swiftlint}" lint --strict --quiet

scripts/check-strings.sh --self-test

status=0
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
