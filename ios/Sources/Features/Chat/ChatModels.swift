import Foundation

// Chat as the mobile API answers it (src/app/api/mobile/chat/*), which is the
// same `conversationsFor` / `listMessages` the web reads — so who sees which
// conversation is decided on the server, and this only draws it.

struct ConversationsResponse: Decodable {
    let conversations: [ConversationSummary]
}

struct ConversationSummary: Decodable, Identifiable {
    /// How this conversation is named from the viewer's side: "team",
    /// "manager", or somebody's id. It is what `/chat/messages` takes.
    let slug: String
    let title: String
    let subtitle: String?
    let avatar: String?
    let isGroup: Bool
    let last: LastMessage?
    let unread: Int

    var id: String { slug }
    var avatarURL: URL? { resolvedMediaURL(avatar) }
}

struct LastMessage: Decodable {
    let kind: String
    let body: String?
    let durationSeconds: Double?
    let attachmentName: String?
    let authorName: String?
    let mine: Bool?
    let createdAt: String?

    /// What the list shows under a conversation's name.
    func preview(isGroup: Bool) -> String {
        let what: String
        switch kind {
        case "IMAGE": what = L("📷 Photo")
        case "FILE": what = "📎 " + (attachmentName ?? L("File"))
        case "VOICE": what = L("🎤 Voice message")
        case "TASK": what = "✅ " + (body ?? L("Task"))
        case "MEETING": what = "📅 " + (body ?? L("Meeting"))
        case "CALL": what = "📞 " + (body ?? L("Call"))
        default: what = body ?? ""
        }
        if mine == true { return L("You: %@", what) }
        if isGroup, let authorName, kind != "CALL" { return "\(authorName): \(what)" }
        return what
    }
}

struct ChatMessage: Decodable, Identifiable, Equatable {
    let id: String
    let authorType: String
    let authorId: String?
    let authorName: String?
    let kind: String
    let body: String?
    let attachmentUrl: String?
    let attachmentName: String?
    let attachmentType: String?
    let attachmentSize: Int?
    let durationSeconds: Double?
    let managerOnly: Bool?
    let createdAt: String
    let project: ProjectTag?
    let task: TaskCard?
    let call: CallLine?
    let meeting: MeetingCard?

    struct ProjectTag: Decodable, Equatable { let id: String; let name: String }

    struct CallLine: Decodable, Equatable {
        let kind: String?
        let endReason: String?
    }

    var attachmentURL: URL? { resolvedMediaURL(attachmentUrl) }

    /// A photo sent as a file from the web keeps its name and arrives as a
    /// FILE — it is still a picture, and is drawn as one.
    var isPicture: Bool {
        if kind == "IMAGE" { return true }
        guard kind == "FILE", let type = attachmentType?.lowercased() else { return false }
        return ["png", "jpg", "jpeg", "gif", "webp", "heic"].contains(type)
    }

    /// Whether the signed-in person wrote it.
    func isMine(_ identity: Identity?) -> Bool {
        guard let identity else { return false }
        switch identity.side {
        case .admin: return authorType == "ADMIN"
        case .employee: return authorType == "EMPLOYEE" && authorId == identity.id
        }
    }
}

/// A job the manager handed out from the chat. Each person on it has an
/// ordinary AssignedTask — the `id` of their assignment is what
/// `/tasks/[id]/proof` takes.
struct TaskCard: Decodable, Equatable {
    let id: String
    let title: String
    let description: String?
    let dueAt: String?
    let priority: String?
    let attachmentUrl: String?
    let attachmentName: String?
    let assignments: [Assignment]

    struct Assignment: Decodable, Equatable, Identifiable {
        let id: String
        let employeeId: String
        let state: String
        let employee: Who?
        let submissions: [Submission]?

        struct Who: Decodable, Equatable { let name: String; let color: String? }
        struct Submission: Decodable, Equatable {
            let id: String
            let imageUrl: String?
            let note: String?
            let createdAt: String?
        }
    }
}

/// A meeting the manager set from the chat.
struct MeetingCard: Decodable, Equatable {
    let id: String
    let title: String
    let agenda: String?
    let mode: String?
    let place: String?
    let startsAt: String
    let durationMinutes: Int?
    let attendees: [Attendee]

    struct Attendee: Decodable, Equatable, Identifiable {
        let id: String
        let memberKey: String
        let name: String
        let rsvp: String
    }
}

/// What a meeting answer is called. `INVITED` is asked and not yet answered —
/// never a refusal.
func rsvpLabel(_ rsvp: String) -> String {
    switch rsvp {
    case "ACCEPTED": return L("Coming")
    case "DECLINED": return L("Not coming")
    default: return L("Not answered yet")
    }
}
