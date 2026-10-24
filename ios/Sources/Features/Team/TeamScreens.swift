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
        "payroll-cutoffs-fixture", "payroll-cutoffs-fixture-off", "payroll-cutoff-add-fixture",
    ]

    /// `EmployeeDetailView`'s scroll anchors (`-neonScroll <anchor>`): profile,
    /// day-plan, sales, performance, warnings, access, playbook.
    /// `PayrollRootView`'s: totals, paysheet, attendance, receipts (the
    /// "Salaries" section was removed — see `ios/redesign/team.md` — so
    /// there is no anchor of that name any more), and cutoffs.
    ///
    /// `payroll-cutoffs-fixture` (this month, the rule on) and `-off` (last
    /// month, the rule off) draw the payroll screen from fixed answers
    /// (`TeamFixtures`), reading nothing — add `-neonScroll cutoffs` to land
    /// on the card. `payroll-cutoff-add-fixture` is the form over it.
    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "team-employees": return debugPushed(EmployeesRootView())
        case "team-employee":
            return debugPushed(DebugAsync(load: { try await firstEmployeeId() }) { id in
                EmployeeDetailView(employeeId: id)
            })
        case "team-payroll": return debugPushed(PayrollRootView())
        case "payroll-cutoffs-fixture":
            return debugPushed(PayrollRootView(preview: TeamFixtures.payroll(thisMonth: true), cutoffs: TeamFixtures.cutoffs(ruleOn: true)))
        case "payroll-cutoffs-fixture-off":
            return debugPushed(PayrollRootView(preview: TeamFixtures.payroll(thisMonth: false), cutoffs: TeamFixtures.cutoffs(ruleOn: false)))
        case "payroll-cutoff-add-fixture":
            let payroll = TeamFixtures.payroll(thisMonth: true)
            return AnyView(
                NavigationStack { PayrollRootView(preview: payroll, cutoffs: TeamFixtures.cutoffs(ruleOn: true)) }
                    .sheet(isPresented: .constant(true)) {
                        AddCutoffSheet(employees: payroll.employees,
                                       rates: Dictionary(uniqueKeysWithValues: payroll.rows.map { ($0.employee.id, $0.breakdown.hourlyRate) })) {}
                    }
            )
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

/// Fixed answers for the cutoffs screens, decoded from JSON as the server
/// would send them.
enum TeamFixtures {
    static func payroll(thisMonth: Bool) -> TeamPayrollResponse {
        let period = thisMonth ? "2026-10" : "2026-09"
        let json = """
        {"period":"\(period)","periodLabel":"","previousPeriod":"\(thisMonth ? "2026-09" : "2026-08")","thisMonth":"2026-10",
         "isThisMonth":\(thisMonth),
         "totals":{"cut":17.51,"receipts":2,"final":1584.49,"team":3},
         "rows":[
           {"employee":{"id":"fx-w","name":"Wael","role":"Designer","salaryAmount":650,"payBasis":"MONTHLY","photoUrl":null},
            "delayDays":1,"receiptCount":1,
            "breakdown":{"salary":650,"basis":"MONTHLY","workingDays":26,"hourlyRate":3.125,"delayHours":1,"cutoff":3.13,
                         "adjustmentTotal":9.38,"totalCut":12.51,"receiptTotal":2,"finalPay":639.49},
            "adjustments":[{"amount":3.13,"reason":"Not handed in by 11:59 PM: تصوير لوحة الموقع وإرسالها"},
                           {"amount":6.25,"reason":"Missed the client meeting"}]},
           {"employee":{"id":"fx-s","name":"Sally","role":"3D visualiser","salaryAmount":600,"payBasis":"MONTHLY","photoUrl":null},
            "delayDays":0,"receiptCount":0,
            "breakdown":{"salary":600,"basis":"MONTHLY","workingDays":26,"hourlyRate":2.885,"delayHours":0,"cutoff":0,
                         "adjustmentTotal":5,"totalCut":5,"receiptTotal":0,"finalPay":595},
            "adjustments":[{"amount":5,"reason":"ترك المكتب بدون إذن"}]},
           {"employee":{"id":"fx-a","name":"Amro","role":"Site engineer","salaryAmount":350,"payBasis":"MONTHLY","photoUrl":null},
            "delayDays":0,"receiptCount":0,
            "breakdown":{"salary":350,"basis":"MONTHLY","workingDays":26,"hourlyRate":1.683,"delayHours":0,"cutoff":0,
                         "adjustmentTotal":0,"totalCut":0,"receiptTotal":0,"finalPay":350},
            "adjustments":[]}
         ],
         "employees":[{"id":"fx-w","name":"Wael","deviceUserId":"3","photoUrl":null},
                      {"id":"fx-s","name":"Sally","deviceUserId":"4","photoUrl":null},
                      {"id":"fx-a","name":"Amro","deviceUserId":null,"photoUrl":null}],
         "attendance":[], "receipts":[]}
        """
        return try! JSONDecoder().decode(TeamPayrollResponse.self, from: Data(json.utf8))
    }

    /// Four cutoffs: an automatic one and two of the manager's still
    /// counting, and an automatic one taken back.
    static func cutoffs(ruleOn: Bool) -> TeamCutoffsResponse {
        let json = """
        {"period":"2026-10","periodLabel":"October 2026",
         "rule":{"on":\(ruleOn),"at":"23:59","warnAt":"22:59","hoursPerTask":1},
         "cutoffs":[
           {"id":"fx-c1","employeeId":"fx-w","employeeName":"Wael","day":"2026-10-21","kind":"TASK","hours":1,"amount":3.13,
            "reason":"Not handed in by 11:59 PM: تصوير لوحة الموقع وإرسالها","cancelledAt":null,"createdAt":"2026-10-21T20:59:00.000Z"},
           {"id":"fx-c2","employeeId":"fx-s","employeeName":"Sally","day":"2026-10-19","kind":"MANUAL","hours":null,"amount":5,
            "reason":"ترك المكتب بدون إذن","cancelledAt":null,"createdAt":"2026-10-19T12:00:00.000Z"},
           {"id":"fx-c3","employeeId":"fx-a","employeeName":"Amro","day":"2026-10-14","kind":"TASK","hours":1,"amount":1.68,
            "reason":"Not handed in by 11:59 PM: Site visit report","cancelledAt":"2026-10-15T09:00:00.000Z","createdAt":"2026-10-14T20:59:00.000Z"},
           {"id":"fx-c4","employeeId":"fx-w","employeeName":"Wael","day":"2026-10-08","kind":"MANUAL","hours":2,"amount":6.25,
            "reason":"Missed the client meeting","cancelledAt":null,"createdAt":"2026-10-08T15:00:00.000Z"}
         ]}
        """
        return try! JSONDecoder().decode(TeamCutoffsResponse.self, from: Data(json.utf8))
    }
}
#endif
