#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Add every screen and sheet of this area here, so each can be checked.
enum TeamScreens {
    static let ids: [String] = ["team-employees", "team-employee", "team-payroll"]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "team-employees": return debugPushed(EmployeesRootView())
        case "team-employee":
            return debugPushed(DebugAsync(load: { try await APIClient.shared.read("team/employees", as: TeamEmployeesResponse.self).value.employees.first?.id }) { id in
                EmployeeDetailView(employeeId: id)
            })
        case "team-payroll": return debugPushed(PayrollRootView())
        default: return nil
        }
    }
}
#endif
