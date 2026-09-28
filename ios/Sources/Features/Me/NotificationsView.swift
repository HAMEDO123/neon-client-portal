import SwiftUI

/// The employee's notifications — the same rows the portal shows, newest
/// first. The app has no push of its own yet, so this list (and the badge the
/// tab carries from `/me`) is where they arrive.
struct NotificationsView: View {
    var openChat: () -> Void = {}

    @EnvironmentObject var api: APIClient
    @EnvironmentObject var store: StaffStore
    @State private var items: [StaffNotification]?
    @State private var unread = 0
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var openTask: TaskRoute?
    @State private var openJob: JobRoute?
    @State private var chatRoute: ChatRoute?

    var body: some View {
        Group {
            ScrollView {
                VStack(spacing: 8) {
                    if let cachedAt { OfflineBanner(savedAt: cachedAt).padding(.bottom, 4) }

                    if let items {
                        if items.isEmpty {
                            EmptyState(symbol: "bell", title: L("No notifications"))
                        } else {
                            ForEach(items) { item in
                                Button { Task { await open(item) } } label: {
                                    NotificationRow(item: item)
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
                .padding(16)
            }
            .refreshable {
                Haptic.tap()
                await load()
            }
            .navigationTitle(L("Alerts"))
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if unread > 0 && cachedAt == nil {
                        Button(L("Mark all read")) { Task { await markAll() } }
                            .font(.system(size: 14, weight: .medium))
                    }
                }
            }
            .navigationDestination(isPresented: Binding(get: { openTask != nil }, set: { if !$0 { openTask = nil } })) {
                if let openTask { TaskDetailView(taskId: openTask.id) }
            }
            .navigationDestination(isPresented: Binding(get: { openJob != nil }, set: { if !$0 { openJob = nil } })) {
                if let openJob { JobDetailView(jobId: openJob.id) }
            }
            .navigationDestination(isPresented: Binding(get: { chatRoute != nil }, set: { if !$0 { chatRoute = nil } })) {
                if let chatRoute { ChatRoomView(route: chatRoute) }
            }
            .neonAmbientBackground()
        }
        .task(id: openTask == nil && openJob == nil && chatRoute == nil) {
            guard openTask == nil, openJob == nil, chatRoute == nil else { return }
            await load()
        }
    }

    private func load() async {
        do {
            let loaded = try await api.fetchNotifications()
            items = loaded.value.notifications
            unread = loaded.value.unread
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            if items == nil { errorMessage = error.localizedDescription }
        }
    }

    private func open(_ item: StaffNotification) async {
        Haptic.tap()
        if item.readAt == nil, cachedAt == nil {
            try? await api.markNotificationsRead(id: item.id)
            await load()
            await store.refresh()
        }

        // A board task's own id, when the row carries one, beats parsing the
        // url — it is the same TaskDetailView either way.
        if let entryId = item.entryId {
            openTask = TaskRoute(id: entryId)
            return
        }

        switch employeeLinkDestination(item.url) {
        case .task(let id):
            openTask = TaskRoute(id: id)
        case .job(let id):
            openJob = JobRoute(id: id)
        case .chat(let slug):
            await openConversation(slug: slug)
        case .none:
            // No id this screen can open on its own — a job handed out by
            // hand notifies with just "/employee/chat" when it has no
            // conversation to point at, and a plain CHAT_MESSAGE the same;
            // the Chat tab is the closest thing to open for either.
            if item.type == "CHAT_MESSAGE" || item.url?.contains("/chat") == true {
                openChat()
            }
        }
    }

    /// Resolves a chat slug ("team", "manager", a colleague's id) from a link
    /// against this person's own conversations, since `ChatRoute` needs more
    /// than the id a web url carries (its title, avatar, whether it's a group).
    private func openConversation(slug: String) async {
        do {
            let loaded = try await api.fetchConversations()
            if let match = loaded.value.conversations.first(where: { $0.slug == slug }) {
                chatRoute = ChatRoute(slug: match.slug, title: match.title, subtitle: match.subtitle, avatar: match.avatar, isGroup: match.isGroup)
                return
            }
        } catch {
            Toast.error(error)
            return
        }
        // Not in the list (a stale link, or a conversation that no longer
        // applies) — the Chat tab is still the honest fallback.
        openChat()
    }

    private func markAll() async {
        try? await api.markNotificationsRead(id: nil)
        Haptic.success()
        await load()
        await store.refresh()
    }
}

/// What a notification's `url` (an employee web path — see
/// `src/lib/notifications/types.ts` `taskUrl`, and `/employee/assigned/[id]`
/// for a job handed out by hand) means as a screen already in this app.
private enum EmployeeLinkDestination: Equatable {
    case task(id: String)
    case job(id: String)
    case chat(slug: String)
    case none
}

private func employeeLinkDestination(_ raw: String?) -> EmployeeLinkDestination {
    guard let raw, let components = URLComponents(string: raw) else { return .none }
    let parts = components.path.split(separator: "/").map(String.init)
    guard parts.first == "employee" else { return .none }
    let rest = Array(parts.dropFirst())
    switch rest.first {
    case "tasks" where rest.count >= 2: return .task(id: rest[1])
    case "assigned" where rest.count >= 2: return .job(id: rest[1])
    case "chat" where rest.count >= 2: return .chat(slug: rest[1])
    default: return .none
    }
}

private struct NotificationRow: View {
    let item: StaffNotification

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 34, height: 34)
                .background(tint.opacity(0.12), in: Circle())

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    DirText(item.title, font: .system(size: 15, weight: item.readAt == nil ? .semibold : .regular))
                    if item.readAt == nil {
                        Circle().fill(Color.neonPurpleStrong).frame(width: 8, height: 8)
                    }
                }
                DirText(item.message, font: .system(size: 13), color: .neonInk.opacity(0.6))
                if let time = formattedISODate(item.createdAt) {
                    Text(time)
                        .font(.system(size: 11))
                        .foregroundStyle(Color.neonInk.opacity(0.4))
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(radius: 16)
        .opacity(item.readAt == nil ? 1 : 0.8)
    }

    private var symbol: String {
        switch item.type {
        case "WARNING": return "exclamationmark.triangle.fill"
        case "CHAT_MESSAGE": return "bubble.left.fill"
        case "TASK_DEADLINE_REMINDER": return "alarm"
        case "TASK_TODAY_SCHEDULE", "TASK_TOMORROW_SCHEDULE": return "calendar"
        case "TASK_ASSIGNED": return "tray.and.arrow.down.fill"
        default: return item.type.hasPrefix("TASK") ? "checklist" : "bell.fill"
        }
    }

    private var tint: Color {
        switch item.type {
        case "WARNING": return .neonOrangeStrong
        case "CHAT_MESSAGE": return .neonPurpleStrong
        case "TASK_DEADLINE_REMINDER": return .neonPinkStrong
        default: return .neonCyanStrong
        }
    }
}
