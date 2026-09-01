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
                    DashboardView()
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
