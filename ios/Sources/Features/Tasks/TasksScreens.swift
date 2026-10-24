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
///
/// `tasks-routines-fixture`, `tasks-routine-new-fixture` and
/// `tasks-week-fixture` draw the routine tasks and a week with a routine's
/// day on it from fixed answers (`TasksFixtures`), reading nothing.
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
        "tasks-briefing", "tasks-briefing-list",
        "tasks-routines-fixture", "tasks-routine-new-fixture", "tasks-week-fixture",
    ]

    private static let briefingTeam = [
        AssignTeamMember(id: "w", name: "Wael", color: nil, role: "Designer", photoUrl: nil),
        AssignTeamMember(id: "s", name: "Sally", color: nil, role: "3D visualiser", photoUrl: nil),
        AssignTeamMember(id: "a", name: "Amro", color: nil, role: "Site engineer", photoUrl: nil),
    ]

    private static let briefingWords = "وائل اليوم واحد يتصل بالمورد اثنين يبعت مخططات الفيلا سالي بكرة تخلص ريندرات الصالة ضروري وتبعتلي صور وعمرو من الأحد للثلاثاء زيارة موقع عبدون ونزار يجهز العرض"

    private static var briefingAnswer: BriefingAnswer {
        let today = NeonFormat.dayKey(Date())
        let tomorrow = BriefingDays.shift(today, by: 1)
        return BriefingAnswer(
            ok: true, error: nil, todayKey: today, tomorrowKey: tomorrow,
            drafts: [
                BriefingDraft(employeeId: "w", title: "يتصل بالمورد", note: nil, acceptance: nil, startKey: today, endKey: today, priority: "MEDIUM"),
                BriefingDraft(employeeId: "w", title: "يبعت مخططات الفيلا", note: nil, acceptance: nil, startKey: today, endKey: today, priority: "MEDIUM"),
                BriefingDraft(employeeId: "s", title: "تخلص ريندرات الصالة", note: nil, acceptance: "تبعت صور الريندرات", startKey: tomorrow, endKey: tomorrow, priority: "HIGH"),
                BriefingDraft(employeeId: "a", title: "زيارة موقع عبدون", note: nil, acceptance: nil, startKey: BriefingDays.shift(today, by: 2), endKey: BriefingDays.shift(today, by: 4), priority: "MEDIUM"),
            ],
            unplaced: [BriefingUnplaced(said: "ونزار يجهز العرض", why: "There is nobody called Nizar on the team.")]
        )
    }

    @MainActor static func view(_ id: String) -> AnyView? {
        let api = APIClient.shared
        switch id {
        // Saying the tasks: the empty box, and the list an answer leaves —
        // made up here, so nothing is asked of the assistant or sent anywhere.
        case "tasks-briefing": return AnyView(TaskBriefingView(preview: "", answer: nil, team: briefingTeam))
        case "tasks-briefing-list": return AnyView(TaskBriefingView(preview: briefingWords, answer: briefingAnswer, team: briefingTeam))

        // Routine tasks from fixed answers: the list, the form over it, and
        // a week whose card and rows show them.
        case "tasks-routines-fixture":
            return debugPushed(RoutinesView(store: TaskRoutinesStore(preview: TasksFixtures.routines), team: TasksFixtures.week.team))
        case "tasks-routine-new-fixture":
            return AnyView(
                NavigationStack { RoutinesView(store: TaskRoutinesStore(preview: TasksFixtures.routines), team: TasksFixtures.week.team) }
                    .sheet(isPresented: .constant(true)) {
                        RoutineEditorSheet(team: TasksFixtures.week.team) {}
                    }
            )
        case "tasks-week-fixture": return AnyView(TasksDebugWeekFixture())
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

/// Fixed answers for the routine screens. Decoded from JSON, as the server
/// would send them, so a model that stops matching the answer fails here too.
enum TasksFixtures {
    static let week: WeekBoardResponse = {
        let json = """
        {"timezone":"Asia/Amman","todayKey":"2026-10-21","tomorrowKey":"2026-10-22","weekStart":"2026-10-18",
         "weekKeys":["2026-10-18","2026-10-19","2026-10-20","2026-10-21","2026-10-22","2026-10-23","2026-10-24"],
         "previousWeek":"2026-10-11","nextWeek":"2026-10-25",
         "team":[
           {"id":"fx-w","name":"Wael","role":"Designer","color":"cyan"},
           {"id":"fx-s","name":"Sally","role":"3D visualiser","color":"pink"},
           {"id":"fx-a","name":"Amro","role":"Site engineer","color":"orange"}
         ],
         "tasks":[
           {"id":"fx-j1","employeeId":"fx-w","title":"تصوير لوحة الموقع وإرسالها","startKey":"2026-10-21","endKey":"2026-10-21",
            "state":"TODO","priority":"MEDIUM","routineId":"fx-r1"},
           {"id":"fx-j2","employeeId":"fx-s","title":"Update the render log","startKey":"2026-10-21","endKey":"2026-10-21",
            "state":"SUBMITTED","priority":"HIGH","routineId":"fx-r2"},
           {"id":"fx-j3","employeeId":"fx-a","title":"Site visit — Abdoun villa","startKey":"2026-10-20","endKey":"2026-10-22",
            "state":"IN_PROGRESS","priority":"MEDIUM"},
           {"id":"fx-j4","employeeId":"fx-w","title":"تصوير لوحة الموقع وإرسالها","startKey":"2026-10-20","endKey":"2026-10-20",
            "state":"DONE","priority":"MEDIUM","routineId":"fx-r1"}
         ]}
        """
        // A fixture that does not decode is a bug in this file; crash loudly.
        return try! JSONDecoder().decode(WeekBoardResponse.self, from: Data(json.utf8))
    }()

    static let routines: RoutinesResponse = {
        let json = """
        {"routines":[
          {"id":"fx-r1","title":"تصوير لوحة الموقع وإرسالها","note":null,
           "acceptance":"صورة واضحة للوحة\\nمرسلة قبل الخامسة","priority":"MEDIUM","active":true,"createdAt":"2026-10-01T08:00:00.000Z",
           "employee":{"id":"fx-w","name":"Wael","color":"cyan","photoUrl":null,"active":true}},
          {"id":"fx-r2","title":"Update the render log","note":"Every render sent to a client that day.",
           "acceptance":"A screenshot of today's rows","priority":"HIGH","active":true,"createdAt":"2026-10-02T08:00:00.000Z",
           "employee":{"id":"fx-s","name":"Sally","color":"pink","photoUrl":null,"active":true}},
          {"id":"fx-r3","title":"Check the site store's stock","note":null,"acceptance":null,
           "priority":"LOW","active":false,"createdAt":"2026-09-20T08:00:00.000Z",
           "employee":{"id":"fx-a","name":"Amro","color":"orange","photoUrl":null,"active":true}},
          {"id":"fx-r4","title":"Water the office plants","note":null,"acceptance":null,
           "priority":"MEDIUM","active":true,"createdAt":"2026-09-01T08:00:00.000Z",
           "employee":{"id":"fx-n","name":"Nizar","color":"purple","photoUrl":null,"active":false}}
        ]}
        """
        return try! JSONDecoder().decode(RoutinesResponse.self, from: Data(json.utf8))
    }()
}

/// The Week segment drawn from the fixture: the week card, the "Every day"
/// card under it, and the days, with no network.
private struct TasksDebugWeekFixture: View {
    @StateObject private var week = TaskWeekStore(preview: TasksFixtures.week)
    @StateObject private var routines = TaskRoutinesStore(preview: TasksFixtures.routines)

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                NeonScroll(spacing: NeonSpace.stack) {
                    WeekBoardView(store: week, routines: routines, editing: .constant(nil), proxy: proxy)
                }
                .debugScroll(proxy)
            }
            .navigationTitle(L("Tasks"))
            .navigationBarTitleDisplayMode(.inline)
        }
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
