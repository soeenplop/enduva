import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

/// Uses the generated client, so a spec change that breaks this call fails the Swift build.
public struct ActivityLoader: Sendable {
    let client: Client

    public init(serverURL: URL) {
        client = Client(serverURL: serverURL, transport: URLSessionTransport())
    }

    public func activity(id: String, units: Operations.getActivity.Input.Query.unitsPayload = .metric) async throws -> Components.Schemas.Activity {
        let response = try await client.getActivity(path: .init(activityId: id), query: .init(units: units))
        switch response {
        case let .ok(ok):
            return try ok.body.json
        case let .badRequest(problem):
            throw LoaderError.problem(code: try problem.body.application_problem_plus_json.code)
        case let .unauthorized(problem):
            throw LoaderError.problem(code: try problem.body.application_problem_plus_json.code)
        case let .notFound(problem):
            throw LoaderError.problem(code: try problem.body.application_problem_plus_json.code)
        case let .undocumented(statusCode, _):
            throw LoaderError.undocumented(statusCode)
        }
    }
}

public enum LoaderError: Error {
    case problem(code: String)
    case undocumented(Int)
}
