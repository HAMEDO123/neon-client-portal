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

    struct ProjectTag: Decodable, Equatable, Identifiable { let id: String; let name: String }

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
    /// The newest, so a long thread still opens on what was said last.
    var comments: [Comment] = []

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

    struct Comment: Decodable, Equatable, Identifiable {
        let id: String
        let authorType: String
        let authorId: String?
        let authorName: String
        let body: String
        let createdAt: String
    }

    init(id: String, title: String, description: String?, dueAt: String?, priority: String?, attachmentUrl: String?, attachmentName: String?, assignments: [Assignment], comments: [Comment] = []) {
        self.id = id
        self.title = title
        self.description = description
        self.dueAt = dueAt
        self.priority = priority
        self.attachmentUrl = attachmentUrl
        self.attachmentName = attachmentName
        self.assignments = assignments
        self.comments = comments
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, description, dueAt, priority, attachmentUrl, attachmentName, assignments, comments
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        dueAt = try container.decodeIfPresent(String.self, forKey: .dueAt)
        priority = try container.decodeIfPresent(String.self, forKey: .priority)
        attachmentUrl = try container.decodeIfPresent(String.self, forKey: .attachmentUrl)
        attachmentName = try container.decodeIfPresent(String.self, forKey: .attachmentName)
        assignments = try container.decodeIfPresent([Assignment].self, forKey: .assignments) ?? []
        comments = try container.decodeIfPresent([Comment].self, forKey: .comments) ?? []
    }
}

/// Who a task or a meeting set in a conversation can go to.
struct ChatMembers: Decodable {
    let task: [TaskMember]
    let meeting: [MeetingMember]
}

/// One person a task can be handed to — a plain employee row.
struct TaskMember: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let name: String
    let color: String?
}

/// One person a meeting can ask — the manager included, as the key "admin".
struct MeetingMember: Decodable, Equatable, Hashable, Identifiable {
    let key: String
    let name: String
    let color: String?
    var id: String { key }
}

/// What people gave each message and what is pinned, as the live stream's
/// `reactions` event carries it (and `chat/reactions` answers the same shape).
struct ChatReactionSnapshot: Decodable, Equatable {
    var reactions: [Reaction] = []
    var pinned: [Pinned] = []

    struct Reaction: Decodable, Equatable {
        let messageId: String
        let memberKey: String
        let memberName: String
        let emoji: String
    }

    struct Pinned: Decodable, Equatable, Identifiable {
        let id: String
        let kind: String
        let body: String?
        let attachmentName: String?
        let authorName: String
        let pinnedAt: String?
        let pinnedByName: String?
    }
}

/// Who is writing, and how far each person has read — the stream's `people` event.
struct ChatPeopleSnapshot: Decodable, Equatable {
    var typing: [Typing] = []
    var reads: [ReadMark] = []

    struct Typing: Decodable, Equatable { let memberKey: String; let name: String }
    struct ReadMark: Decodable, Equatable { let key: String; let at: String }
}

/// The Tasks tab: every card this person can see, with the conversation it lives in.
struct ChatTaskListItem: Decodable, Identifiable {
    let id: String
    let messageId: String
    let title: String
    let dueAt: String
    let priority: String?
    let assignments: [TaskCard.Assignment]
    let conversationSlug: String
    let conversationTitle: String
    let isGroup: Bool

    var overall: String { TaskCard(id: id, title: title, description: nil, dueAt: dueAt, priority: priority, attachmentUrl: nil, attachmentName: nil, assignments: assignments).overall }
}

/// The Meetings tab: every card this person can see, with the conversation it lives in.
struct ChatMeetingListItem: Decodable, Identifiable {
    let id: String
    let messageId: String
    let title: String
    let mode: String?
    let place: String?
    let startsAt: String
    let durationMinutes: Int?
    let attendees: [MeetingCard.Attendee]
    let conversationSlug: String
    let conversationTitle: String
    let isGroup: Bool
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
