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
    /// Their own face (the manager's too, from their own row), or nil.
    let photoUrl: String?
    /// False for a manager with no row to keep a photo on; nil from a server
    /// older than faces.
    let canSetPhoto: Bool?
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
