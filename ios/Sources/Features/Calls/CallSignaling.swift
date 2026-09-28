import Foundation

// The calls area's own calls to the server: src/app/api/mobile/calls/route.ts
// and calls/signal/route.ts, reached through APIClient's shared plumbing
// (token, base URL, error decoding) — see APIClient.swift's note above
// `read`/`perform` for why an area's own calls live in an extension here
// rather than in Core.

extension APIClient {
    struct CallStartAnswer: Decodable {
        let callId: String
        let joinedExisting: Bool?
        let iceServers: [IceServerInfo]
    }

    struct CallJoinAnswer: Decodable {
        let callId: String
        let iceServers: [IceServerInfo]
    }

    private struct CallHeartbeatAnswer: Decodable { let inCall: Bool }

    func callStart(conversation: String, kind: String) async throws -> CallStartAnswer {
        let data = try await post("calls", json: ["action": "start", "conversation": conversation, "kind": kind])
        return try JSONDecoder().decode(CallStartAnswer.self, from: data)
    }

    func callJoin(callId: String) async throws -> CallJoinAnswer {
        let data = try await post("calls", json: ["action": "join", "callId": callId])
        return try JSONDecoder().decode(CallJoinAnswer.self, from: data)
    }

    @discardableResult
    func callDecline(callId: String) async throws -> Data {
        try await post("calls", json: ["action": "decline", "callId": callId])
    }

    @discardableResult
    func callLeave(callId: String) async throws -> Data {
        try await post("calls", json: ["action": "leave", "callId": callId])
    }

    /// Whether the server still counts this device as in the call; false
    /// means it was dropped for going quiet too long and should join again.
    func callHeartbeat(callId: String) async throws -> Bool {
        let data = try await post("calls", json: ["action": "heartbeat", "callId": callId])
        return (try? JSONDecoder().decode(CallHeartbeatAnswer.self, from: data))?.inCall ?? true
    }

    /// A batch of connection messages for the other devices in this call.
    func callSendSignals(callId: String, signals: [JSONValue]) async throws {
        _ = try await post("calls/signal", json: ["callId": callId, "signals": signals.map { $0.anyValue }])
    }
}
