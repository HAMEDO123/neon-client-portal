import SwiftUI

/// One cell of the board: state, assignee, scheduling, priority, notes, and
/// what finishing it means — `updateTaskEntryDetails` on the website, with
/// the state change (`setTaskState`) as its own, immediate action, exactly as
/// the board's own click-to-cycle is separate from the editor's Save.
struct CellEditorSheet: View {
    let project: BoardProject
    let cell: BoardCell
    let step: BoardStepRef
    /// The whole board, so the "waits for" picker can offer every other step
    /// of this project and the assignee/blocked-by menus can offer the team.
    let board: TaskBoardResponse?

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var currentState: String
    @State private var settingState = false
    @State private var assigneeId: String?
    @State private var scheduledFor: Date?
    @State private var dueTime: Date?
    @State private var priority: String
    @State private var adminNote: String
    @State private var deliverable: String
    @State private var acceptance: String
    @State private var estimateHours: Double?
    @State private var blockedReason: String
    @State private var blockedById: String?
    @State private var excludedFromProgress: Bool
    @State private var dependsOn: Set<String>
    @State private var clearing = false

    init(project: BoardProject, cell: BoardCell, step: BoardStepRef, board: TaskBoardResponse?) {
        self.project = project
        self.cell = cell
        self.step = step
        self.board = board
        _currentState = State(initialValue: cell.state)
        _assigneeId = State(initialValue: cell.assigneeId)
        _scheduledFor = State(initialValue: cell.scheduledFor.flatMap { NeonFormat.date(fromDayKey: $0) })
        _dueTime = State(initialValue: cell.dueTime.flatMap(Self.timeOfDay))
        _priority = State(initialValue: cell.priority)
        _adminNote = State(initialValue: cell.adminNote ?? "")
        _deliverable = State(initialValue: cell.deliverable ?? "")
        _acceptance = State(initialValue: cell.acceptance ?? "")
        _estimateHours = State(initialValue: cell.estimateHours)
        _blockedReason = State(initialValue: cell.blockedReason ?? "")
        _blockedById = State(initialValue: cell.blockedById)
        _excludedFromProgress = State(initialValue: cell.excludedFromProgress)
        _dependsOn = State(initialValue: Set(cell.waitsForTaskIds))
    }

    private var team: [TaskPerson] { board?.team ?? [] }
    private var otherSteps: [BoardStep] { (board?.steps ?? []).filter { $0.id != cell.taskId } }
    private var stepStandard: BoardStep? { board?.steps.first { $0.id == cell.taskId } }

