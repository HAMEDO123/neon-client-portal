import SwiftUI

/// The task and meeting cards from every conversation this person is in — the
/// same reading as the web chat's own Tasks view. Nothing is stored: each
/// load reads `/chat/conversations` and then each conversation's messages,
/// which never marks anything read.
///
/// `/chat/messages` returns at most the last 200 messages of a conversation,
/// so a card older than that is not here; the screens say so.
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

    func load(_ api: APIClient) async {
        do {
            let conversations = try await api.fetchConversations()
            var found: [Item] = []
            var oldestCache = conversations.cachedAt

            await withTaskGroup(of: (ConversationSummary, Loaded<[ChatMessage]>?).self) { group in
                for conversation in conversations.value.conversations {
                    group.addTask { @MainActor in
                        (conversation, try? await api.fetchMessages(conversation: conversation.slug, take: 200))
                    }
                }
                for await (conversation, loaded) in group {
                    guard let loaded else { continue }
                    if let at = loaded.cachedAt { oldestCache = min(oldestCache ?? at, at) }
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

// MARK: - The manager's Tasks tab

enum CardFilter: String, CaseIterable, Identifiable {
    case open, review, done, all
    var id: String { rawValue }
    var label: String {
        switch self {
        case .open: return L("Open")
        case .review: return L("To review")
        case .done: return L("Done")
        case .all: return L("All")
        }
    }
}

struct ManagerTasksView: View {
    @EnvironmentObject var api: APIClient
    @StateObject private var cards = ChatCardsLoader()
    @State private var filter: CardFilter = .open
    @State private var web: WebPortalLink?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    // The board and the review queue are the website's own
                    // pages until the phone API has them (ios/SERVER-REQUEST.md).
                    HStack(spacing: 10) {
                        WebTile(title: L("Task board"), symbol: "square.grid.3x3") {
                            web = WebPortalLink(path: "/admin/tasks", title: L("Task board"))
                        }
                        WebTile(title: L("Reviews"), symbol: "checkmark.seal", badge: reviewCount) {
                            web = WebPortalLink(path: "/admin/reviews", title: L("Reviews"),
                                                hint: L("Approve the proof, or send it back with a reason."))
                        }
                    }

                    WebTile(title: L("Hand out a task"), symbol: "plus.circle") {
                        web = WebPortalLink(path: "/admin/chat/team", title: L("Hand out a task"),
                                            hint: L("Press + in the chat and choose Task. For one person, open their chat instead."))
                    }

                    SectionLabel(L("Handed out in chat"))
                    Picker(L("Show"), selection: $filter) {
                        ForEach(CardFilter.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    if let cachedAt = cards.cachedAt { OfflineBanner(savedAt: cachedAt) }

                    if !cards.loaded, let error = cards.errorMessage {
                        ErrorState(message: error) { await cards.load(api) }
                    } else if !cards.loaded {
                        SkeletonRows(count: 4)
                    } else if shown.isEmpty {
                        EmptyState(symbol: "checklist", title: L("No tasks here"))
                            .glassCard(radius: 18)
                    } else {
                        ForEach(shown) { item in
                            NavigationLink(value: ChatRoute(item.conversation)) {
                                ChatTaskRow(item: item, viewer: api.identity)
                            }
                            .buttonStyle(.pressable)
                        }
                    }

                    Text(L("Tasks from the last 200 messages of each chat."))
                        .font(.system(size: 11))
                        .foregroundStyle(Color.neonInk.opacity(0.4))
                }
                .padding(16)
            }
            .refreshable { await cards.load(api) }
            .navigationTitle(L("Tasks"))
            .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountMenu() } }
            .navigationDestination(for: ChatRoute.self) { ChatRoomView(route: $0) }
            .neonAmbientBackground()
        }
        .task { await cards.load(api) }
        .fullScreenCover(item: $web) { WebPortalSheet(link: $0) }
    }

    private var reviewCount: Int {
        cards.tasks.reduce(0) { $0 + ($1.message.task?.assignments.filter { $0.state == "SUBMITTED" }.count ?? 0) }
    }

    private var shown: [ChatCardsLoader.Item] {
        cards.tasks.filter { item in
            guard let card = item.message.task else { return false }
            switch filter {
            case .open: return card.overall == "TODO" || card.overall == "IN_PROGRESS"
            case .review: return card.overall == "SUBMITTED"
            case .done: return card.overall == "DONE"
            case .all: return true
            }
        }
    }
}

/// One task card in a list: what it is, where it was handed out, when it is
/// due, and where each person on it stands.
struct ChatTaskRow: View {
    let item: ChatCardsLoader.Item
    let viewer: Identity?

