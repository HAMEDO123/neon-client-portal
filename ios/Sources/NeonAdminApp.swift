import SwiftUI

@main
struct NeonAdminApp: App {
    @StateObject private var api = APIClient.shared
    // Observed so the whole tree rebuilds (via .id) when the language toggles.
    @AppStorage(AppLanguage.storageKey) private var languageRaw = AppLanguage.current.rawValue

    var body: some Scene {
        WindowGroup {
            Group {
                if api.isLoggedIn {
                    RootTabs()
                } else {
                    LoginView()
                }
            }
            .environmentObject(api)
            .preferredColorScheme(.light)
            .environment(\.layoutDirection, AppLanguage.current.layoutDirection)
            .environment(\.locale, AppLanguage.current.locale)
            .id(languageRaw)
        }
    }
}

/// The app's two halves for now: the projects it has always had, and the chat
/// the team actually opens a phone for. More tabs follow — the day's work,
/// meetings, calls — and they belong here rather than buried inside one of
/// these, which is how the app ended up being only a project tool.
struct RootTabs: View {
    @EnvironmentObject private var api: APIClient

    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label(L("Projects"), systemImage: "folder") }

            ChatListView()
                .tabItem { Label(L("Chats"), systemImage: "bubble.left.and.bubble.right") }
        }
        .tint(Color.neonPurple)
        // Asked on every launch, not just after signing in: a stored token says
        // nothing about whether the account still exists or is still enabled,
        // and which kind of person holds it decides what these tabs show.
        .task { await api.refreshActor() }
    }
}
