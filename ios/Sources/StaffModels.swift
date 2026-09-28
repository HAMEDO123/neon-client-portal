import Foundation

// The employee's side of the mobile API, in the shapes the live server
// answers (src/app/api/mobile/{me,today,tasks,notifications}). Anything the
// server may leave out or send as null is optional here, so one missing field
// costs that field rather than the whole screen.

// MARK: - /me

struct Me: Decodable {
    let side: Side
    let id: String?
    let name: String
    let badges: Badges?
    /// Pinned until the manager withdraws them — never dismissible in the app.
    let warnings: [StaffWarning]?
}

struct Badges: Decodable, Equatable {
    let unread: Int
    let unreadChat: Int
}

struct StaffWarning: Decodable, Identifiable {
    let id: String
    let reason: String
    let createdAt: String
}

/// `WARNING_LIMIT` in src/lib/warnings.ts: the one after the last closes the account.
let warningLimit = 3

// MARK: - /today

struct TodayResponse: Decodable {
    let dayKey: String
    let nowNext: NowNext
    let hours: WorkHours
    let tasks: [StaffTask]
    let tomorrow: [StaffTask]
}

struct NowNext: Decodable {
    let now: PlanSlot?
    let next: PlanSlot?
    let leftOfBlock: Double?
    let untilNext: Double?
    let leftOfDay: Double
    let onBreak: Bool
    let beforeWork: Bool
    let afterWork: Bool
}

struct PlanSlot: Decodable {
    let from: String
    let to: String
    let what: String
    let entryId: String?
    let jobId: String?
}

struct WorkHours: Decodable {
    let days: [Int]?
    let start: String
    let end: String
    let lunchMinutes: Double?
    let lunchAt: String?
}

// MARK: - /tasks

enum TaskFilter: String, CaseIterable, Identifiable {
    case open, completed, all
    var id: String { rawValue }
    var label: String {
        switch self {
        case .open: return L("Open")
        case .completed: return L("Completed")
        case .all: return L("All")
        }
    }
}

struct TasksResponse: Decodable {
    let tasks: [StaffTask]
}

/// One cell of the project board that belongs to this person.
struct StaffTask: Decodable, Identifiable {
    let id: String
    let state: String
    let priority: String?
    let scheduledFor: String?
    let dueAt: String?
    let adminNote: String?
    let employeeNote: String?
    let completedAt: String?
    let startedAt: String?
    let updatedAt: String?
    let deliverable: String?
    let acceptance: String?
    let estimateHours: Double?
    let blockedReason: String?
    let lastUpdateNote: String?
    let lastUpdateAt: String?
    let nextStep: String?
    let blockedBy: Person?
    let waitsFor: [Dependency]?
    let task: Step
    let project: ProjectRef

    struct Person: Decodable { let id: String; let name: String }

    struct Dependency: Decodable {
        let dependsOn: DependsOn
        struct DependsOn: Decodable {
            let id: String
            let state: String
            let task: Named
        }
    }

    struct Named: Decodable { let name: String }

    /// The step of the shared delivery process, with its own standard.
    struct Step: Decodable {
        let id: String
        let name: String
        let deliverable: String?
        let acceptance: String?
        let evidence: String?
        let checklist: String?
    }

    struct ProjectRef: Decodable {
        let id: String
        let name: String
        let clientName: String?
        let location: String?
    }

    // `effectiveDetail` in src/lib/task-types.ts: the cell wins where it has
    // words of its own, and the step fills the rest.
    var effectiveDeliverable: String? { written(deliverable) ?? written(task.deliverable) }
    var effectiveAcceptance: String? { written(acceptance) ?? written(task.acceptance) }
    var acceptanceIsFromStep: Bool { written(acceptance) == nil && written(task.acceptance) != nil }
    var effectiveEstimate: Double? { (estimateHours ?? 0) > 0 ? estimateHours : nil }

    /// The work this one waits for that is not approved yet.
    var waitingOn: [Dependency.DependsOn] {
        (waitsFor ?? []).map(\.dependsOn).filter { $0.state != "DONE" }
    }
}