    var body: some View {
        if let card = item.message.task {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    DirText(card.title, font: .system(size: 16, weight: .semibold))
                    BadgeView(text: cardStateLabel(card.overall), tone: taskStateTone(card.overall))
                }
                HStack(spacing: 6) {
                    Image(systemName: item.conversation.isGroup ? "person.3" : "bubble.left")
                    Text(item.conversation.title)
                    if let due = formattedISODate(card.dueAt) {
                        Text("·")
                        Text(L("Due %@", due))
                            .foregroundStyle(card.isOverdue ? Color.red.opacity(0.8) : Color.neonInk.opacity(0.5))
                    }
                }
                .font(.system(size: 12))
                .foregroundStyle(Color.neonInk.opacity(0.5))

                FlowRow {
                    ForEach(card.assignments) { part in
                        HStack(spacing: 4) {
                            Circle().fill(taskStateTone(part.state).foreground).frame(width: 7, height: 7)
                            Text(part.employee?.name ?? "—")
                        }
                        .font(.system(size: 12, weight: .medium))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.neonInk.opacity(0.05), in: Capsule())
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassCard(radius: 16)
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

struct WebTile: View {
    let title: String
    let symbol: String
    var badge = 0
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.neonPurpleStrong)
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.neonInk)
                Spacer(minLength: 0)
                if badge > 0 {
                    Text("\(badge)")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 7)
                        .frame(minHeight: 22)
                        .background(Color.neonPinkStrong, in: Capsule())
                }
                Image(systemName: "arrow.up.forward.square")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.neonInk.opacity(0.35))
            }
            .padding(14)
            .frame(maxWidth: .infinity)
            .glassCard(radius: 16)
        }
        .buttonStyle(.pressable)
    }
}

// MARK: - The employee's jobs from chat

/// Jobs handed to this person on a chat task card — their own part of each,
/// with "Send proof" while it is still theirs to do.
struct MyChatJobsSection: View {
    let filter: TaskFilter
    @ObservedObject var cards: ChatCardsLoader
    let viewer: Identity?
    let sendProof: (TaskCard.Assignment, TaskCard) -> Void

    var body: some View {
        let mine = cards.tasks.compactMap { item -> (ChatCardsLoader.Item, TaskCard, TaskCard.Assignment)? in
            guard let card = item.message.task,
                  let part = card.assignments.first(where: { $0.employeeId == viewer?.id }) else { return nil }
            switch filter {
            case .open: return part.state == "DONE" ? nil : (item, card, part)
            case .completed: return part.state == "DONE" ? (item, card, part) : nil
            case .all: return (item, card, part)
            }
        }

        if !mine.isEmpty {
            SectionLabel(L("Handed out in chat"))
            ForEach(mine, id: \.0.id) { item, card, part in
                VStack(alignment: .leading, spacing: 8) {
                    NavigationLink(value: ChatRoute(item.conversation)) {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .top) {
                                DirText(card.title, font: .system(size: 16, weight: .semibold))
                                BadgeView(text: cardStateLabel(part.state), tone: taskStateTone(part.state))
                            }
                            if let description = card.description, !description.isEmpty {
                                DirText(description, font: .system(size: 13), color: .neonInk.opacity(0.6))
                            }
                            HStack(spacing: 6) {
                                Image(systemName: "bubble.left")
                                Text(item.conversation.title)
                                if let due = formattedISODate(card.dueAt) {
                                    Text("·")
                                    Text(L("Due %@", due))
                                }
                            }
                            .font(.system(size: 12))
                            .foregroundStyle(Color.neonInk.opacity(0.5))
                        }
                    }
                    .buttonStyle(.plain)

                    if part.state != "SUBMITTED" && part.state != "DONE" {
                        Button {
                            Haptic.tap()
                            sendProof(part, card)
                        } label: {
                            Label(L("Send proof"), systemImage: "camera.fill")
                                .font(.system(size: 13, weight: .semibold))
                                .frame(maxWidth: .infinity)
                                .frame(height: 36)
                                .foregroundStyle(.white)
                                .background(Color.neonInk, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        .buttonStyle(.pressable)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .glassCard(radius: 16)
            }
        }
    }
}

// MARK: - Meetings

struct MeetingsView: View {
    @EnvironmentObject var api: APIClient
    @StateObject private var cards = ChatCardsLoader()
    @State private var web: WebPortalLink?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    // Only the manager sets meetings (lib/chat-meetings.ts).
                    if api.identity?.side == .admin {
                        WebTile(title: L("Set a meeting"), symbol: "calendar.badge.plus") {
                            web = WebPortalLink(path: "/admin/chat/team", title: L("Set a meeting"),
                                                hint: L("Press + in the chat and choose Meeting. For one person, open their chat instead."))
                        }
                    }

                    if let cachedAt = cards.cachedAt { OfflineBanner(savedAt: cachedAt) }

                    if !cards.loaded, let error = cards.errorMessage {
                        ErrorState(message: error) { await cards.load(api) }
                    } else if !cards.loaded {
                        SkeletonRows(count: 3)
                    } else {
                        SectionLabel(L("Coming up"))
                        if upcoming.isEmpty {
                            EmptyState(symbol: "calendar", title: L("No meetings coming up"),
                                       detail: L("Meetings set from a chat appear here."))
                                .glassCard(radius: 18)
                        } else {
                            ForEach(upcoming) { row($0) }
                        }

                        if !past.isEmpty {
                            SectionLabel(L("Earlier"))
                            ForEach(past) { row($0) }
                        }
                    }

                    Text(L("Meetings from the last 200 messages of each chat."))
                        .font(.system(size: 11))
                        .foregroundStyle(Color.neonInk.opacity(0.4))
                }
                .padding(16)
            }
            .refreshable { await cards.load(api) }
            .navigationTitle(L("Meetings"))
            .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountMenu() } }
            .navigationDestination(for: ChatRoute.self) { ChatRoomView(route: $0) }
            .neonAmbientBackground()
        }
        .task { await cards.load(api) }
        .fullScreenCover(item: $web) { WebPortalSheet(link: $0) }
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
            MeetingRow(
                meeting: meeting,
                conversation: item.conversation,
                viewer: api.identity,
                open: { path, title, hint in web = WebPortalLink(path: path, title: title, hint: hint) }
            )
        }
    }
}

