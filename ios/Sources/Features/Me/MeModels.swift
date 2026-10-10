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
    /// From `me/tasks/mine`: its last day has gone and it is not approved.
    var late: Bool? = nil
}

struct AssignedJobsResponse: Decodable { let jobs: [MyAssignedJob] }

/// `me/tasks/mine`: everything on this person's list, read once — the
/// board's steps and the jobs handed out by hand — as `/employee/tasks` reads
/// it before narrowing anything. The buttons count it and narrow it here.
struct MyTasksResponse: Decodable {
    /// Today in the studio's calendar.
    let todayKey: String
    let tasks: [StaffTask]
    let jobs: [MyAssignedJob]
}

/// One question already asked about a task — `questionsAbout`.
struct AskedQuestion: Decodable, Identifiable {
    let id: String
    /// "manager" or "team".
    let `where`: String
    let text: String
    let at: String
}

struct AskedQuestionsResponse: Decodable { let asked: [AskedQuestion] }

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
    /// The job came from a task card in a chat, where it is discussed under
    /// its own card. Absent from a server before questions about a task.
    var fromChat: Bool? = nil
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
    let lines: [SupplyLine]?
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
    /// Their own face, or nil — `AvatarView` then draws initials, as it always did.
    let photoUrl: String?
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
    /// Their face, or nil for initials.
    let photoUrl: String?
}

struct AssignTeamResponse: Decodable { let team: [AssignTeamMember] }

struct AssignWeekResponse: Decodable {
    let weekStart: String
    let weekLabel: String
    let todayKey: String
    let tasks: [MyAssignedJob]
}
