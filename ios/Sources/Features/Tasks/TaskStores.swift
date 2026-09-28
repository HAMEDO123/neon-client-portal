import Foundation

// Reading the three tasks/* endpoints, and every action this area performs —
// kept in one place per ios/UI/README.md ("put these calls in an extension
// APIClient in your own folder").

extension APIClient {
    // MARK: Reads

    func fetchTaskBoard() async throws -> Loaded<TaskBoardResponse> {
        try await read("tasks/board", as: TaskBoardResponse.self)
    }

    func fetchTaskWeek(week: String?) async throws -> Loaded<WeekBoardResponse> {
        try await read("tasks/week", ["week": week], as: WeekBoardResponse.self)
    }

    func fetchTaskProcess() async throws -> Loaded<ProcessResponse> {
        try await read("tasks/process", as: ProcessResponse.self)
    }

    // MARK: The board

    @discardableResult
    func setBoardCellState(projectId: String, taskId: String, state: String) async throws -> ActionOutcome {
        try await perform("tasks/setState", args: [projectId, taskId, state])
    }

    @discardableResult
    func resetProjectTasks(projectId: String) async throws -> ActionOutcome {
        try await perform("tasks/resetProject", args: [projectId])
    }

    @discardableResult
    func updateCellDetails(projectId: String, taskId: String, form: [String: Any]) async throws -> ActionOutcome {
        try await perform("tasks/updateCellDetails", args: [projectId, taskId], form: form)
    }

    @discardableResult
    func clearCellDetails(projectId: String, taskId: String) async throws -> ActionOutcome {
        try await perform("tasks/clearCellDetails", args: [projectId, taskId])
    }

    // MARK: Owners (who is on the board, from the process settings)

    @discardableResult
    func createOwner(name: String) async throws -> ActionOutcome { try await perform("tasks/createOwner", args: [name]) }

    @discardableResult
    func updateOwner(id: String, name: String, role: String) async throws -> ActionOutcome {
        try await perform("tasks/updateOwner", args: [id, name, role])
    }

    @discardableResult
    func deleteOwner(id: String) async throws -> ActionOutcome { try await perform("tasks/deleteOwner", args: [id]) }

    @discardableResult
    func moveOwner(id: String, direction: String) async throws -> ActionOutcome {
        try await perform("tasks/moveOwner", args: [id, direction])
    }

    // MARK: Sections

    @discardableResult
    func createSection(name: String) async throws -> ActionOutcome { try await perform("tasks/createSection", args: [name]) }

    @discardableResult
    func updateSection(id: String, name: String, color: String) async throws -> ActionOutcome {
        try await perform("tasks/updateSection", args: [id, name, color])
    }

    @discardableResult
    func deleteSection(id: String) async throws -> ActionOutcome { try await perform("tasks/deleteSection", args: [id]) }

    @discardableResult
    func moveSection(id: String, direction: String) async throws -> ActionOutcome {
        try await perform("tasks/moveSection", args: [id, direction])
    }

    // MARK: Steps

    @discardableResult
    func createStep(name: String, employeeId: String?, sectionId: String?) async throws -> ActionOutcome {
        try await perform("tasks/createStep", args: [name, employeeId ?? "", sectionId ?? ""])
    }

    @discardableResult
    func updateStep(id: String, name: String, employeeId: String?, sectionId: String?) async throws -> ActionOutcome {
        try await perform("tasks/updateStep", args: [id, name, employeeId ?? "", sectionId ?? ""])
    }

    @discardableResult
    func deleteStep(id: String) async throws -> ActionOutcome { try await perform("tasks/deleteStep", args: [id]) }

    @discardableResult
    func moveStep(id: String, direction: String) async throws -> ActionOutcome {
        try await perform("tasks/moveStep", args: [id, direction])
    }

    @discardableResult
    func setStepSection(taskId: String, sectionId: String?) async throws -> ActionOutcome {
        try await perform("tasks/setStepSection", args: [taskId, sectionId ?? ""])
    }

    @discardableResult
    func saveTaskType(id: String, form: [String: Any]) async throws -> ActionOutcome {
        try await perform("tasks/saveType", args: [id], form: form)
    }

    // MARK: Stage periods

    @discardableResult
    func savePeriod(form: [String: Any]) async throws -> ActionOutcome {
        try await perform("tasks/savePeriod", form: form)
    }

    @discardableResult
    func deletePeriod(id: String) async throws -> ActionOutcome { try await perform("tasks/deletePeriod", args: [id]) }

    // MARK: The week board — jobs handed out by hand

    func createJob(form: [String: Any]) async throws -> String? {
        let outcome = try await perform("tasks/createJob", form: form)
        struct Created: Decodable { let id: String }
        return try outcome.result(Created.self)?.id
    }

    @discardableResult
    func updateJob(id: String, form: [String: Any]) async throws -> ActionOutcome {
        try await perform("tasks/updateJob", args: [id], form: form)
    }

    @discardableResult
    func deleteJob(id: String) async throws -> ActionOutcome { try await perform("tasks/deleteJob", args: [id]) }

    @discardableResult
    func moveJob(id: String, days: Int, employeeId: String?) async throws -> ActionOutcome {
        try await perform("tasks/moveJob", args: [id, days, employeeId ?? ""])
    }

    @discardableResult
    func setJobState(id: String, state: String) async throws -> ActionOutcome {
        try await perform("tasks/setJobState", args: [id, state])
    }
}

// MARK: - Loaders

/// The project board: `getTaskBoard()` plus the cell detail and step
/// standards the mobile registry adds.
@MainActor
final class TaskBoardStore: ObservableObject {
    @Published private(set) var value: TaskBoardResponse?
    @Published private(set) var cachedAt: Date?
    @Published private(set) var errorMessage: String?
    @Published private(set) var loaded = false

    func load(_ api: APIClient) async {
        do {
            let loaded = try await api.fetchTaskBoard()
            value = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
            self.loaded = true
        } catch {
            if !self.loaded { errorMessage = error.localizedDescription }
        }
    }
}

/// The week board, for one week at a time. `weekStart` drives which week is
/// shown; changing it reloads.
@MainActor
final class TaskWeekStore: ObservableObject {
    @Published private(set) var value: WeekBoardResponse?
    @Published private(set) var cachedAt: Date?
    @Published private(set) var errorMessage: String?
    @Published private(set) var loaded = false
    @Published var week: String?

    func load(_ api: APIClient) async {
        do {
            let loaded = try await api.fetchTaskWeek(week: week)
            value = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
            self.loaded = true
            week = loaded.value.weekStart
        } catch {
            if !self.loaded { errorMessage = error.localizedDescription }
        }
    }
}

/// The delivery process: sections, steps, owners, task-type standards, stage
/// periods.
@MainActor
final class TaskProcessStore: ObservableObject {
    @Published private(set) var value: ProcessResponse?
    @Published private(set) var cachedAt: Date?
    @Published private(set) var errorMessage: String?
    @Published private(set) var loaded = false

    func load(_ api: APIClient) async {
        do {
            let loaded = try await api.fetchTaskProcess()
            value = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
            self.loaded = true
        } catch {
            if !self.loaded { errorMessage = error.localizedDescription }
        }
    }
}
