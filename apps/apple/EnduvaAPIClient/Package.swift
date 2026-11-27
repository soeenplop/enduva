// swift-tools-version: 6.0
// The generated Swift client for the Enduva API. swift-openapi-generator's build plugin generates the types and the
// client from openapi.json (a symlink to the committed apps/api/openapi.json) at build time, so the code is never
// committed and can't go stale. Exact pins plus the committed Package.resolved (ADR-0001).
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
            plugins: [.plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")]
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
