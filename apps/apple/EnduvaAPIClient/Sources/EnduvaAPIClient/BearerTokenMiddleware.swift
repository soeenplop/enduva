import Foundation
import HTTPTypes
import OpenAPIRuntime
import OpenAPIURLSession

/// Sets `Authorization: Bearer <token>` on every request. The generator declares the spec's `bearer` scheme but does
/// not apply it. The token is asked for per request, so the app can hand out a refreshed one; `nil` sends none
/// (enough for the public health routes).
public struct BearerTokenMiddleware: ClientMiddleware {
    private let accessToken: @Sendable () async throws -> String?

    public init(accessToken: @escaping @Sendable () async throws -> String?) {
        self.accessToken = accessToken
    }

    public func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        if let token = try await accessToken() {
            request.headerFields[.authorization] = "Bearer \(token)"
        }
        return try await next(request, body, baseURL)
    }
}

extension Client {
    /// The generated client for the API at `serverURL` (e.g. `https://api.example.com`), authenticated with the
    /// user's access token, with entity tags sent unencoded (`EntityTagHeaderMiddleware`). Timestamps carry milliseconds (`2026-11-27T08:00:00.123Z`, JavaScript's `toISOString`),
    /// which the runtime's default ISO 8601 transcoder refuses.
    public static func enduva(
        serverURL: URL,
        transport: any ClientTransport = URLSessionTransport(),
        accessToken: @escaping @Sendable () async throws -> String?
    ) -> Client {
        Client(
            serverURL: serverURL,
            configuration: Configuration(dateTranscoder: .iso8601WithFractionalSeconds),
            transport: transport,
            middlewares: [BearerTokenMiddleware(accessToken: accessToken), EntityTagHeaderMiddleware()]
        )
    }
}
