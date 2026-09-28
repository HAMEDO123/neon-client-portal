import Foundation

// The rest of the team's own side, in the shapes registry/me.ts answers:
// jobs handed out by hand, the requests tab, the profile tab and the Assign
// view. See StaffModels.swift for /today, /tasks and /notifications, which
// are the app's original (pre-registry) routes.

// MARK: - Jobs handed out by hand (AssignedTask)

/// `AssignedTaskView` in src/lib/assigned-tasks.ts.
struct MyAssignedJob: Decodable, Identifiable {
    let id: String
    let employeeId: String
    let title: String
    let note: String?
    let deliverable: String?
    let acceptance: String?
    let startKey: String
    let endKey: String
    let state: String
    let priority: String
}

struct AssignedJobsResponse: Decodable { let jobs: [MyAssignedJob] }

/// What has been sent for a job so far — `TaskSubmission` rows.
struct JobSubmission: Decodable, Identifiable {
    let id: String
    let imageUrl: String
    let status: String
    let reviewNote: String?
    let createdAt: String
}

struct JobDetailResponse: Decodable {
    let job: MyAssignedJob
    let submissions: [JobSubmission]
}

// MARK: - What the day asked (ScheduledFollowUp)

/// The one open question a board task owes right now — `openFollowUpForTask`
/// in src/lib/follow-up-queue.ts. `nil` when there is nothing to answer.
struct FollowUpQuestion: Decodable, Identifiable {
    let id: String
    let kind: String
    let dueAt: String
}

struct FollowUpAnswerResult: Decodable {
    let ok: Bool
    let error: String?
}

// MARK: - Requests tab

struct SupplyRequestRow: Decodable, Identifiable {
    let id: String
    let item: String
    let quantity: String?
    let note: String?
    let estimatedCost: Double?
    let urgent: Bool
    let status: String
    let decisionNote: String?
    let createdAt: String
}

struct ReceiptRow: Decodable, Identifiable {
    let id: String
    let imageUrl: String
    let status: String
    let vendor: String?
    let receiptDate: String?
    let rawAmount: Double?
    let countedAmount: Double?
    let currency: String
    let summary: String?
    let aiNotes: String?
    let createdAt: String
}

struct DailyReportValue: Decodable {
    let text: String
    let updatedAt: String
}

struct RequestsResponse: Decodable {
    let supplyRequests: [SupplyRequestRow]
    let receipts: [ReceiptRow]
    let receiptCap: Double
    let period: String
    let periodLabel: String
    let report: DailyReportValue?
}

// MARK: - Profile tab

struct ProfilePreferences: Decodable {
    var pushEnabled: Bool
    var chatMessages: Bool
    var taskAssigned: Bool
    var taskUpdated: Bool
    var todaySchedule: Bool
    var tomorrowSchedule: Bool
    var deadlineReminders: Bool
    var deadlineLeadMinutes: Int
}

struct ProfileDevice: Decodable, Identifiable {
    let id: String
    let label: String
    let active: Bool
    let lastUsedAt: String?
    let addedAt: String
}

struct ProfileEmployee: Decodable {
    let id: String
    let name: String
    let role: String?
    let email: String?
    let phone: String?
    let employeeCode: String?
}

struct ProfileResponse: Decodable {
    let employee: ProfileEmployee
    let preferences: ProfilePreferences
    let devices: [ProfileDevice]
    let timezone: String
}

// MARK: - Assign

struct AssignTeamMember: Decodable, Identifiable {
    let id: String
    let name: String
    let color: String?
    let role: String?
}

struct AssignTeamResponse: Decodable { let team: [AssignTeamMember] }

struct AssignWeekResponse: Decodable {
    let weekStart: String
    let weekLabel: String
    let todayKey: String
    let tasks: [MyAssignedJob]
}
