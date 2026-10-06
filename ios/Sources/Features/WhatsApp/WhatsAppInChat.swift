import SwiftUI

// The company WhatsApp inside the chat list — each client a row among the
// team's own conversations, ordered by the last message, opening as a
// conversation and answered from there (WHATSAPP-IN-CHAT.md; the server's
// rows and order are lib/whatsapp-watch.ts).
//
//   GET get/whatsapp/summary → { checkedAt, unreadChats, latest, rows: [...] }, or null with no linked number
//
// Read from what the server's minute-by-minute look stored, so it answers at
// once and never waits on the WhatsApp worker. Nothing here marks anything
// read: the counts belong to the studio's phone.

/// `whatsapp/summary`.
struct WhatsAppSummary: Decodable, Equatable {
    let checkedAt: Double?
    let unreadChats: Int?
    let rows: [WhatsAppSummaryRow]
}

/// One client's conversation on the company number.
struct WhatsAppSummaryRow: Decodable, Equatable, Identifiable {
    /// The WhatsApp chat id ("962790000001@c.us", "…@g.us", "…@lid").
    let id: String
    let title: String
    let preview: String
    /// Milliseconds.
    let at: Double
    /// The studio phone's own count; -1 is "marked unread" there.
    let unread: Int
    let fromMe: Bool
    let isGroup: Bool

    var date: Date { Date(timeIntervalSince1970: at / 1000) }

    /// The line under the name: "You: …" for what the studio sent. What a
    /// wordless message was ("Photo", "Voice note" — the server's words,
    /// lib/whatsapp-watch.ts TYPE_WORDS) is said in the app's language;
    /// somebody's own words never are.
    var line: String {
        let shown = Self.typeWords.contains(preview) ? L(preview) : preview
        return fromMe ? L("You: %@", shown) : shown
    }

    private static let typeWords: Set<String> = [
        "Photo", "Video", "Audio", "Voice note", "Document", "Sticker", "Location", "Contact card",
        "Contact cards", "Message deleted", "Encryption notice", "Notice", "Group update",
        "Waiting for this message", "Greeting", "Call",
    ]

    var hasUnread: Bool { unread != 0 }

    /// The dialable number, for an ordinary chat only — a group's id and a
    /// @lid chat's are not numbers anybody calls.
    var number: String? {
        guard id.hasSuffix("@c.us"), let at = id.firstIndex(of: "@") else { return nil }
        let digits = String(id[..<at])
        return digits.allSatisfy(\.isNumber) && !digits.isEmpty ? "+" + digits : nil
    }

    var route: WhatsAppChatRoute { WhatsAppChatRoute(id: id, title: title, isGroup: isGroup) }
}

/// A WhatsApp conversation pushed from the chat list (or a notification).
struct WhatsAppChatRoute: Hashable {
    let id: String
    let title: String?
    let isGroup: Bool

    /// From a chat id alone, as a notification carries it.
    init(id: String, title: String? = nil, isGroup: Bool? = nil) {
        self.id = id
        self.title = title
        self.isGroup = isGroup ?? id.hasSuffix("@g.us")
    }

    /// What the thread screen is drawn from; its own read fills in the rest.
    var chat: WhatsAppChat {
        let digits: String? = {
            guard id.hasSuffix("@c.us"), let at = id.firstIndex(of: "@") else { return nil }
            let value = String(id[..<at])
            return value.allSatisfy(\.isNumber) && !value.isEmpty ? "+" + value : nil
        }()
        return WhatsAppChat(
            id: id, name: title, number: digits, isGroup: isGroup, unreadCount: 0,
            archived: false, pinned: false, timestamp: nil, lastMessage: nil
        )
    }
}

extension APIClient {
    /// The rows for the chat list, or nil: no linked number, or this person
    /// may not read the company WhatsApp (403) — either way, no rows.
    func fetchWhatsAppSummary() async -> WhatsAppSummary? {
        guard let loaded = try? await read("whatsapp/summary", as: WhatsAppSummary?.self) else { return nil }
        return loaded.value
    }
}

/// The studio's timezone for a WhatsApp thread opened from the chat list,
/// where no inbox answer has said it.
let whatsAppStudioTimeZone = "Asia/Amman"

// MARK: - The list, with the clients folded in

/// One row of the chat list: a team conversation or a client's.
enum ChatListEntry: Identifiable {
    case chat(ConversationSummary)
    case whatsapp(WhatsAppSummaryRow)

    var id: String {
        switch self {
        case .chat(let conversation): return "c:" + conversation.id
        case .whatsapp(let row): return "w:" + row.id
        }
    }
}

/// The website's order exactly (`mergeChatList`): what this person pinned,
/// as it was; then everything with a last message — the team's and the
/// clients' together — newest first, the team's first on a tie; then the
/// colleagues nobody has written to yet. `conversations` arrive in the
/// list's own order and keep it among themselves.
func mergeChatList(_ conversations: [ConversationSummary], _ rows: [WhatsAppSummaryRow]) -> [ChatListEntry] {
    let pinned = conversations.filter(\.pinned)
    let started = conversations.filter { !$0.pinned && $0.last != nil }
    let unstarted = conversations.filter { !$0.pinned && $0.last == nil }

    var timed: [(entry: ChatListEntry, at: Double, order: Int)] = []
    for (order, conversation) in started.enumerated() {
        let at = (parseISODate(conversation.last?.createdAt)?.timeIntervalSince1970 ?? 0) * 1000
        timed.append((.chat(conversation), at, order))
    }
    for (order, row) in rows.enumerated() {
        timed.append((.whatsapp(row), row.at, started.count + order))
    }
    timed.sort { $0.at != $1.at ? $0.at > $1.at : $0.order < $1.order }

    return pinned.map { .chat($0) } + timed.map(\.entry) + unstarted.map { .chat($0) }
}

