import SwiftUI

/// The task and meeting cards from every conversation this person is in — the
/// same reading as the web chat's own Tasks view. Nothing is stored: each
/// load reads `/chat/conversations` and then each conversation's messages,
/// which never marks anything read.
///
/// `/chat/messages` returns at most the last 200 messages of a conversation,
/// so a card older than that is not here; `truncated` says when that
/// actually happened, and the screens say so only then.
@MainActor
final class ChatCardsLoader: ObservableObject {
    struct Item: Identifiable {
        let conversation: ConversationSummary
        let message: ChatMessage
        var id: String { message.id }
    }

    @Published private(set) var tasks: [Item] = []
    @Published private(set) var meetings: [Item] = []
    @Published private(set) var cachedAt: Date?
    @Published private(set) var errorMessage: String?
    @Published private(set) var loaded = false
    /// Some conversation has more than the 200 messages read, so cards
    /// older than those may be missing.
    @Published private(set) var truncated = false
    /// The team's conversation as the server names it, where a meeting set
    /// from the Meetings page is posted.
    @Published private(set) var teamTitle: String?

    static let messagesRead = 200

    func load(_ api: APIClient) async {
        do {
            let conversations = try await api.fetchConversations()
            var found: [Item] = []
            var oldestCache = conversations.cachedAt
            var cut = false

            await withTaskGroup(of: (ConversationSummary, Loaded<[ChatMessage]>?).self) { group in
                for conversation in conversations.value.conversations {
                    group.addTask { @MainActor in
                        (conversation, try? await api.fetchMessages(conversation: conversation.slug, take: ChatCardsLoader.messagesRead))
                    }
                }
                for await (conversation, loaded) in group {
                    guard let loaded else { continue }
                    if let at = loaded.cachedAt { oldestCache = min(oldestCache ?? at, at) }
                    if loaded.value.count >= ChatCardsLoader.messagesRead { cut = true }
                    for message in loaded.value where message.task != nil || message.meeting != nil {
                        found.append(Item(conversation: conversation, message: message))
                    }
                }
            }

            tasks = found.filter { $0.message.task != nil }
                .sorted { $0.message.createdAt > $1.message.createdAt }
            meetings = found.filter { $0.message.meeting != nil }
                .sorted { ($0.message.meeting?.startsAt ?? "") < ($1.message.meeting?.startsAt ?? "") }
            cachedAt = oldestCache
            truncated = cut
            teamTitle = conversations.value.conversations.first { $0.slug == "team" }?.title
            errorMessage = nil
            loaded = true
        } catch {
            if !loaded { errorMessage = error.localizedDescription }
        }
    }
}

extension ChatRoute {
    init(_ conversation: ConversationSummary) {
        self.init(
            slug: conversation.slug,
            title: conversation.title,
            subtitle: conversation.subtitle,
            avatar: conversation.avatar,
            isGroup: conversation.isGroup
        )
    }
}

// MARK: - A card's overall state

extension TaskCard {
    /// `overallState` in src/lib/chat-tasks.ts, as the list needs it: waiting
    /// on the manager if anybody has sent proof, done when everybody is done,
    /// otherwise still being worked on.
    var overall: String {
        let states = assignments.map(\.state)
        if states.contains("SUBMITTED") { return "SUBMITTED" }
        if !states.isEmpty && states.allSatisfy({ $0 == "DONE" }) { return "DONE" }
        if states.contains("IN_PROGRESS") { return "IN_PROGRESS" }
        return "TODO"
    }

    var isOverdue: Bool {
        guard overall != "DONE", let due = parseISODate(dueAt) else { return false }
        return due < Date()
    }
}

/// One card from a conversation, for the lists of every card (the manager's
/// Tasks tab): what it is, where it lives, when it is due, and each person's part.
struct ChatTaskRow: View {
    let item: ChatCardsLoader.Item
    let viewer: Identity?

