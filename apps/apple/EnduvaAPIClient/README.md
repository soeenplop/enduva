# EnduvaAPIClient

Swift client for the Enduva API (iOS 17, watchOS 10, macOS 14). Apple's
[swift-openapi-generator](https://github.com/apple/swift-openapi-generator) build plugin generates the types and the
`Client` at build time from `Sources/EnduvaAPIClient/openapi.json`, a symlink to the committed
[`apps/api/openapi.json`](../../api/openapi.json). Nothing generated is committed, so it can't go stale. Dependencies
are pinned `exact:` with a committed `Package.resolved` ([ADR-0001](../../../docs/adr/0001-typescript-7-toolchain.md)).
The Xcode project (0.11a) adds this package as a local dependency of `EnduvaKit`.

```swift
let client = Client.enduva(serverURL: apiURL) { try await session.accessToken() }
switch try await client.getMe() {
case let .ok(ok): show(try ok.body.json, etag: ok.headers.ETag)
case let .unauthorized(error) where try error.body.application_problem_plus_json.code == "device_revoked": wipe()
default: ...
}
```

`Client.enduva(...)` adds what the generated client lacks:

- **`BearerTokenMiddleware`**: `Authorization: Bearer <token>`, asked for per request (the generator declares the
  spec's `bearer` scheme but doesn't apply it).
- **`EntityTagHeaderMiddleware`**: the runtime percent-encodes header parameters, so `If-Match: "3-…"` would leave as
  `%223-…%22` and every update would fail with `412`. It sends the tag unencoded.
- **Timestamps with milliseconds** (`.iso8601WithFractionalSeconds`), as the API sends them.

Known limit: optional and nullable properties both become Swift optionals, and `nil` is omitted when encoding. So
`PATCH /v1/me` can't send `null` to clear a field through the generated `MeUpdate` yet
([#127](https://github.com/soeenplop/enduva/issues/127), for the profile screen in 0.11b).

## Build and test

```sh
swift test --force-resolved-versions   # generates, compiles and runs the tests (macOS)
```

The tests run the generated client against a stub transport: bearer and conditional headers, the JSON body, decoding
of `Me` (with a field the client doesn't know yet), of problem bodies (with a code it doesn't know yet) and of `304`.
CI runs them in the `swift-client` job on `macos-26`.
