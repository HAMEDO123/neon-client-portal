import SwiftUI

// The manager's Tasks area, as the mobile API answers it
// (src/lib/mobile/registry/tasks.ts): the project board (`tasks/board`), the
// week board of jobs handed out by hand (`tasks/week`), and the delivery
// process (`tasks/process`). Every shape here mirrors exactly what those
// three reads return — see src/lib/mobile/tasks-{board,process,week}.ts.

// MARK: - The board (tasks/board)

struct TaskBoardResponse: Decodable {
    let timezone: String
    let todayKey: String
    let tomorrowKey: String
    let sections: [BoardSection]
    let steps: [BoardStep]
    let team: [TaskPerson]
    let rows: [BoardRow]
    let stats: BoardStats
    let upcoming: [UpcomingStage]
    let awaitingReview: Int
}

struct BoardSection: Decodable, Identifiable {
    let id: String
    let name: String
    let color: String
    let real: Bool
    let steps: [BoardStepRef]
}

struct BoardStepRef: Decodable, Identifiable {
    let id: String
    let name: String
    let sectionId: String?
    let defaultOwnerId: String?
}

/// A step of the process, with its standard (what each kind of work needs) —
/// the same row `BoardStepRef` names, carrying more.
struct BoardStep: Decodable, Identifiable {
    let id: String
    let name: String
    let sectionId: String?
    let defaultOwnerId: String?
    let deliverable: String?
    let acceptance: String?
    let estimateHours: Double?
}

struct TaskPerson: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let role: String?
    let color: String
}

struct BoardProject: Decodable, Identifiable {
    let id: String
    let name: String
    let clientName: String?
    let location: String?
    let coverImageUrl: String?
    let pipelineStatus: String?
}

struct BoardRow: Decodable, Identifiable {
    let project: BoardProject
    let done: Int
    let tomorrow: Int
    let cells: [BoardCell]
    var id: String { project.id }
}

/// One cell of the project × step matrix — `ProjectTaskEntry`, as the board
/// reads it, with the cell editor's own detail merged in.
struct BoardCell: Decodable, Identifiable {
    let taskId: String
    let entryId: String?
    let waitsForTaskIds: [String]
    let state: String
    let priority: String
    /// "YYYY-MM-DD", or null until the manager schedules it.
    let scheduledFor: String?
    let dueAt: String?
    /// "HH:MM" in the company's own timezone — read this, never `dueAt`
    /// directly, for the time box in the editor.
    let dueTime: String?
    let adminNote: String?
    let assigneeId: String?
    let excludedFromProgress: Bool
    /// Who is actually on the hook: the assignee, else the section holder,
    /// else the step's standing owner.
    let ownerId: String?
    let deliverable: String?
    let acceptance: String?
    let estimateHours: Double?
    let blockedReason: String?
    let blockedById: String?
    let lastUpdateNote: String?
    let lastUpdateAt: String?
    let nextStep: String?
    let startedAt: String?
    let completedAt: String?

    var id: String { taskId }
}

struct BoardStats: Decodable {
    let activeProjects: Int
    let stepsDone: Int
    let stepsCounted: Int
    let inProgress: Int
    let dueTomorrow: Int
}

/// A row of the "Upcoming" panel: what a stage period says is due next.
struct UpcomingStage: Decodable, Identifiable {
    let projectId: String
    let projectName: String
    let taskId: String
    let taskName: String
    let state: String
    let dueBy: String
    let dueDayKey: String
    let source: String?
    var id: String { "\(projectId):\(taskId)" }
}

// MARK: - The week board (tasks/week)

struct WeekBoardResponse: Decodable {
    let timezone: String
    let todayKey: String
    let tomorrowKey: String
    let weekStart: String
    let weekKeys: [String]
    let previousWeek: String
    let nextWeek: String
    let team: [TaskPerson]
    let tasks: [AssignedJob]
}

/// `AssignedTaskView` in src/lib/assigned-tasks.ts — a job the manager (or a
/// ticked assigner) handed out by hand, outside any project.
struct AssignedJob: Decodable, Identifiable {
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
    /// Set when this job came from a chat's task card — the chat is where it
    /// is really managed, so the week board only shows it.
    let chatTaskId: String?
    let lastUpdateNote: String?
    let lastUpdateAt: String?
    let nextStep: String?

    var days: Int { max(1, (dayIndex(endKey) - dayIndex(startKey)) + 1) }
}

private func dayIndex(_ key: String) -> Int {
    Int((parseISODate("\(key)T00:00:00.000Z")?.timeIntervalSince1970 ?? 0) / 86400)
}

// MARK: - The process (tasks/process)

struct ProcessResponse: Decodable {
    let sections: [ProcessSection]
    let steps: [ProcessStep]
    let periods: [StagePeriodRow]
    let timeline: [TimelineRange]
    let totalDays: Int
    let team: [ProcessMember]
}

struct ProcessSection: Decodable, Identifiable {
    let id: String
    let name: String
    let color: String
    let order: Int
}

/// A step's own standard — "what each kind of work needs" on the settings
/// page — plus what `linesOf`/`mayAutoAccept` work out from it.
struct ProcessStep: Decodable, Identifiable {
    let id: String
    let name: String
    let order: Int
    let sectionId: String?
    let ownerId: String?
    let deliverable: String?
    let acceptance: String?
    let estimateHours: Double?
    let evidence: String?
    let checklist: String?
    let autoAccept: Bool
    let reviewerId: String?
    let acceptanceLines: [String]
    let checklistLines: Int
    let mayAutoAccept: Bool
}

struct StagePeriodRow: Decodable, Identifiable {
    let id: String
    let fromTaskId: String
    let toTaskId: String
    let days: Int
}

struct TimelineRange: Decodable, Identifiable {
    let periodId: String?
    let fromTaskId: String
    let toTaskId: String
    let days: Int
    let startDay: Int
    let endDay: Int
    let steps: Int
    var id: String { periodId ?? "\(fromTaskId)-\(toTaskId)" }
}

struct ProcessMember: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let role: String?
    let color: String
    let active: Bool
}

// MARK: - Shared small vocabularies

let taskPriorities = ["LOW", "MEDIUM", "HIGH"]

func localizedPriority(_ value: String) -> String {
    switch value {
    case "HIGH": return L("High")
    case "LOW": return L("Low")
    default: return L("Medium")
    }
}

/// The employee accent a section/column carries — `EMPLOYEE_COLORS` in
/// src/lib/task-board.ts.
func sectionAccentColor(_ name: String) -> Color {
    switch name {
    case "cyan": return .neonCyanStrong
    case "purple": return .neonPurpleStrong
    case "pink": return .neonPinkStrong
    case "orange": return .neonOrangeStrong
    default: return .neonInk.opacity(0.5)
    }
}
