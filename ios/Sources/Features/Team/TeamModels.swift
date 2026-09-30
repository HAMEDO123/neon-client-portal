import Foundation

// What "team/…" reads answer, decoding exactly what src/lib/mobile/registry/team.ts
// returns — the same shape the employees, employee detail and payroll pages read.
// Every date arrives as an ISO string (see Core/Formatting.swift); `null` becomes
// an optional.

// MARK: - Employees list (team/employees)

struct TeamEmployeesResponse: Decodable {
    let warningLimit: Int
    let employees: [TeamEmployeeSummary]
}

struct TeamEmployeeSummary: Decodable, Identifiable {
    let id: String
    let name: String
    let role: String?
    let email: String?
    let phone: String?
    let employeeCode: String?
    let active: Bool
    /// "MANAGER" for the manager's own row (there to pair the attendance
    /// device); nil from a server older than this field.
    let accessRole: String?
    let lastLoginAt: String?
    let monthlySalesTarget: Int
    let taskCount: Int
    let deviceCount: Int
    let warningCount: Int
    let sold: Int

    /// Someone on the board with no login at all — not the same as disabled.
    var hasAccount: Bool { email != nil }
    /// The manager's own row: listed, but not counted as the team.
    var isManager: Bool { accessRole == "MANAGER" }
}

// MARK: - One employee (team/employee)

struct TeamEmployeeResponse: Decodable {
    let warningLimit: Int
    let employee: TeamEmployeeDetail
    let warnings: [TeamWarning]
    let colleagues: [TeamColleague]
    let today: String
    let tomorrow: String
    let tomorrowLabel: String
    let aiConfigured: Bool
    let plans: TeamDayPlans
    let sales: TeamSales
    let performance: TeamPerformance
    let performanceDays: Int
}

struct TeamEmployeeDetail: Decodable {
    let id: String
    let name: String
    let email: String?
    let role: String?
    let phone: String?
    let employeeCode: String?
    let active: Bool
    let createdAt: String
    let lastLoginAt: String?
    let monthlySalesTarget: Int
    let canReadWhatsApp: Bool
    let canAssignTasks: Bool
    let canLogSiteVisits: Bool
    let playbook: String?
    let skills: String?
    let examples: String?
    let dailyCapacityMinutes: Int?
    let reviewerId: String?
    let deviceCount: Int
    let notificationCount: Int
}

struct TeamWarning: Decodable, Identifiable {
    let id: String
    let reason: String
    let createdAt: String
}

struct TeamColleague: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
}

struct TeamDayPlans: Decodable {
    let today: TeamDayPlan?
    let tomorrow: TeamDayPlan?
}

struct TeamDayPlan: Decodable {
    var blocks: [TeamPlanBlock]
    let notes: [String]
    let appliedAt: String?
    let updatedAt: String
}

struct TeamPlanBlock: Decodable, Equatable, Identifiable {
    var from: String
    var to: String
    let ref: String?
    let what: String
    let why: String?
    let entryId: String?
    let taskName: String?
    let projectName: String?
    var keep: Bool
    let jobId: String?

    var id: String { "\(from)-\(what)" }
}

struct TeamSales: Decodable {
    let projects: [TeamSoldProject]
    let target: Int
    let period: String
}

struct TeamSoldProject: Decodable, Identifiable {
    let id: String
    let name: String
    let clientName: String
    let soldOn: String?
}

/// Mirrors lib/performance.ts's `Indicator`: a figure refused rather than
/// guessed below a sample size, with the reason to show instead.
struct TeamIndicator: Decodable {
    let value: Double?
    let sample: Int
    let why: String?
}

struct TeamPerformance: Decodable {
    let onTime: TeamIndicator
    let acceptedFirstTime: TeamIndicator
    let rework: TeamIndicator
    let blockedWaiting: TeamIndicator
    let estimates: TeamIndicator
}