    var body: some View {
        if let card = item.message.task {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 12) {
                    IconTile("checklist", hue: .purple, size: NeonSize.iconTile)
                    VStack(alignment: .leading, spacing: 5) {
                        DirText(card.title, font: .neonRowTitle, lineLimit: 2)
                        StateBadge(cardStateLabel(card.overall), tone: taskStateTone(card.overall),
                                   symbol: StateBadge.symbol(for: card.overall), pulsing: card.overall == "IN_PROGRESS")
                        MetaLabel(item.conversation.title, symbol: item.conversation.isGroup ? "person.3.fill" : "bubble.left.fill")
                        if let due = chatCardDate(card.dueAt) {
                            MetaLabel(L("Due %@", due), symbol: card.isOverdue ? "exclamationmark.circle.fill" : "clock",
                                      tint: card.isOverdue ? .neonDangerStrong : .neonTextTertiary)
                        }
                    }
                    Spacer(minLength: 0)
                }

                if !card.assignments.isEmpty {
                    FlowRow(spacing: 6) {
                        ForEach(card.assignments) { part in
                            HStack(spacing: 5) {
                                ChatAvatar(url: facePhotoURL(part.employee?.photoUrl), name: part.employee?.name ?? "—", size: 20, color: part.employee?.color)
                                Text(verbatim: part.employee?.name ?? "—")
                                    .font(.system(.caption, weight: .semibold))
                                    .foregroundStyle(Color.neonInk.opacity(0.85))
                                    .lineLimit(1)
                                Circle().fill(taskStateTone(part.state).color).frame(width: 6, height: 6)
                            }
                            .padding(.leading, 3)
                            .padding(.trailing, 9)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(taskStateTone(part.state).hue.wash))
                            .accessibilityElement(children: .combine)
                            .accessibilityValue(cardStateLabel(part.state))
                        }
                    }
                    .padding(.leading, NeonSize.iconTile + 12)
                }
            }
            .padding(NeonSpace.card - 2)
            .rowCard()
        }
    }
}

/// A card reads To do → In progress → Sent for review → Done.
func cardStateLabel(_ state: String) -> String {
    switch state {
    case "TODO", "TOMORROW": return L("To do")
    case "IN_PROGRESS": return L("In progress")
    case "SUBMITTED": return L("Sent for review")
    case "DONE": return L("Done")
    default: return taskStateLabel(state)
    }
}

// MARK: - Meetings

/// Every meeting card from every conversation this person is in: what is
/// coming up (with Join from ten minutes before, and Answer while they have
/// not), then what has passed. Pushed from the chat list and More, so it keeps
/// the system bar and its back button, and no account menu.
struct MeetingsView: View {
    @EnvironmentObject var api: APIClient
    @StateObject private var cards = ChatCardsLoader()
    @State private var showCompose = false

    /// Only the manager sets meetings (lib/chat-meetings.ts).
    private var isAdmin: Bool { api.identity?.side == .admin }

    var body: some View {
        ScrollViewReader { proxy in
            NeonScroll(spacing: NeonSpace.stack) {
                if let cachedAt = cards.cachedAt { OfflineBanner(savedAt: cachedAt) }

                if !cards.loaded, let error = cards.errorMessage {
                    ErrorState(message: error) { await cards.load(api) }
                } else if !cards.loaded {
                    SkeletonCard(lines: 3)
                    SkeletonRows(count: 2)
                } else {
                    if upcoming.isEmpty {
                        SectionCard(L("Coming up"), subtitle: L("Meetings from every chat you're in"), symbol: "calendar", hue: .cyan) {
                            EmptyState(
                                symbol: "calendar.badge.clock",
                                title: L("No meetings coming up"),
                                // The manager has the button right here; the team
                                // is asked from a chat.
                                detail: isAdmin ? L("Set one here, or from any chat with + → Meeting.") : L("Meetings set from a chat appear here."),
                                hue: .cyan
                            )
                            .padding(.vertical, -12)
                        }
                        .id("coming-up")
                        .neonAppear()
                    } else {
                        SectionHeader(L("Coming up"), count: upcoming.count)
                            .padding(.top, 4)
                            .id("coming-up")
                        ForEach(Array(upcoming.enumerated()), id: \.element.id) { index, item in
                            row(item).staggered(index)
                        }
                    }

                    if !past.isEmpty {
                        SectionHeader(L("Earlier"), count: past.count)
                            .padding(.top, 10)
                            .id("earlier")
                        ForEach(past) { row($0) }
                    }

                    // Said only when a chat really is longer than what was read.
                    if cards.truncated {
                        StatusNote(
                            symbol: "info.circle.fill", tone: .info,
                            title: L("Older meetings may not be listed"),
                            detail: L("Meetings from the last 200 messages of each chat.")
                        )
                        .padding(.top, 4)
                    }
                }

                Color.clear.frame(height: isAdmin ? NeonSize.fab : 0)
                    .debugScroll(proxy)
            }
        }
        .refreshable { await cards.load(api) }
        .navigationTitle(L("Meetings"))
        .navigationDestination(for: ChatRoute.self) { ChatRoomView(route: $0) }
        // Set from the team's own chat, exactly where the web's + → Meeting
        // lives — the same native sheet a conversation's own + opens, which
        // says where the meeting will be posted.
        .floatingActionButton("calendar.badge.plus", label: L("Set a meeting"), isVisible: isAdmin) {
            showCompose = true
        }
        .task { await cards.load(api) }
        .sheet(isPresented: $showCompose) {
            ChatMeetingComposeSheet(
                conversationSlug: "team",
                postedIn: cards.teamTitle.map { L("Posted in %@", $0) } ?? L("Posted in the team chat")
            ) {
                Task { await cards.load(api) }
            }
        }
    }