    var body: some View {
        SheetScaffold(step.name, subtitle: project.name, symbol: "square.grid.3x3",
                      primaryTitle: L("Save"), onPrimary: { await save() }) {
            FormSection(L("State")) {
                HStack(spacing: 8) {
                    StateBadge(state: currentState)
                    Spacer()
                    if settingState { ProgressView().controlSize(.small) }
                }
                HStack(spacing: 8) {
                    stateButton("TODO")
                    stateButton("DONE")
                    stateButton("TOMORROW")
                }
                if let lastNote = cell.lastUpdateNote, !lastNote.isEmpty {
                    DetailCard(title: L("Last word from the team"), symbol: "text.bubble") {
                        DirText(lastNote, font: .system(size: 13.5))
                    }
                }
            }

            FormSection(L("Assignment")) {
                MenuField(L("Assignee"), selection: $assigneeId, options: team.map(\.id),
                          title: { id in team.first { $0.id == id }?.name ?? id },
                          noneTitle: L("Whoever owns this step"))
                OptionalDateField(L("Scheduled for"), date: $scheduledFor)
                if scheduledFor != nil {
                    OptionalDateField(L("Due time"), date: $dueTime, components: .hourAndMinute, addTitle: L("Add a time"))
                }
                MenuField(L("Priority"), selection: $priority, options: taskPriorities, title: localizedPriority)
            }

            FormSection(L("What finishing means"), footer: stepStandard?.deliverable == nil && stepStandard?.acceptance == nil ? nil : L("Left empty, this cell uses the step's own standard.")) {
                NeonTextEditor(L("Deliverable"), text: $deliverable, prompt: stepStandard?.deliverable ?? L("What to hand in"), minLines: 2, limit: 2000)
                NeonTextEditor(L("Counts as done when"), text: $acceptance, prompt: stepStandard?.acceptance ?? L("One line per item"), minLines: 3, limit: 4000)
                NumberField(L("Estimate"), value: $estimateHours, unit: L("h"), decimals: 1)
            }

            FormSection(L("Notes")) {
                NeonTextEditor(L("Note to the team"), text: $adminNote, minLines: 2, limit: 2000)
                ToggleRow(L("Not counted in progress"), detail: L("Left out of the board's totals."), symbol: "minus.circle", isOn: $excludedFromProgress)
            }

            FormSection(L("Blocked")) {
                NeonTextEditor(L("Reason"), text: $blockedReason, prompt: L("Why this can't move"), minLines: 2, limit: 1000)
                MenuField(L("Blocked by"), selection: $blockedById, options: team.map(\.id),
                          title: { id in team.first { $0.id == id }?.name ?? id }, noneTitle: L("Nobody in particular"))
                    .disabled(blockedReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .opacity(blockedReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.4 : 1)
            }

            if !otherSteps.isEmpty {
                FormSection(L("Waits for"), footer: L("A list that would leave two steps waiting on each other is refused, and nothing is saved.")) {
                    SelectField(L("Steps"), selection: $dependsOn, options: otherSteps.map(\.id),
                                title: { id in otherSteps.first { $0.id == id }?.name ?? id })
                }
            }

            NeonButton(L("Clear scheduling"), symbol: "eraser", kind: .destructive,
                       confirm: L("Clear this cell's scheduling?"),
                       confirmMessage: L("The assignee, dates, note and priority go back to nothing. The tick history stays.")) {
                await clear()
            }
        }
        .neonSheet([.large])
    }

    @ViewBuilder
    private func stateButton(_ target: String) -> some View {
        NeonButton(taskStateLabel(target), kind: currentState == target ? .tinted(taskStateTone(target).foreground) : .secondary, size: .small) {
            await setState(target)
        }
    }

    private func setState(_ target: String) async {
        guard target != currentState else { return }
        settingState = true
        defer { settingState = false }
        do {
            try await api.setBoardCellState(projectId: project.id, taskId: cell.taskId, state: target)
            currentState = target
            Haptic.success()
        } catch {
            Toast.error(error)
        }
    }

    private func save() async {
        let form: [String: Any] = [
            "assigneeId": assigneeId ?? "",
            "scheduledFor": scheduledFor.map { NeonFormat.dayKey($0) } ?? "",
            "dueTime": (scheduledFor != nil ? dueTime.map(Self.hhmm) : nil) ?? "",
            "priority": priority,
            "adminNote": adminNote,
            "excludedFromProgress": excludedFromProgress ? "on" : "",
            "deliverable": deliverable,
            "acceptance": acceptance,
            "estimateHours": estimateHours.map { String($0) } ?? "",
            "blockedReason": blockedReason,
            "blockedById": blockedReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : (blockedById ?? ""),
            "dependsOnPresent": "1",
            "dependsOn": Array(dependsOn),
        ]
        do {
            try await api.updateCellDetails(projectId: project.id, taskId: cell.taskId, form: form)
            Toast.success(L("Saved"))
            dismiss()
        } catch {
            Toast.error(error)
        }
    }

    private func clear() async {
        clearing = true
        defer { clearing = false }
        do {
            try await api.clearCellDetails(projectId: project.id, taskId: cell.taskId)
            Toast.success(L("Cleared"))
            dismiss()
        } catch {
            Toast.error(error)
        }
    }

    private static func timeOfDay(_ hhmm: String) -> Date? {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        return Calendar.current.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: Date())
    }

    private static func hhmm(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }
}
