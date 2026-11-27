import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Sends `If-Match` and `If-None-Match` as given. The runtime percent-encodes header parameters (URI "simple" style),
/// so the entity tag `"3-…"` would leave as `%223-…%22`, which the API never matches: every update would fail with
/// `412`. Our tags never contain `%` (`"<version>-<base64url>"`), so decoding restores exactly the tag from `ETag`.
public struct EntityTagHeaderMiddleware: ClientMiddleware {
    public init() {}

    public func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        for name in [HTTPField.Name.ifMatch, .ifNoneMatch] {
            if let value = request.headerFields[name], let decoded = value.removingPercentEncoding {
                request.headerFields[name] = decoded
            }
        }
        return try await next(request, body, baseURL)
    }
}
