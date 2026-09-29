#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Add every screen and sheet of this area here, so each can be checked.
enum OpsScreens {
    static let ids: [String] = ["ops-attendance", "ops-attendance-person", "ops-requests", "ops-sitevisits", "ops-settings"]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "ops-attendance": return debugPushed(AttendanceRootView())
        case "ops-attendance-person":
            return debugPushed(DebugAsync(load: { () async throws -> (AttendanceMonth, AttendanceMonth.Row)? in
                let month = try await APIClient.shared.opsAttendanceMonth(month: nil).value
                guard let row = month.rows.first else { return nil }
                return (month, row)
            }) { pair in
                AttendancePersonDetail(row: pair.1, days: pair.0.days, monthKey: pair.0.monthKey, recordIds: pair.0.recordIds, onChanged: {})
            })
        case "ops-requests": return debugPushed(RequestsRootView())
        case "ops-sitevisits": return debugPushed(SiteVisitsRootView())
        case "ops-settings": return debugPushed(SettingsRootView())
        default: return nil
        }
    }
}
#endif
