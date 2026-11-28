import EnduvaAPIClient
import Foundation

/// The API an app build talks to. Production is the only environment until staging exists (T22, T25).
public struct APIEnvironment: Sendable, Equatable {
    public let baseURL: URL

    public init(baseURL: URL) {
        self.baseURL = baseURL
    }

    public static let production = APIEnvironment(baseURL: URL(string: "https://api.enduva.soeenplop.dev")!)

    /// The generated client for this environment, sending the user's access token on every request.
    public func client(accessToken: @escaping @Sendable () async throws -> String?) -> Client {
        Client.enduva(serverURL: baseURL, accessToken: accessToken)
    }
}
