#!/bin/sh
# `scripts/test.sh [ios|watchos]`, both by default. ios builds the iPhone app (with the embedded Watch app) and runs
# EnduvaTests and EnduvaKitTests on the simulator; IOS_SIMULATOR overrides the device name, the newest installed
# runtime is used. watchos only builds the Watch app: EnduvaKitTests already run in the iPhone scheme, and starting
# the test runner on CI's watchOS simulator alone took ~20 minutes (README.md, "Watch tests"). Both then check the
# app's String Catalog against the keys the compiler extracted (scripts/check-strings.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

derived=.build/DerivedData

# Prints the UDID of the available simulator named $2 on the newest $1 runtime (e.g. watchOS-27-2).
simulator() {
  xcrun simctl list devices available -j | jq -r --arg platform "$1" --arg name "$2" '
    [.devices | to_entries[] | select(.key | test("SimRuntime\\." + $platform + "-[0-9]+-[0-9]+$"))
      | (.key | capture("-(?<major>[0-9]+)-(?<minor>[0-9]+)$") | [(.major | tonumber), (.minor | tonumber)]) as $version
      | .value[] | select(.name == $name) | {version: $version, udid}]
    | sort_by(.version) | last | .udid // empty'
}

# Checks the String Catalog of scheme $1 against the keys extracted by its last simulator build.
check_strings() {
  scripts/check-strings.sh "$1/Localizable.xcstrings" \
    "$derived"/Build/Intermediates.noindex/Enduva.build/Debug-*simulator/"$1".build/Objects-normal/*/*.stringsdata
}

# Only the committed Package.resolved counts; simulator builds need no signing.
common="-project Enduva.xcodeproj -derivedDataPath $derived -onlyUsePackageVersionsFromResolvedFile CODE_SIGNING_ALLOWED=NO -quiet"

# Builds first, then boots the simulator and waits until it has fully booted, and only then runs the tests by UDID.
ios() {
  name=${IOS_SIMULATOR:-iPhone 18 Pro}
  udid=$(simulator iOS "$name")
  if [ -z "$udid" ]; then
    echo "error: no available iOS simulator named \"$name\"" >&2
    exit 1
  fi
  # shellcheck disable=SC2086 # $common is a list of plain words.
  xcodebuild build-for-testing $common -scheme Enduva -destination "id=$udid"
  xcrun simctl bootstatus "$udid" -b
  # shellcheck disable=SC2086
  xcodebuild test-without-building $common -scheme Enduva -destination "id=$udid"
  check_strings Enduva
}

watchos() {
  # shellcheck disable=SC2086
  xcodebuild build $common -scheme EnduvaWatch -destination 'generic/platform=watchOS Simulator'
  check_strings EnduvaWatch
}

case "${1:-all}" in
  ios) ios ;;
  watchos) watchos ;;
  # Two plain commands: on the left of `&&`, a failure inside `ios` wouldn't stop it (set -e is off there).
  all)
    ios
    watchos
    ;;
  *) echo "usage: $0 [ios|watchos]" >&2; exit 64 ;;
esac
