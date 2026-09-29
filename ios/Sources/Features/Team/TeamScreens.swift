#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Add every screen and sheet of this area here, so each can be checked.
enum TeamScreens {
    static let ids: [String] = [
        "team-employees", "team-employee", "team-payroll",
        "team-employee-create", "team-employee-edit", "team-employee-password",
        "team-payroll-pay", "team-payroll-attendance", "team-payroll-receipt",
    ]

    /// `EmployeeDetailView`'s scroll anchors (`-neonScroll <anchor>`): profile,
    /// day-plan, sales, performance, warnings, access.
    /// `PayrollRootView`'s: totals, paysheet, salaries, attendance, receipts.
    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "team-employees": return debugPushed(EmployeesRootView())
        case "team-employee":
            return debugPushed(DebugAsync(load: { try await firstEmployeeId() }) { id in
                EmployeeDetailView(employeeId: id)
            })
        case "team-payroll": return debugPushed(PayrollRootView())
        case "team-employee-create": return debugPushed(CreateEmployeeSheet(onCreated: {}))
        case "team-employee-edit":
            return debugPushed(DebugAsync(load: { try await firstEmployeeId() }) { id in
                DebugAsync(load: { try await APIClient.shared.read("team/employee", ["id": id], as: TeamEmployeeResponse.self).value }) { data in
                    EditEmployeeSheet(employeeId: id, employee: data.employee, colleagues: data.colleagues, onSaved: {})
                }
            })
        case "team-employee-password":
            return debugPushed(DebugAsync(load: { try await firstEmployeeId() }) { id in
                ResetPasswordSheet(employeeId: id)
            })
        case "team-payroll-pay":
            return debugPushed(DebugAsync(load: { try await APIClient.shared.read("team/payroll", ["period": nil], as: TeamPayrollResponse.self).value.rows.first?.employee }) { info in
                EditPaySheet(employee: info, onSaved: {})
            })
        case "team-payroll-attendance":
            return debugPushed(DebugAsync(load: { try await APIClient.shared.read("team/payroll", ["period": nil], as: TeamPayrollResponse.self).value.employees }) { employees in
                RecordAttendanceSheet(employees: employees, onSaved: {})
            })
        case "team-payroll-receipt":
            return debugPushed(DebugAsync(load: { try await APIClient.shared.read("team/payroll", ["period": nil], as: TeamPayrollResponse.self).value.receipts.first }) { receipt in
                CorrectReceiptSheet(receipt: receipt, onSaved: {})
            })
        default: return nil
        }
    }

    private static func firstEmployeeId() async throws -> String? {
        try await APIClient.shared.read("team/employees", as: TeamEmployeesResponse.self).value.employees.first?.id
    }
}
#endif
