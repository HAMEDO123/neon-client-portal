import SwiftUI

@main
struct NeonAdminApp: App {
    var body: some Scene {
        WindowGroup {
            WebView()
                .ignoresSafeArea()
                .preferredColorScheme(.light)
        }
    }
}
