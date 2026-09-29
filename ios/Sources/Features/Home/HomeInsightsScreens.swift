#if DEBUG
import SwiftUI

/// Alerts, Reviews and Analytics for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Add every screen and sheet of these three here, so each can be checked.
enum HomeInsightsScreens {
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
