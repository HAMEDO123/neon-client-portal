import Foundation

/// Who the app is signed in as, from `/api/mobile/me`.
///
/// The manager and somebody on the team do not get the same screens, and a
/// token kept in the Keychain across launches says nothing about which it is —
/// so the app asks rather than assuming.
struct Actor: Codable {
    let type: String
    let id: String?
    let name: String?

    var isManager: Bool { type == "ADMIN" }
}

/// One row of the chat list: the team's group, or a private conversation.
struct ConversationSummary: Codable, Identifiable {
    /// How the web URLs name it — "team", "manager", or the other person's id.
    /// It is the conversation's address everywhere in the app.
    let slug: String
    let title: String
    let subtitle: String?
    let avatar: String
    let isGroup: Bool
    let last: LastMessage?
    let unread: Int

    var id: String { slug }
    var avatarURL: URL? { resolvedMediaURL(avatar) }

    struct LastMessage: Codable {
        let kind: String
        let body: String?
        let durationSeconds: Int?
        let attachmentName: String?
        let authorName: String
        let mine: Bool
        let createdAt: String
    }

    /// The line under the name, in the shorthand WhatsApp uses. Mirrors
    /// `chatPreview` on the server, including that a photo or a voice note says
    /// what it is rather than showing nothing.
    var preview: String {
        guard let last else { return "" }
        let text = last.body?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        let summary: String
        switch last.kind {
        case "VOICE":
            if let seconds = last.durationSeconds, seconds > 0 {
                summary = "🎤 \(seconds / 60):\(String(format: "%02d", seconds % 60))"
            } else {
                summary = "🎤 \(L("Voice message"))"
            }
        case "IMAGE":  summary = text.isEmpty ? "📷 \(L("Photo"))" : "📷 \(text)"
        case "FILE":   summary = "📄 \(last.attachmentName ?? text)"
        case "TASK":   summary = "📋 \(text)"
        case "CALL":   summary = "📞 \(text)"
        case "MEETING": summary = "📅 \(text)"
        default:       summary = text
        }

        // Who spoke only needs saying where it is not obvious: your own line,
        // and anyone's in the group. In a private chat it goes without saying.
        if last.mine { return "\(L("You")): \(summary)" }
        if isGroup { return "\(last.authorName): \(summary)" }
        return summary
    }
}

struct ChatMessage: Codable, Identifiable {
    let id: String
    let authorType: String
    let authorId: String?
    let authorName: String
    let kind: String
    let body: String?
    let attachmentUrl: String?
    let attachmentName: String?
    let durationSeconds: Int?
    let createdAt: String

    var attachmentURL: URL? { resolvedMediaURL(attachmentUrl) }

    /// Whether this viewer wrote it. The manager is an ADMIN message with no
    /// author id; everybody else is matched on their own id, never on a name —
    /// two people can share a name, and the studio has had that happen.
    func mine(_ actor: Actor?) -> Bool {
        guard let actor else { return false }
        if actor.isManager { return authorType == "ADMIN" }
        return authorType == "EMPLOYEE" && authorId == actor.id
    }

    /// A message that is not a line of conversation: a call's record, a task
    /// card, a meeting card. Drawn as a note across the middle rather than as
    /// a bubble, because nobody said it.
    var isSystemLine: Bool { kind == "CALL" }

    var sentAt: Date? { ISO8601DateFormatter.chat.date(from: createdAt) }
}

extension ISO8601DateFormatter {
    /// The server sends fractional seconds; the default parser refuses them.
    static let chat: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
