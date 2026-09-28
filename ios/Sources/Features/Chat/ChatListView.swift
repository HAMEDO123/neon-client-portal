import SwiftUI

/// Every conversation the signed-in person is in — the team, their private
/// chat with the manager, and one per colleague (or, for the manager, one per
/// employee) — with the last message and the unread count, from the same
/// `conversationsFor` the web reads.
/// Chats or Tasks — the same two tabs the web chat's own side panel offers.
private enum ChatListMode: String, CaseIterable {
    case chats, tasks
    var label: String { self == .chats ? L("Chats") : L("Tasks") }
}

struct ChatListView: View {
    /// Told the total unread whenever the list is read, for the tab's badge.
    var onUnreadChange: (Int) -> Void = { _ in }

    @EnvironmentObject var api: APIClient
    @State private var mode: ChatListMode = .chats
    @State private var conversations: [ConversationSummary]?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var tasks: [ChatTaskListItem]?
    @State private var tasksCachedAt: Date?
    @State private var tasksError: String?
    @State private var path: [ChatRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(spacing: 8) {
                    Picker("", selection: $mode) {
                        ForEach(ChatListMode.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .padding(.bottom, 4)

                    switch mode {
                    case .chats: chatsList
                    case .tasks: tasksList
                    }
                }
                .padding(16)
            }
            .refreshable {
                Haptic.tap()
                switch mode {
                case .chats: await load()
                case .tasks: await loadTasks()
                }
            }
            .navigationTitle(L("Chat"))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { AccountMenu() }
            }
            .navigationDestination(for: ChatRoute.self) { route in
                ChatRoomView(route: route)
            }
            .neonAmbientBackground()
        }
        .task(id: path.isEmpty) {
            // Re-read whenever the list is what is on screen, so the counts a
            // conversation just cleared are gone when coming back to it.
            guard path.isEmpty else { return }
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 15 * 1_000_000_000)
            }
        }
        .task(id: "\(mode)\(path.isEmpty)") {
            guard path.isEmpty, mode == .tasks else { return }
            await loadTasks()
        }
    }

    @ViewBuilder
    private var chatsList: some View {
        if let cachedAt { OfflineBanner(savedAt: cachedAt).padding(.bottom, 4) }
        if let conversations {
            if conversations.isEmpty {
                EmptyState(symbol: "bubble.left.and.bubble.right", title: L("No conversations yet"))
            } else {
                ForEach(conversations) { conversation in
                    NavigationLink(value: ChatRoute(slug: conversation.slug, title: conversation.title, subtitle: conversation.subtitle, avatar: conversation.avatar, isGroup: conversation.isGroup)) {
                        ConversationRow(conversation: conversation)
                    }
                    .buttonStyle(.pressable)
                }
            }
        } else if let errorMessage {
            ErrorState(message: errorMessage) { await load() }
        } else {
            SkeletonRows(count: 5)
        }
    }

    @ViewBuilder
    private var tasksList: some View {
        if let tasksCachedAt { OfflineBanner(savedAt: tasksCachedAt).padding(.bottom, 4) }
        if let tasks {
            if tasks.isEmpty {
                EmptyState(symbol: "checklist", title: L("No tasks yet"))
            } else {
                ForEach(tasks) { item in
                    NavigationLink(value: ChatRoute(slug: item.conversationSlug, title: item.conversationTitle, subtitle: nil, avatar: nil, isGroup: item.isGroup)) {
                        ChatTaskListRow(item: item)
                    }
                    .buttonStyle(.pressable)
                }
            }
        } else if let tasksError {
            ErrorState(message: tasksError) { await loadTasks() }
        } else {
            SkeletonRows(count: 5)
        }
    }

    private func load() async {
        do {
            let loaded = try await api.fetchConversations()
            conversations = loaded.value.conversations
            cachedAt = loaded.cachedAt
            errorMessage = nil
            if loaded.cachedAt == nil {
                onUnreadChange(loaded.value.conversations.reduce(0) { $0 + $1.unread })
            }
        } catch {
            if conversations == nil { errorMessage = error.localizedDescription }
        }
    }

    private func loadTasks() async {
        do {
            let loaded = try await api.fetchChatTasks()
            tasks = loaded.value
            tasksCachedAt = loaded.cachedAt
            tasksError = nil
        } catch {
            if tasks == nil { tasksError = error.localizedDescription }
        }
    }
}

private struct ChatTaskListRow: View {
    let item: ChatTaskListItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                DirText(item.title, font: .system(size: 16, weight: .semibold))
                Spacer()
                BadgeView(text: cardStateLabel(item.overall), tone: taskStateTone(item.overall))
            }
            HStack(spacing: 6) {
                Image(systemName: item.isGroup ? "person.3" : "bubble.left")
                Text(item.conversationTitle)
                if let due = formattedISODate(item.dueAt) {
                    Text("·")
                    Text(L("Due %@", due))
                }
            }
            .font(.system(size: 12))
            .foregroundStyle(Color.neonInk.opacity(0.5))

            FlowRow {
                ForEach(item.assignments) { part in
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

struct ChatRoute: Hashable {
    let slug: String
    let title: String
    let subtitle: String?
    let avatar: String?
    let isGroup: Bool
}

private struct ConversationRow: View {
    let conversation: ConversationSummary

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(url: conversation.avatarURL, name: conversation.title, size: 48)

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(conversation.title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.neonInk)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if let time = shortTime(conversation.last?.createdAt) {
                        Text(time)
                            .font(.system(size: 12))
                            .foregroundStyle(conversation.unread > 0 ? Color.neonPurpleStrong : Color.neonInk.opacity(0.45))
                    }
                }
                HStack {
                    let preview = conversation.last?.preview(isGroup: conversation.isGroup)
                        ?? (conversation.subtitle ?? L("No messages yet"))
                    Text(verbatim: preview)
                        .font(.system(size: 14))
                        .foregroundStyle(Color.neonInk.opacity(0.55))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if conversation.unread > 0 {
                        Text("\(conversation.unread)")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 7)
                            .frame(minWidth: 22, minHeight: 22)
                            .background(Color.neonPurpleStrong, in: Capsule())
                    }
                }
            }
        }
        .padding(12)
        .glassCard(radius: 18)
    }
}
