// swift-tools-version: 6.0
// The generated Swift client for the Enduva API. swift-openapi-generator's command plugin generates the types and the
// client from openapi.json (a symlink to the committed apps/api/openapi.json) into GeneratedSources, which is
// committed; the swift-client CI job regenerates it and fails on a diff. Not the build plugin: Xcode runs it once per
// platform into the same output path, which fails an iPhone app that embeds a Watch app. Exact pins plus the
// committed Package.resolved (ADR-0001).
import PackageDescription

let package = Package(
    name: "EnduvaAPIClient",
    platforms: [.macOS(.v14), .iOS(.v17), .watchOS(.v10)],
    products: [.library(name: "EnduvaAPIClient", targets: ["EnduvaAPIClient"])],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", exact: "1.14.4"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", exact: "1.13.4"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", exact: "1.4.0"),
        .package(url: "https://github.com/apple/swift-http-types", exact: "1.8.0"),
    ],
    targets: [
        .target(
            name: "EnduvaAPIClient",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ],
            exclude: ["openapi.json", "openapi-generator-config.yaml"]
        ),
        .testTarget(
            name: "EnduvaAPIClientTests",
            dependencies: [
                "EnduvaAPIClient",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ]
        ),
    ]
)
