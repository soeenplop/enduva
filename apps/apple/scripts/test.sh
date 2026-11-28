#!/bin/sh
# Builds the apps and runs their unit tests and EnduvaKit's on the simulators: `scripts/test.sh [ios|watchos]`,
# both by default. IOS_SIMULATOR and WATCHOS_SIMULATOR override the device names; the newest installed runtime is
# used. Then checks each app's String Catalog against the keys the compiler extracted (scripts/check-strings.sh).
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

# Builds first, then boots the simulator and waits until it has fully booted, and only then runs the tests by UDID.
# The Watch scheme runs only EnduvaKit's tests, which need no app: launching a test host app on CI's watchOS simulator
# fails (README.md, "Watch tests").
run() {
  scheme=$1
  udid=$(simulator "$2" "$3")
  if [ -z "$udid" ]; then
    echo "error: no available $2 simulator named \"$3\"" >&2
    exit 1
  fi
  # Only the committed Package.resolved counts; simulator builds need no signing.
  set -- -project Enduva.xcodeproj -scheme "$scheme" -destination "id=$udid" -derivedDataPath "$derived" \
    -onlyUsePackageVersionsFromResolvedFile CODE_SIGNING_ALLOWED=NO -quiet
  xcodebuild build-for-testing "$@"
  xcrun simctl bootstatus "$udid" -b
  xcodebuild test-without-building "$@"
  scripts/check-strings.sh "$scheme/Localizable.xcstrings" \
    "$derived"/Build/Intermediates.noindex/Enduva.build/Debug-*simulator/"$scheme".build/Objects-normal/*/*.stringsdata
}

ios() { run Enduva iOS "${IOS_SIMULATOR:-iPhone 18 Pro}"; }
watchos() { run EnduvaWatch watchOS "${WATCHOS_SIMULATOR:-Apple Watch Series 12 (46mm)}"; }

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
