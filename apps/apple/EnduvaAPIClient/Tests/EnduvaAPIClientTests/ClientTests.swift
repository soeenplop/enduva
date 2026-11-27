import EnduvaAPIClient
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

/// A transport that records the request and answers with one canned response, so the generated client, the bearer
/// middleware and the body decoding run for real without a server.
final class StubTransport: ClientTransport, @unchecked Sendable {
    private let status: HTTPResponse.Status
    private let headers: HTTPFields
    private let body: String?
    private(set) var request: HTTPRequest?
    private(set) var requestBody: String?

    init(status: HTTPResponse.Status, headers: HTTPFields = [:], body: String? = nil) {
        self.status = status
        self.headers = headers
        self.body = body
    }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        self.request = request
        if let body { requestBody = try await String(collecting: body, upTo: 1 << 20) }
        return (HTTPResponse(status: status, headerFields: headers), self.body.map { HTTPBody($0) })
    }
}

let server = URL(string: "https://api.example.test")!
let json: HTTPFields = [.contentType: "application/json; charset=utf-8", .eTag: "\"2-x\""]
let problemJSON: HTTPFields = [.contentType: "application/problem+json; charset=utf-8"]

/// A profile with a field this client doesn't know: response objects are open in the spec, so it must still decode.
let meBody = """
    {"id":"0b5f8f6e-6c1e-4b7a-9d6a-3d1f1f3b2c4a","displayName":"Synthetic Sam","birthDate":null,"sex":null,
    "heightCm":181,"locale":"de","timeZone":"Europe/Berlin","role":"user","onboardingCompletedAt":"2026-11-27T08:00:00.123Z",
    "version":2,
    "addedLater":true}
    """

@Test func sendsTheBearerTokenAndDecodesTheProfileWithItsETag() async throws {
    let transport = StubTransport(status: .ok, headers: json, body: meBody)
    let client = Client.enduva(serverURL: server, transport: transport) { "token" }
    let response = try await client.getMe(headers: .init(If_hyphen_None_hyphen_Match: "\"1-x\""))
    #expect(transport.request?.headerFields[.authorization] == "Bearer token")
    #expect(transport.request?.headerFields[.ifNoneMatch] == "\"1-x\"")
    #expect(transport.request?.path == "/v1/me")
    let ok = try response.ok
    #expect(ok.headers.ETag == "\"2-x\"")
    let me = try ok.body.json
    #expect(me.timeZone == "Europe/Berlin")
    #expect(me.displayName == "Synthetic Sam")
    #expect(me.sex == nil)
    #expect(me.onboardingCompletedAt == Date(timeIntervalSince1970: 1_795_766_400.123))
    #expect(me.version == 2)
}

@Test func sendsIfMatchAndDecodesAProblemWithACodeAddedLater() async throws {
    let problem = #"{"type":"about:blank","title":"Precondition Failed","status":412,"code":"some_future_code"}"#
    let transport = StubTransport(status: .preconditionFailed, headers: problemJSON, body: problem)
    let client = Client.enduva(serverURL: server, transport: transport) { nil }
    let response = try await client.updateMe(
        headers: .init(If_hyphen_Match: "\"1-x\""),
        body: .json(.init(heightCm: 172.5))
    )
    #expect(transport.request?.method == .patch)
    #expect(transport.request?.headerFields[.ifMatch] == "\"1-x\"")
    #expect(transport.request?.headerFields[.authorization] == nil)
    #expect(transport.requestBody?.contains(#""heightCm" : 172.5"#) == true)
    let body = try response.preconditionFailed.body.application_problem_plus_json
    #expect(body.code == "some_future_code")
    #expect(body.status == 412)
}

@Test func decodesTheRevokedDeviceProblem() async throws {
    let problem = #"{"type":"about:blank","title":"Unauthorized","status":401,"code":"device_revoked"}"#
    let headers: HTTPFields = [.contentType: "application/problem+json", .wwwAuthenticate: "Bearer"]
    let transport = StubTransport(status: .unauthorized, headers: headers, body: problem)
    let client = Client.enduva(serverURL: server, transport: transport) { "revoked" }
    let response = try await client.getMe()
    #expect(try response.unauthorized.body.application_problem_plus_json.code == "device_revoked")
}

@Test func reportsNotModified() async throws {
    let transport = StubTransport(status: .notModified)
    let client = Client.enduva(serverURL: server, transport: transport) { "token" }
    let response = try await client.getMe(headers: .init(If_hyphen_None_hyphen_Match: "\"2-x\""))
    #expect(throws: Never.self) { try response.notModified }
}
