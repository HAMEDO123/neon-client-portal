import Foundation

// What the calls stream and the calls routes answer with — see
// src/lib/call-store.ts `callsFor` for the shape the server actually returns,
// and src/app/api/mobile/calls/stream/route.ts for the three events.

/// "admin" for the manager, an employee id otherwise — the same key the web's
/// `memberKeyOf` uses, and what every signal and data-channel message is
/// addressed by.
typealias MemberKey = String

struct CallParticipant: Codable, Identifiable, Equatable {
    var id: MemberKey { memberKey }
    let memberKey: MemberKey
    let name: String
    let color: String?
    /// INVITED, JOINED, LEFT, DECLINED
    let state: String
    let joinedAt: String?
    /// Their face, looked up by the server when the call is read (never
    /// copied onto the call): a photo, or nil for their initials. Absent from
    /// a server before faces.
    var photo: String? = nil

    var photoURL: URL? { facePhotoURL(photo) }
}

struct CallView: Codable, Identifiable, Equatable {
    let id: String
    /// AUDIO or VIDEO
    let kind: String
    /// RINGING, ACTIVE or ENDED
    let status: String
    let createdAt: String
    let answeredAt: String?
    let startedByKey: MemberKey
    let startedByName: String
    let conversationSlug: String
    let title: String
    let isGroup: Bool
    let participants: [CallParticipant]

    var isVideo: Bool { kind == "VIDEO" }
    var mine: CallParticipant? { nil } // filled by callers who know `me`
}

/// The `ready` event: who this device is to calls, and how to reach others.
struct CallReady: Codable {
    let me: MemberKey
    let name: String
    let iceServers: [IceServerInfo]
    let relay: Bool
}

/// One of Cloudflare's (or the STUN-only fallback's) ICE servers.
/// `urls` on the wire is sometimes a single string, sometimes a list — see
/// `usableIceServers` in src/lib/calls.ts.
struct IceServerInfo: Codable {
    let urls: [String]
    let username: String?
    let credential: String?

    enum CodingKeys: String, CodingKey { case urls, username, credential }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let list = try? container.decode([String].self, forKey: .urls) {
            urls = list
        } else {
            urls = [try container.decode(String.self, forKey: .urls)]
        }
        username = try container.decodeIfPresent(String.self, forKey: .username)
        credential = try container.decodeIfPresent(String.self, forKey: .credential)
    }
}

/// One connection message from another device — a session description or a
/// batch of ICE candidates. `payload` is read loosely (see `CallSignalPayload`)
/// because its shape depends on `type`.
struct CallSignal: Codable {
    let id: Int
    let callId: String
    let fromKey: MemberKey
    /// "description" or "candidates"
    let type: String
    let payload: JSONValue
}

/// What travels inside a signal's `payload`, mirroring `Payload` in
/// components/calls/call-session.ts.
struct CallSignalPayload {
    var session: Int?
    var description: RTCSessionDescriptionJSON?
    var candidates: [RTCIceCandidateJSON]?

    init(session: Int? = nil, description: RTCSessionDescriptionJSON? = nil, candidates: [RTCIceCandidateJSON]? = nil) {
        self.session = session
        self.description = description
        self.candidates = candidates
    }

    init(json: JSONValue) {
        guard case .object(let fields) = json else { return }
        if case .number(let value)? = fields["session"] { session = Int(value) }
        if let sdp = fields["description"] { description = RTCSessionDescriptionJSON(json: sdp) }
        if case .array(let list)? = fields["candidates"] {
            candidates = list.compactMap { RTCIceCandidateJSON(json: $0) }
        }
    }

    func toJSON() -> JSONValue {
        var fields: [String: JSONValue] = [:]
        if let session { fields["session"] = .number(Double(session)) }
        if let description { fields["description"] = description.toJSON() }
        if let candidates { fields["candidates"] = .array(candidates.map { $0.toJSON() }) }
        return .object(fields)
    }
}

struct RTCSessionDescriptionJSON {
    let type: String
    let sdp: String

    init?(json: JSONValue) {
        guard case .object(let fields) = json,
              case .string(let type)? = fields["type"],
              case .string(let sdp)? = fields["sdp"]
        else { return nil }
        self.type = type
        self.sdp = sdp
    }

    init(type: String, sdp: String) {
        self.type = type
        self.sdp = sdp
    }

    func toJSON() -> JSONValue { .object(["type": .string(type), "sdp": .string(sdp)]) }
}

struct RTCIceCandidateJSON {
    let candidate: String
    let sdpMid: String?
    let sdpMLineIndex: Int32?

    init?(json: JSONValue) {
        guard case .object(let fields) = json, case .string(let candidate)? = fields["candidate"] else { return nil }
        self.candidate = candidate
        if case .string(let mid)? = fields["sdpMid"] { sdpMid = mid } else { sdpMid = nil }
        if case .number(let index)? = fields["sdpMLineIndex"] { sdpMLineIndex = Int32(index) } else { sdpMLineIndex = nil }
    }

    init(candidate: String, sdpMid: String?, sdpMLineIndex: Int32?) {
        self.candidate = candidate
        self.sdpMid = sdpMid
        self.sdpMLineIndex = sdpMLineIndex
    }

    func toJSON() -> JSONValue {
        var fields: [String: JSONValue] = ["candidate": .string(candidate)]
        if let sdpMid { fields["sdpMid"] = .string(sdpMid) }
        if let sdpMLineIndex { fields["sdpMLineIndex"] = .number(Double(sdpMLineIndex)) }
        return .object(fields)
    }
}

/// The state a device sends the others over the call's data channel —
/// mirrors `RemoteState` in call-session.ts exactly (same field names).
struct CallDataChannelState: Codable {
    var audioMuted = false
    var videoOff = true
    var sharing = false
    var mids = Mids()

    struct Mids: Codable {
        var camera: String?
        var screen: String?
    }
}

/// A tiny untyped JSON value, since a signal's payload has no fixed shape on
/// this side (it's whatever the two ends of one call agree on) and ICE/SDP
/// dictionaries decode more simply through this than through Codable structs.
indirect enum JSONValue: Codable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(String.self) { self = .string(value); return }
        if let value = try? container.decode(Double.self) { self = .number(value); return }
        if let value = try? container.decode(Bool.self) { self = .bool(value); return }
        if let value = try? container.decode([String: JSONValue].self) { self = .object(value); return }
        if let value = try? container.decode([JSONValue].self) { self = .array(value); return }
        self = .null
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    /// A plain `Any` for JSONSerialization, e.g. when posting a batch of
    /// outgoing signals through APIClient.post's `[String: Any]` body.
    var anyValue: Any {
        switch self {
        case .string(let value): return value
        case .number(let value): return value
        case .bool(let value): return value
        case .object(let value): return value.mapValues { $0.anyValue }
        case .array(let value): return value.map { $0.anyValue }
        case .null: return NSNull()
        }
    }

    static func from(any value: Any) -> JSONValue {
        switch value {
        case let value as String: return .string(value)
        case let value as Bool: return .bool(value)
        case let value as Int: return .number(Double(value))
        case let value as Int32: return .number(Double(value))
        case let value as Double: return .number(value)
        case let value as [String: Any]: return .object(value.mapValues { .from(any: $0) })
        case let value as [Any]: return .array(value.map { .from(any: $0) })
        default: return .null
        }
    }
}
