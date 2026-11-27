#!/bin/sh
# Builds the apps and runs their unit tests and EnduvaKit's on the simulators: `scripts/test.sh [ios|watchos]`,
# both by default. IOS_DESTINATION and WATCHOS_DESTINATION override the simulators. Then checks each app's String
# Catalog against the keys the compiler extracted (scripts/check-strings.sh).
set -eu
cd "$(dirname "$0")/.."

derived=.build/DerivedData
ios=${IOS_DESTINATION:-platform=iOS Simulator,name=iPhone 18 Pro,OS=latest}
watchos=${WATCHOS_DESTINATION:-platform=watchOS Simulator,name=Apple Watch Series 12 (46mm),OS=latest}

run() {
  # Only the committed Package.resolved counts; simulator builds need no signing.
  xcodebuild test -project Enduva.xcodeproj -scheme "$1" -destination "$2" -derivedDataPath "$derived" \
    -onlyUsePackageVersionsFromResolvedFile CODE_SIGNING_ALLOWED=NO -quiet
  scripts/check-strings.sh "$1/Localizable.xcstrings" \
    "$derived"/Build/Intermediates.noindex/Enduva.build/Debug-*simulator/"$1".build/Objects-normal/*/*.stringsdata
}

case "${1:-all}" in
  ios) run Enduva "$ios" ;;
  watchos) run EnduvaWatch "$watchos" ;;
  all) run Enduva "$ios" && run EnduvaWatch "$watchos" ;;
  *) echo "usage: $0 [ios|watchos]" >&2; exit 64 ;;
esac
