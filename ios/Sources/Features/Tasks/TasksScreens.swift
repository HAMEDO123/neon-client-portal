#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Every screen and sheet of the Tasks area is here; a sheet is shown as a
/// screen, opened on the first real thing the server has for it.
///
/// Scroll anchors (`-neonScroll <anchor>`):
///   tasks-board   progress · upcoming · projects
///   tasks-week    days
///   tasks-team    team · people
///   tasks-person  lists
///   tasks-process sections · steps · owners · periods
enum TasksScreens {
    static let ids: [String] = [
        "tasks-board", "tasks-week", "tasks-chat", "tasks-team",
        "tasks-cell-editor", "tasks-job-new", "tasks-job-edit", "tasks-person",
        "tasks-process",
        "tasks-process-section", "tasks-process-section-new",
        "tasks-process-step", "tasks-process-step-new",
        "tasks-process-standard",
        "tasks-process-owner", "tasks-process-owner-new",
        "tasks-process-period", "tasks-process-period-new",
    ]

    @MainActor static func view(_ id: String) -> AnyView? {
        let api = APIClient.shared
        switch id {
        case "tasks-board": return AnyView(TasksRootView(initialSegment: .board))
        case "tasks-week": return AnyView(TasksRootView(initialSegment: .week))
        case "tasks-chat": return AnyView(TasksRootView(initialSegment: .chat))
        case "tasks-team": return AnyView(TasksRootView(initialSegment: .team))

        case "tasks-cell-editor":
            return AnyView(DebugAsync(load: { try await richestCell(api.fetchTaskBoard().value) }) { found in
                CellEditorSheet(project: found.project, cell: found.cell, step: found.step, board: found.board)
            })

        case "tasks-job-new":
            return AnyView(DebugAsync(load: { try await api.fetchTaskWeek(week: nil).value }) { week in
                JobEditorSheet(target: .new(day: week.todayKey), team: week.team)
            })
        case "tasks-job-edit":
            return AnyView(DebugAsync(load: { try await firstJob(api) }) { found in
                JobEditorSheet(target: .existing(found.job), team: found.team)
            })

        case "tasks-person":
            return AnyView(DebugAsync(load: {
                let people = try await api.fetchTaskPeople(period: "week", day: nil).value.people
                return (people.first { $0.total > 0 } ?? people.first)?.id
            }) { personId in
                TasksDebugPersonHost(personId: personId)
            })

        case "tasks-process": return debugPushed(ProcessSettingsView())

        // The short forms open over the page as the app opens them — a
        // half-height sheet — so a screenshot shows what a manager sees.
        case "tasks-process-section", "tasks-process-section-new":
            return overProcess { process in
                ProcessSectionSheet(section: id.hasSuffix("-new") ? nil : process.sections.first,
                                    existingIds: Set(process.sections.map(\.id))) {}
            }
        case "tasks-process-step", "tasks-process-step-new":
            return overProcess { process in
                ProcessStepSheet(step: id.hasSuffix("-new") ? nil : process.steps.first, process: process) {}
            }
        case "tasks-process-standard":
            return AnyView(DebugAsync(load: {
                let process = try await api.fetchTaskProcess().value
                return (process.steps.first { !$0.acceptanceLines.isEmpty } ?? process.steps.first).map { ($0, process.team) }
            }) { found in
                ProcessTaskTypeSheet(step: found.0, team: found.1) {}
            })
        case "tasks-process-owner", "tasks-process-owner-new":
            return overProcess { process in
                ProcessOwnerSheet(owner: id.hasSuffix("-new") ? nil : process.team.first,
                                  existingIds: Set(process.team.map(\.id))) {}
            }
        case "tasks-process-period", "tasks-process-period-new":
            return overProcess { process in
                ProcessPeriodSheet(period: id.hasSuffix("-new") ? nil : process.periods.first, steps: process.steps) {}
            }

        default: return nil
        }
    }

    /// The delivery process page with one of its short forms open over it.
    @MainActor private static func overProcess<Sheet: View>(@ViewBuilder _ sheet: @escaping (ProcessResponse) -> Sheet) -> AnyView {
        AnyView(
            NavigationStack { ProcessSettingsView() }
                .sheet(isPresented: .constant(true)) {
                    DebugAsync(load: { try await APIClient.shared.fetchTaskProcess().value }) { process in
                        sheet(process)
                    }
                    // The same heights as the form itself, from the start, so
                    // the sheet opens at them rather than full height while
                    // the form loads.
                    .neonSheet(tasksShortSheet)
                }
        )
    }

    struct FoundCell {
        let project: BoardProject
        let cell: BoardCell
        let step: BoardStepRef
        let board: TaskBoardResponse
    }

    /// The cell that shows the most of the editor: one with a word from the
    /// team, else one still open, else the first on the board.
    private static func richestCell(_ board: TaskBoardResponse) -> FoundCell? {
        let all = board.rows.flatMap { row in row.cells.map { (row.project, $0) } }
        let pick = all.first { $0.1.lastUpdateNote?.isEmpty == false }
            ?? all.first { $0.1.state != "DONE" }
            ?? all.first
        guard let (project, cell) = pick,
              let step = board.sections.lazy.flatMap(\.steps).first(where: { $0.id == cell.taskId })
        else { return nil }
        return FoundCell(project: project, cell: cell, step: step, board: board)
    }

    struct FoundJob {
        let job: AssignedJob
        let team: [TaskPerson]
    }

    /// A job from this week, or failing that the week before.
    @MainActor private static func firstJob(_ api: APIClient) async throws -> FoundJob? {
        let week = try await api.fetchTaskWeek(week: nil).value
        if let job = week.tasks.first { return FoundJob(job: job, team: week.team) }
        let before = try await api.fetchTaskWeek(week: week.previousWeek).value
        return before.tasks.first.map { FoundJob(job: $0, team: before.team) }
    }
}

/// One person's list, with the two stores it reads from, as the Team
/// segment would push it.
private struct TasksDebugPersonHost: View {
    let personId: String
    @EnvironmentObject var api: APIClient
    @StateObject private var people = TaskPeopleStore()
    @StateObject private var board = TaskBoardStore()

    var body: some View {
        NavigationStack {
            TaskPeopleDetailView(personId: personId, store: people, board: board)
        }
        .task {
            await people.load(api)
            await board.load(api)
        }
    }
}
#endif