private func written(_ text: String?) -> String? {
    guard let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
    return trimmed
}

/// `linesOf` in src/lib/task-types.ts — the one reading of "a list the manager
/// typed", so the app counts the same items the server checks a photo against.
func linesOf(_ text: String?, max: Int = 12) -> [String] {
    guard let text else { return [] }
    let bullet = try? NSRegularExpression(pattern: "^[-*•\\d.)\\s]+")
    return text
        .components(separatedBy: CharacterSet(charactersIn: "\n\r·;"))
        .map { line -> String in
            let range = NSRange(line.startIndex..., in: line)
            let stripped = bullet?.stringByReplacingMatches(in: line, range: range, withTemplate: "") ?? line
            return stripped.trimmingCharacters(in: .whitespaces)
        }
        .filter { $0.count > 1 }
        .prefix(max)
        .map { $0 }
}

// MARK: - /notifications

struct NotificationsResponse: Decodable {
    let unread: Int
    let notifications: [StaffNotification]
}

struct StaffNotification: Decodable, Identifiable {
    let id: String
    let type: String
    let title: String
    let message: String
    let url: String?
    let entryId: String?
    let readAt: String?
    let createdAt: String
}

// MARK: - Task states, as the studio names them

/// `EMPLOYEE_STATE_LABEL` in src/lib/task-board.ts.
func taskStateLabel(_ state: String) -> String {
    switch state {
    case "TODO": return L("Pending")
    case "IN_PROGRESS": return L("In progress")
    case "SUBMITTED": return L("Sent for review")
    case "DONE": return L("Completed")
    case "TOMORROW": return L("Planned for tomorrow")
    default: return state.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

func taskStateTone(_ state: String) -> BadgeTone {
    switch state {
    case "IN_PROGRESS": return .cyan
    case "SUBMITTED": return .purple
    case "DONE": return .success
    case "TOMORROW": return .orange
    default: return .neutral
    }
}

func priorityLabel(_ priority: String?) -> String? {
    switch priority {
    case "HIGH": return L("High priority")
    case "LOW": return L("Low priority")
    default: return nil
    }
}

// MARK: - Dates from the server

private let isoWithFraction: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

private let isoPlain = ISO8601DateFormatter()

func parseISODate(_ iso: String?) -> Date? {
    guard let iso else { return nil }
    return isoWithFraction.date(from: iso) ?? isoPlain.date(from: iso)
}

/// A `@db.Date` column arrives as UTC midnight of the studio's day, so it is
/// read and shown in UTC — in Amman's evening it would otherwise slip a day.
func formattedDay(_ iso: String?) -> String? {
    guard let date = parseISODate(iso) else { return nil }
    var style = Date.FormatStyle(date: .abbreviated, time: .omitted, locale: AppLanguage.current.locale)
    style.timeZone = TimeZone(identifier: "UTC")!
    return date.formatted(style)
}

/// "YYYY-MM-DD", the studio's day key.
func formattedDayKey(_ key: String) -> String {
    formattedDay("\(key)T00:00:00.000Z") ?? key
}

/// Minutes as the web says them: "45m", "2h", "2h 15m".
func describeMinutes(_ minutes: Double) -> String {
    let total = Int(minutes.rounded())
    if total <= 0 { return L("no time left") }
    let hours = total / 60
    let rest = total % 60
    if hours == 0 { return L("%dm", rest) }
    return rest == 0 ? L("%dh", hours) : L("%dh %dm", hours, rest)
}

/// Relative for recent moments, a date after that — for lists.
func shortTime(_ iso: String?) -> String? {
    guard let date = parseISODate(iso) else { return nil }
    let locale = AppLanguage.current.locale
    if Calendar.current.isDateInToday(date) {
        return date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: locale))
    }
    if Calendar.current.isDateInYesterday(date) { return L("Yesterday") }
    return date.formatted(Date.FormatStyle(date: .numeric, time: .omitted, locale: locale))
}