    private func ends(_ meeting: MeetingCard) -> Date? {
        parseISODate(meeting.startsAt).map { $0.addingTimeInterval(Double(meeting.durationMinutes ?? 60) * 60) }
    }

    private var upcoming: [ChatCardsLoader.Item] {
        cards.meetings.filter { item in
            guard let meeting = item.message.meeting, let end = ends(meeting) else { return false }
            return end >= Date()
        }
    }

    private var past: [ChatCardsLoader.Item] {
        Array(cards.meetings.filter { !upcoming.map(\.id).contains($0.id) }.reversed().prefix(20))
    }

    @ViewBuilder
    private func row(_ item: ChatCardsLoader.Item) -> some View {
        if let meeting = item.message.meeting {
            MeetingRow(meeting: meeting, conversation: item.conversation, viewer: api.identity)
        }
    }
}

private struct MeetingRow: View {
    let meeting: MeetingCard
    let conversation: ConversationSummary
    let viewer: Identity?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ChatMeetingDateTile(iso: meeting.startsAt, size: 46)

            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 3) {
                        DirText(meeting.title, font: .neonRowTitle, lineLimit: 2)
                        if let agenda = meeting.agenda, !agenda.isEmpty {
                            DirText(agenda, font: .neonSubtitle, color: .neonTextSecondary, lineLimit: 2)
                        }
                    }
                    if isLive {
                        StateBadge(L("Now"), tone: .pink, pulsing: true)
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    if let starts = chatCardDate(meeting.startsAt) {
                        MetaLabel(meeting.durationMinutes.map { L("%@ · %d min", starts, $0) } ?? starts, symbol: "clock")
                    }
                    MetaLabel(
                        meeting.mode == "IN_PERSON" ? (meeting.place?.isEmpty == false ? meeting.place! : L("In person")) : L("Online"),
                        symbol: meeting.mode == "IN_PERSON" ? "mappin.and.ellipse" : "video.fill"
                    )
                    MetaLabel(conversation.title, symbol: conversation.isGroup ? "person.3.fill" : "bubble.left.fill")
                }

                if !meeting.attendees.isEmpty {
                    FlowRow(spacing: 6) {
                        ForEach(meeting.attendees) { person in
                            HStack(spacing: 4) {
                                Image(systemName: rsvpSymbol(person.rsvp))
                                    .font(.system(size: 10, weight: .bold))
                                Text(verbatim: chatMemberName(key: person.memberKey, name: person.name))
                                    .lineLimit(1)
                            }
                            .font(.system(.caption, weight: .semibold))
                            .foregroundStyle(rsvpTone(person.rsvp).foreground)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 4)
                            .background(Capsule().fill(rsvpTone(person.rsvp).background))
                            .accessibilityElement(children: .combine)
                            .accessibilityValue(rsvpLabel(person.rsvp))
                        }
                    }
                }

                if (meeting.mode != "IN_PERSON" && joinable) || (myAnswer == "INVITED" && !isOver) {
                    HStack(spacing: 8) {
                        if meeting.mode != "IN_PERSON" && joinable {
                            actionButton(L("Join"), symbol: "video.fill", primary: true)
                        }
                        if myAnswer == "INVITED" && !isOver {
                            actionButton(L("Answer"), symbol: "hand.raised.fill", primary: !joinable)
                        }
                    }
                }
            }
        }
        .padding(NeonSpace.card)
        .rowCard()
        .opacity(isOver ? 0.72 : 1)
    }

    private var start: Date? { parseISODate(meeting.startsAt) }
    private var end: Date? { start.map { $0.addingTimeInterval(Double(meeting.durationMinutes ?? 60) * 60) } }
    private var isOver: Bool { (end ?? .distantFuture) < Date() }
    private var isLive: Bool { (start ?? .distantFuture) <= Date() && !isOver }
    /// The web's Join opens ten minutes before the hour.
    private var joinable: Bool { (start ?? .distantFuture).addingTimeInterval(-10 * 60) <= Date() && !isOver }

    private var myAnswer: String? {
        guard let viewer else { return nil }
        let key = viewer.side == .admin ? "admin" : (viewer.id ?? "")
        return meeting.attendees.first { $0.memberKey == key }?.rsvp
    }

    /// Both buttons open the conversation the card actually lives in — Join and
    /// Answer are the card's own controls there, native, not a web page.
    private func actionButton(_ title: String, symbol: String, primary: Bool) -> some View {
        NavigationLink(value: ChatRoute(conversation)) {
            Label(title, systemImage: symbol)
        }
        .buttonStyle(.neon(primary ? .primary : .secondary, size: .small, fullWidth: true))
    }
}
