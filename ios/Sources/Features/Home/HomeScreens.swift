#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Add every screen and sheet of this area here, so each can be checked.
enum HomeScreens {
    static let ids: [String] = ["home-alerts", "home-reviews", "home-analytics"]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "home-alerts": return debugPushed(AlertsRootView())
        case "home-reviews": return debugPushed(ReviewsRootView())
        case "home-analytics": return debugPushed(AnalyticsRootView())
        default: return nil
        }
    }
}
#endif
