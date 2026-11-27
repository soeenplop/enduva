#!/bin/sh
# Builds the apps and runs their unit tests and EnduvaKit's on the simulators: `scripts/test.sh [ios|watchos]`,
# both by default. IOS_DESTINATION and WATCHOS_DESTINATION override the simulators.
set -eu
cd "$(dirname "$0")/.."

ios=${IOS_DESTINATION:-platform=iOS Simulator,name=iPhone 18 Pro,OS=latest}
watchos=${WATCHOS_DESTINATION:-platform=watchOS Simulator,name=Apple Watch Series 12 (46mm),OS=latest}

run() {
  # Only the committed Package.resolved counts; simulator builds need no signing.
  xcodebuild test -project Enduva.xcodeproj -scheme "$1" -destination "$2" \
    -onlyUsePackageVersionsFromResolvedFile CODE_SIGNING_ALLOWED=NO -quiet
}

case "${1:-all}" in
  ios) run Enduva "$ios" ;;
  watchos) run EnduvaWatch "$watchos" ;;
  all) run Enduva "$ios" && run EnduvaWatch "$watchos" ;;
  *) echo "usage: $0 [ios|watchos]" >&2; exit 64 ;;
esac