/// What the server answers from `planEmployeeDay` / `proposeDay`.
struct TeamDayPlanResult: Decodable {
    let ok: Bool
    let person: String?
    let dayLabel: String?
    let plan: TeamDayPlan?
    let error: String?
}

struct TeamOkResult: Decodable {
    let ok: Bool
    let error: String?
}

struct TeamApplyResult: Decodable {
    let ok: Bool
    let error: String?
    let moved: Int?
    let jobs: Int?
}

// MARK: - Payroll (team/payroll)

struct TeamPayrollResponse: Decodable {
    let period: String
    let periodLabel: String
    let previousPeriod: String
    let thisMonth: String
    let isThisMonth: Bool
    let totals: TeamPayrollTotals
    let rows: [TeamPayrollRow]
    let employees: [TeamPayrollEmployee]
    let attendance: [TeamAttendanceRecord]
    let receipts: [TeamReceipt]
}

struct TeamPayrollTotals: Decodable {
    let cut: Double
    let receipts: Double
    let final: Double
    let team: Int
}

struct TeamPayrollRow: Decodable, Identifiable {
    let employee: TeamPayrollEmployeeInfo
    let delayDays: Int
    let breakdown: TeamPayrollBreakdown
    let receiptCount: Int
    let adjustments: [TeamAdjustment]

    var id: String { employee.id }
}

struct TeamPayrollEmployeeInfo: Decodable, Identifiable {
    let id: String
    let name: String
    let role: String?
    let salaryAmount: Double?
    let payBasis: String
}

struct TeamPayrollBreakdown: Decodable {
    let salary: Double
    let basis: String
    let workingDays: Double
    let hourlyRate: Double
    let delayHours: Double
    let cutoff: Double
    let adjustmentTotal: Double
    let totalCut: Double
    let receiptTotal: Double
    let finalPay: Double
}

struct TeamAdjustment: Decodable {
    let amount: Double
    let reason: String
}

struct TeamPayrollEmployee: Decodable, Identifiable {
    let id: String
    let name: String
    let deviceUserId: String?
}

struct TeamAttendanceRecord: Decodable, Identifiable {
    let id: String
    let day: String
    let employeeId: String
    let employeeName: String
    let delayHours: Double
    let note: String?
}

struct TeamReceipt: Decodable, Identifiable {
    let id: String
    let employeeId: String
    let employeeName: String
    let imageUrl: String
    let summary: String?
    let aiNotes: String?
    let vendor: String?
    let rawAmount: Double?
    let countedAmount: Double?
}

// MARK: - Shared formatting for this area

/// `data.periodLabel`/`sales.period` arrive as the server's own en-US
/// `Intl.DateTimeFormat` text, so an Arabic reader would see "September 2026"
/// in English regardless of the in-app language. Both screens instead format
/// the raw "YYYY-MM" key on the device, in the app's own language.
func teamMonthYearLabel(_ period: String) -> String {
    let parts = period.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2 else { return period }
    var components = DateComponents()
    components.year = parts[0]
    components.month = parts[1]
    components.day = 1
    guard let date = Calendar(identifier: .gregorian).date(from: components) else { return period }
    let formatter = DateFormatter()
    formatter.locale = AppLanguage.current.locale
    formatter.dateFormat = "MMMM yyyy"
    return formatter.string(from: date)
}

/// The app has no stringsdict pipeline (`L()` only reads `.strings` tables,
/// and returns the English key untouched rather than consulting one — see
/// `Core/Localization.swift`), so a true Arabic zero/one/two/few/many/other
/// plural needs a change there, outside this area's files. This picks
/// between a singular and a plural *key*, each translated in
/// `Team.strings` — enough to stop "2 device" and "400 notification sent" in
/// English, and a step better than one fixed Arabic string for every count.
func teamPlural(_ n: Int, one: String, other: String) -> String {
    L(n == 1 ? one : other, n)
}
