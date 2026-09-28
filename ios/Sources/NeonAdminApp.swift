import SwiftUI

@main
struct NeonAdminApp: App {
    @StateObject private var api = APIClient.shared
    // Observed so the whole tree rebuilds (via .id) when the language toggles.
    @AppStorage(AppLanguage.storageKey) private var languageRaw = AppLanguage.current.rawValue

    init() {
        // Renders, avatars and chat photos are public files that never change
        // under the same URL, so a generous cache makes scrolling back free.
        URLCache.shared = URLCache(memoryCapacity: 64 * 1024 * 1024, diskCapacity: 512 * 1024 * 1024)
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if api.isLoggedIn {
                    // One app, two sides: the server's `side` at sign-in decides.
                    if api.side == .employee {
                        EmployeeHome()
                    } else {
                        AdminHome()
                    }
                } else {
                    LoginView()
                }
            }
            .environmentObject(api)
            .tint(.neonPurpleStrong)
            .preferredColorScheme(.light)
            .environment(\.layoutDirection, AppLanguage.current.layoutDirection)
            .environment(\.locale, AppLanguage.current.locale)
            .id(languageRaw)
        }
    }
}

// MARK: - The team

enum EmployeeTab: Hashable {
    case today, tasks, chat, alerts
}

struct EmployeeHome: View {
    @EnvironmentObject var api: APIClient
    @StateObject private var store = StaffStore()
    @State private var tab: EmployeeTab = .today
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView(selection: $tab) {
            TodayView()
                .tabItem { Label(L("Today"), systemImage: "sun.max") }
                .tag(EmployeeTab.today)

            TasksView()
                .tabItem { Label(L("Tasks"), systemImage: "checklist") }
                .tag(EmployeeTab.tasks)

            // The list's own total moving means /me's badge is stale.
            ChatListView(onUnreadChange: { total in
                if total != store.badges.unreadChat { Task { await store.refresh() } }
            })
                .tabItem { Label(L("Chat"), systemImage: "bubble.left.and.bubble.right") }
                .badge(store.badges.unreadChat)
                .tag(EmployeeTab.chat)

            NotificationsView(openChat: { tab = .chat })
                .tabItem { Label(L("Alerts"), systemImage: "bell") }
                .badge(store.badges.unread)
                .tag(EmployeeTab.alerts)
        }
        .environmentObject(store)
        .task { await store.poll() }
        .onChange(of: scenePhase) { phase in
            if phase == .active { Task { await store.refresh() } }
        }
    }
}

// MARK: - The manager

enum AdminTab: Hashable {
    case projects, chat
}

struct AdminHome: View {
    @EnvironmentObject var api: APIClient
    @State private var tab: AdminTab = .projects
    @State private var unreadChat = 0
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView(selection: $tab) {
            DashboardView()
                .tabItem { Label(L("Projects"), systemImage: "square.grid.2x2") }
                .tag(AdminTab.projects)

            ChatListView(onUnreadChange: { unreadChat = $0 })
                .tabItem { Label(L("Chat"), systemImage: "bubble.left.and.bubble.right") }
                .badge(unreadChat)
                .tag(AdminTab.chat)
        }
        .task { await pollUnread() }
        .onChange(of: scenePhase) { phase in
            if phase == .active { Task { await refreshUnread() } }
        }
    }

    /// The manager's `/me` carries no badges, so the chat count is the sum of
    /// the conversation list's own unread numbers — the same ones the web shows.
    private func refreshUnread() async {
        guard let loaded = try? await api.fetchConversations(), loaded.cachedAt == nil else { return }
        unreadChat = loaded.value.conversations.reduce(0) { $0 + $1.unread }
    }

    private func pollUnread() async {
        while !Task.isCancelled {
            await refreshUnread()
            try? await Task.sleep(nanoseconds: 30 * 1_000_000_000)
        }
    }
}
