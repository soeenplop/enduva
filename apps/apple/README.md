# Enduva for iPhone and Apple Watch

Swift 6, SwiftUI, iOS/watchOS 27, Xcode 27.2 ([T6](../../docs/plan/00-decisions.md), [architecture](../../docs/plan/02-architecture.md)).

| Path | What |
| --- | --- |
| `Enduva.xcodeproj` | Targets `Enduva` (iPhone), `EnduvaWatch` (watchOS, embedded in the iPhone app, runs on its own), `EnduvaTests`. Scheme `Enduva` runs `EnduvaTests` and `EnduvaKitTests` on iOS, scheme `EnduvaWatch` runs `EnduvaKitTests` on watchOS |
| `Config/*.xcconfig` | Every build setting. `project.pbxproj` has none, and its folders are synchronized, so adding a file doesn't touch it |
| `EnduvaKit` | Local package shared by both apps: API environment, design-token colors, the brand mark. Depends on `EnduvaAPIClient` |
| `EnduvaAPIClient` | The generated API client ([README](EnduvaAPIClient/README.md)) |
| `*/Localizable.xcstrings` | String Catalogs, English and German for every key |
| `*/AppIcon.icon` | Icon Composer icons from [`assets/brand/final`](../../assets/brand/final) (layers copied, `scripts/lint.sh` checks they match) |

## Build, test, lint

Open `Enduva.xcodeproj`, or from this directory:

```sh
scripts/test.sh            # both apps on the simulators; `ios` or `watchos` for one
scripts/lint.sh            # swift-format, SwiftLint, String Catalog and icon checks
```

CI runs both in the `apple` job on the `xcode-27` image. Package versions come only from the committed
`Enduva.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`.

## Conventions

- **Strings:** semantic keys (`shell.tagline`) with an English and a German value. Use `Text(verbatim:)` for text that
  isn't translated, such as the app name.
- **Colors:** `Palette` in EnduvaKit. Its catalog and the apps' `AccentColor`/`LaunchBackground` are generated from
  [`packages/ui/src/tokens.ts`](../../packages/ui/src/tokens.ts) by `pnpm --filter @enduva/ui build`; change the
  tokens, not the catalogs. CI fails on stale catalogs.
- **Signing:** automatic, Team ID `4K9Y59Z87Y` in `Config/Shared.xcconfig`; the git-ignored `Config/Local.xcconfig`
  can override it. Bundle IDs: `dev.soeenplop.enduva` and `.watchkitapp`.
- **Watch tests:** there is no hosted Watch test target. On CI's watchOS simulator, a test host app fails to launch
  ("Application has termination assertions", then "The test runner hung before establishing connection"). So the
  Watch scheme runs EnduvaKit's tests, which need no app, and `EnduvaTests` checks the Watch app's bundle (strings,
  Info.plist) inside the copy embedded in the iPhone app. Shared logic belongs in EnduvaKit, where it's tested on
  both platforms.