// MARK: - A client's row

/// Drawn like a conversation's — picture, name, last line, time, count —
/// with the one difference that must survive a glance: the green WhatsApp
/// mark on the picture and a green count. Answering here answers as the
/// studio's number, so which kind of row it is never depends on a name.
struct ChatWhatsAppCard: View {
    let row: WhatsAppSummaryRow

    var body: some View {
        HStack(spacing: NeonSpace.md) {
            WhatsAppRowPicture(row: row, size: 50)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    DirText(row.title, font: .system(.body, weight: .bold), fill: false, lineLimit: 1)
                        .layoutPriority(1)
                    Spacer(minLength: 6)
                    Text(chatListTime(ISO8601DateFormatter().string(from: row.date)) ?? "")
                        .font(.system(.footnote, weight: row.hasUnread ? .semibold : .regular))
                        .foregroundStyle(row.hasUnread ? Color.neonSuccessStrong : Color.neonTextTertiary)
                        .lineLimit(1)
                        .fixedSize()
                    Image(systemName: "chevron.forward")
                        .font(.system(.caption, weight: .semibold))
                        .foregroundStyle(Color.neonTextFaint)
                }
                HStack(spacing: 5) {
                    Text(L("WhatsApp"))
                        .font(.system(.caption2, weight: .bold))
                        .foregroundStyle(Color.neonSuccessStrong)
                    DirText(row.line, font: .system(.subheadline, weight: row.hasUnread ? .semibold : .regular),
                            color: row.hasUnread ? .neonText : .neonTextSecondary, fill: false, lineLimit: 1)
                    Spacer(minLength: 4)
                    if row.unread > 0 {
                        CountBadge(row.unread, tone: .success, size: 22)
                    } else if row.unread < 0 {
                        // Marked unread on the phone: a dot, no number.
                        Circle()
                            .fill(Color.neonSuccess)
                            .frame(width: 12, height: 12)
                            .accessibilityLabel(L("Unread"))
                    }
                }
            }
        }
        .padding(.vertical, 8)
        .padding(.leading, NeonSpace.md)
        .padding(.trailing, NeonSpace.md + 2)
        .rowCard(pinned: false, highlighted: row.hasUnread)
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(L("WhatsApp: %@", row.title)))
    }
}

/// A client's picture: initials on a soft green circle, a person for a chat
/// known only by its number, people for a group — and the WhatsApp mark.
struct WhatsAppRowPicture: View {
    let row: WhatsAppSummaryRow
    var size: CGFloat = 50

    private var knownByNumber: Bool {
        guard let first = row.title.first else { return true }
        return first == "+" || first.isNumber
    }

    var body: some View {
        ZStack {
            Circle().fill(NeonHue.green.wash)
            if row.isGroup {
                Image(systemName: "person.3.fill")
                    .font(.system(size: size * 0.32, weight: .semibold))
                    .foregroundStyle(NeonHue.green.deep)
            } else if knownByNumber {
                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.4, weight: .semibold))
                    .foregroundStyle(NeonHue.green.deep)
            } else {
                Text(AvatarView.initials(row.title, size: size))
                    .font(.system(size: size * 0.38, weight: .bold))
                    .foregroundStyle(NeonHue.green.deep)
            }
        }
        .frame(width: size, height: size)
        .overlay(alignment: .bottomTrailing) {
            WhatsAppMark(size: max(18, size * 0.4))
                .offset(x: 3, y: 3)
        }
        .accessibilityHidden(true)
    }
}

/// The small green WhatsApp badge.
struct WhatsAppMark: View {
    var size: CGFloat = 20

    var body: some View {
        ZStack {
            Circle().fill(Color.white)
            Circle()
                .fill(Color(red: 0.145, green: 0.827, blue: 0.4))
                .padding(1.5)
            Image(systemName: "phone.fill")
                .font(.system(size: size * 0.46, weight: .bold))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
    }
}

/// After the last row: the older chats and search live in the inbox.
struct ChatWhatsAppMoreRow: View {
    var body: some View {
        HStack(spacing: 8) {
            WhatsAppMark(size: 18)
            Text(L("Older WhatsApp chats, and search"))
                .font(.neonSubheadline.weight(.semibold))
                .foregroundStyle(Color.neonSuccessStrong)
            Spacer(minLength: 0)
            Image(systemName: "chevron.forward")
                .font(.system(.caption, weight: .semibold))
                .foregroundStyle(Color.neonTextFaint)
        }
        .padding(.horizontal, NeonSpace.md)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

// MARK: - Where a notification points

enum WhatsAppLink {
    /// The chat id in a notification's link — "/employee/whatsapp?chat=<id>",
    /// "/admin/whatsapp?chat=<id>", or the website's newer "/…/chat/wa/<id>" —
    /// or nil when it is not a WhatsApp link.
    static func chatId(in webPath: String) -> String? {
        if let range = webPath.range(of: "/chat/wa/") {
            let raw = String(webPath[range.upperBound...].prefix { $0 != "?" && $0 != "/" })
            return raw.removingPercentEncoding ?? raw
        }
        guard webPath.contains("/whatsapp"), let components = URLComponents(string: webPath) else { return nil }
        let value = components.queryItems?.first { $0.name == "chat" }?.value
        return value?.isEmpty == false ? value : nil
    }

    static func isWhatsApp(_ webPath: String) -> Bool {
        webPath.hasPrefix("/admin/whatsapp") || webPath.hasPrefix("/employee/whatsapp") || webPath.contains("/chat/wa/")
    }
}
