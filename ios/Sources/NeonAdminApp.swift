import SwiftUI

@main
struct NeonAdminApp: App {
    @StateObject private var api = APIClient.shared

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
        }
    }
}
