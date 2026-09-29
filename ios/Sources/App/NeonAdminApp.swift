import SwiftUI

@main
struct NeonAdminApp: App {
    @UIApplicationDelegateAdaptor(NeonAppDelegate.self) private var appDelegate
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
            ZStack {
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
            // A ringing or running call sits above every screen.
            .overlay { if api.isLoggedIn { CallOverlay() } }
            // Signed in: ask for notifications (once — iOS remembers the answer)
            // and register this phone for the person's pushes.
            .task(id: api.isLoggedIn) { if api.isLoggedIn { PushCenter.shared.start() } }
            #if DEBUG
            .task { if DecodeCheck.requested, api.isLoggedIn { await DecodeCheck.run(api) } }
            #endif
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
    case today, tasks, chat, projects, more
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

            ProjectsRootView()
                .tabItem { Label(L("Projects"), systemImage: "square.grid.2x2") }
                .tag(EmployeeTab.projects)

            EmployeeMoreView(openChat: { tab = .chat })
                .tabItem { Label(L("More"), systemImage: "ellipsis.circle") }
                .badge(store.badges.unread)
                .tag(EmployeeTab.more)
        }
        .environmentObject(store)
        .task { await store.poll() }
        // A tapped notification: its tab, and the chat list opens the
        // conversation itself.
        .onReceive(PushCenter.shared.$pendingPath) { webPath in
            guard let webPath else { return }
            tab = PushRoute.employeeTab(webPath)
            if tab != .chat { PushCenter.shared.pendingPath = nil }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active { Task { await store.refresh() } }
        }
    }
}

// MARK: - The manager

enum AdminTab: Hashable {
    case home, projects, tasks, chat, more
}

struct AdminHome: View {
    @EnvironmentObject var api: APIClient
    @State private var tab: AdminTab = .home
    @State private var unreadChat = 0
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView(selection: $tab) {
            AdminHomeView()
                .tabItem { Label(L("Home"), systemImage: "house") }
                .tag(AdminTab.home)

            ProjectsRootView()
                .tabItem { Label(L("Projects"), systemImage: "square.grid.2x2") }
                .tag(AdminTab.projects)

            TasksRootView()
                .tabItem { Label(L("Tasks"), systemImage: "checklist") }
                .tag(AdminTab.tasks)

            ChatListView(onUnreadChange: { unreadChat = $0 })
                .tabItem { Label(L("Chat"), systemImage: "bubble.left.and.bubble.right") }
                .badge(unreadChat)
                .tag(AdminTab.chat)

            AdminMoreView()
                .tabItem { Label(L("More"), systemImage: "ellipsis.circle") }
                .tag(AdminTab.more)
        }
        .task { await pollUnread() }
        .onReceive(PushCenter.shared.$pendingPath) { webPath in
            guard let webPath else { return }
            tab = PushRoute.adminTab(webPath)
            if tab != .chat { PushCenter.shared.pendingPath = nil }
        }
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
