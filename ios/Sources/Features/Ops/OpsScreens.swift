#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Add every screen and sheet of this area here, so each can be checked.
enum OpsScreens {
    static let ids: [String] = ["ops-attendance", "ops-requests", "ops-sitevisits", "ops-settings"]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "ops-attendance": return debugPushed(AttendanceRootView())
        case "ops-requests": return debugPushed(RequestsRootView())
        case "ops-sitevisits": return debugPushed(SiteVisitsRootView())
        case "ops-settings": return debugPushed(SettingsRootView())
        default: return nil
        }
    }
}
#endif
