// swift-tools-version: 6.2
// Shared Swift code for the iPhone and Watch apps (models, sync, HealthKit mapping, API access; 02-architecture).
// The generated API client is a local package; its remote dependencies are pinned `exact:` there, and the Xcode
// project's committed Package.resolved fixes the transitive ones.
import PackageDescription

let package = Package(
    name: "EnduvaKit",
    defaultLocalization: "en",
    platforms: [.iOS("27.0"), .watchOS("27.0")],
    products: [.library(name: "EnduvaKit", targets: ["EnduvaKit"])],
    dependencies: [.package(path: "../EnduvaAPIClient")],
    targets: [
        .target(
            name: "EnduvaKit",
            dependencies: [.product(name: "EnduvaAPIClient", package: "EnduvaAPIClient")],
            resources: [.process("Colors.xcassets")]
        ),
        .testTarget(name: "EnduvaKitTests", dependencies: ["EnduvaKit"]),
    ]
)