private struct MeetingRow: View {
    let meeting: MeetingCard
    let conversation: ConversationSummary
    let viewer: Identity?
    let open: (String, String, String?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    DirText(meeting.title, font: .system(size: 17, weight: .semibold))
                    if let agenda = meeting.agenda, !agenda.isEmpty {
                        DirText(agenda, font: .system(size: 13), color: .neonInk.opacity(0.65))
                    }
                }
                if isLive {
                    BadgeView(text: L("Now"), tone: .pink)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                if let starts = formattedISODate(meeting.startsAt) {
                    Label(meeting.durationMinutes.map { L("%@ · %d min", starts, $0) } ?? starts, systemImage: "clock")
                }
                Label(
                    meeting.mode == "IN_PERSON" ? (meeting.place?.isEmpty == false ? meeting.place! : L("In person")) : L("Online"),
                    systemImage: meeting.mode == "IN_PERSON" ? "mappin.and.ellipse" : "video"
                )
                Label(conversation.title, systemImage: conversation.isGroup ? "person.3" : "bubble.left")
            }
            .font(.system(size: 12))
            .foregroundStyle(Color.neonInk.opacity(0.6))

            FlowRow {
                ForEach(meeting.attendees) { person in
                    HStack(spacing: 4) {
                        Image(systemName: person.rsvp == "ACCEPTED" ? "checkmark.circle.fill" : person.rsvp == "DECLINED" ? "xmark.circle" : "questionmark.circle")
                            .foregroundStyle(person.rsvp == "ACCEPTED" ? Color.green : Color.neonInk.opacity(0.4))
                        Text(person.name)
                    }
                    .font(.system(size: 12, weight: .medium))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.neonInk.opacity(0.05), in: Capsule())
                }
            }

            HStack(spacing: 8) {
                if meeting.mode != "IN_PERSON" && joinable {
                    actionButton(L("Join"), symbol: "video.fill", primary: true) {
                        open(chatPath, meeting.title, L("Press Join on the meeting card to enter the call."))
                    }
                }
                if myAnswer == "INVITED" && !isOver {
                    actionButton(L("Answer"), symbol: "hand.raised", primary: !joinable) {
                        open(chatPath, meeting.title, L("Answer on the meeting card: coming or not."))
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(radius: 16)
        .opacity(isOver ? 0.7 : 1)
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

    private var chatPath: String {
        guard let viewer else { return "/" }
        // The manager's chat page scrolls to `?meeting=`; the team's opens the chat.
        return viewer.webChatPath(conversation.slug, query: viewer.side == .admin ? "meeting=\(meeting.id)" : nil)
    }

    private func actionButton(_ title: String, symbol: String, primary: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.system(size: 13, weight: .semibold))
                .frame(maxWidth: .infinity)
                .frame(height: 36)
                .foregroundStyle(primary ? Color.white : Color.neonInk)
                .background(primary ? Color.neonInk : Color.white.opacity(0.8), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.neonInk.opacity(primary ? 0 : 0.12)))
        }
        .buttonStyle(.pressable)
    }
}
