// swift-tools-version: 6.0
// Spike 0.3: generate + compile a Swift client from the contracts' openapi.json
// with Apple's swift-openapi-generator build plugin.
import PackageDescription

let package = Package(
    name: "SpikeAPIClient",
    platforms: [.macOS(.v14), .iOS(.v17), .watchOS(.v10)],
    products: [.library(name: "SpikeAPIClient", targets: ["SpikeAPIClient"])],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", exact: "1.14.4"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", exact: "1.13.4"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", exact: "1.4.0"),
    ],
    targets: [
        .target(
            name: "SpikeAPIClient",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
            ],
            plugins: [.plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")]
        ),
    ]
)
