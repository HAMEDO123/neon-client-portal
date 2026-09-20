import Foundation

/// One cell of the project × step board, as the person doing it sees it.
struct EmployeeTask: Codable, Identifiable {
    let id: String
    let state: String
    let priority: String
    let scheduledFor: String?
    let dueAt: String?
    let adminNote: String?
    let employeeNote: String?
    let deliverable: String?
    let acceptance: String?
    let estimateHours: Double?
    let blockedReason: String?
    let step: Step
    let project: Project

    enum CodingKeys: String, CodingKey {
        // The server calls the step `task`, from when a board cell and its step
        // were the same thing. Renamed here rather than carrying `task.task`
        // through every screen.
        case id, state, priority, scheduledFor, dueAt, adminNote, employeeNote
        case deliverable, acceptance, estimateHours, blockedReason, project
        case step = "task"
    }

    struct Step: Codable {
        let id: String
        let name: String
        let deliverable: String?
        let acceptance: String?
        let evidence: String?
        let checklist: String?
    }

    struct Project: Codable {
        let id: String
        let name: String
        let clientName: String
        let location: String?
    }

    /// What finishing means. The cell's own words where it has them, the step's
    /// standard otherwise — the same precedence `effectiveDetail` applies on
    /// the server, so a cell nobody customised still says what done looks like
    /// instead of claiming there is no answer.
    var effectiveAcceptance: String? { firstWritten(acceptance, step.acceptance) }
    var effectiveDeliverable: String? { firstWritten(deliverable, step.deliverable) }

    /// Acceptance is listed one line per item, because each line is checked on
    /// its own when the photo arrives.
    var acceptanceLines: [String] {
        (effectiveAcceptance ?? "")
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    var isBlocked: Bool { !(blockedReason ?? "").isEmpty }
    var dueDate: Date? { dueAt.flatMap(ISO8601DateFormatter.chat.date(from:)) }

    private func firstWritten(_ cell: String?, _ step: String?) -> String? {
        // An emptied box is not an override: clearing a cell's acceptance
        // inherits the step's again rather than turning the check off.
        if let cell, !cell.trimmingCharacters(in: .whitespaces).isEmpty { return cell }
        if let step, !step.trimmingCharacters(in: .whitespaces).isEmpty { return step }
        return nil
    }
}

/// The five states the board keeps. An employee may only ever choose between
/// the first two; the rest are the manager's or are reached by sending proof.
enum TaskStateLabel {
    static func text(_ raw: String) -> String {
        switch raw {
        case "TODO": return L("To do")
        case "IN_PROGRESS": return L("In progress")
        case "SUBMITTED": return L("Sent for review")
        case "DONE": return L("Done")
        case "TOMORROW": return L("Tomorrow")
        default: return raw
        }
    }

    static func tone(_ raw: String) -> BadgeTone {
        switch raw {
        case "IN_PROGRESS": return .cyan
        case "SUBMITTED": return .warning
        case "DONE": return .success
        case "TOMORROW": return .purple
        default: return .neutral
        }
    }
}
