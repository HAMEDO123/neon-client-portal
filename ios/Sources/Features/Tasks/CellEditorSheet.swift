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
    private var section: BoardSection? { board?.sections.first { $0.steps.contains { $0.id == cell.taskId } } }
    private var owner: TaskPerson? { team.first { $0.id == cell.ownerId } }
    private var isBlocked: Bool { !blockedReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        SheetScaffold(step.name, subtitle: project.name, symbol: "square.grid.3x3.fill",
                      primaryTitle: L("Save"), onPrimary: { await save() }) {
            summary
                .neonAppear()

            FormSection(L("State"), footer: L("A state changes the moment you tap it — it is not part of Save.")) {
                TasksStatePicker(states: ["TODO", "DONE", "TOMORROW"], current: currentState) { target in
                    await setState(target)
                }
                if currentState == "SUBMITTED" {
                    StatusNote(symbol: "paperplane.fill", tone: .purple, title: L("Sent for review"),
                               detail: L("The proof waits in Reviews, to approve or send back."))
                } else if currentState == "IN_PROGRESS" {
                    StatusNote(symbol: "bolt.fill", tone: .cyan, title: L("In progress"),
                               detail: L("Somebody has started it."))
                }
                if let lastNote = cell.lastUpdateNote, !lastNote.isEmpty {
                    lastWord(lastNote)
                }
            }

            FormSection(L("Assignment")) {
                MenuField(L("Assignee"), selection: $assigneeId, options: team.map(\.id),
                          title: { id in team.first { $0.id == id }?.name ?? id },
                          // Named only when nobody is set on the cell: then the
                          // owner the board resolved is exactly who "whoever" is.
                          noneTitle: cell.assigneeId == nil ? owner.map { L("Whoever owns this step (%@)", $0.name) } ?? L("Whoever owns this step")
                              : L("Whoever owns this step"))
                OptionalDateField(L("Scheduled for"), date: $scheduledFor)
                if scheduledFor != nil {
                    OptionalDateField(L("Due time"), date: $dueTime, components: .hourAndMinute, addTitle: L("Add a time"))
                        .transition(.neonRise)
                }
                MenuField(L("Priority"), selection: $priority, options: taskPriorities, title: localizedPriority)
            }
            .animation(NeonMotion.smooth, value: scheduledFor != nil)

            FormSection(L("What finishing means"), footer: stepStandard?.deliverable == nil && stepStandard?.acceptance == nil ? nil : L("Left empty, this cell uses the step's own standard.")) {
                NeonTextEditor(L("Deliverable"), text: $deliverable, prompt: stepStandard?.deliverable ?? L("What to hand in"), minLines: 2, limit: 2000)
                NeonTextEditor(L("Counts as done when"), text: $acceptance, prompt: stepStandard?.acceptance ?? L("One line per item"), minLines: 3, limit: 4000)
                NumberField(L("Estimate"), value: $estimateHours, unit: L("h"), decimals: 1)
            }

            FormSection(L("Notes")) {
                NeonTextEditor(L("Note to the team"), text: $adminNote, minLines: 2, limit: 2000)
                ToggleRow(L("Not counted in progress"), detail: L("Left out of the board's totals."), symbol: "circle.lefthalf.filled", isOn: $excludedFromProgress)
            }

            FormSection(L("Blocked")) {
                NeonTextEditor(L("Reason"), text: $blockedReason, prompt: L("Why this can't move"), minLines: 2, limit: 1000)
                MenuField(L("Blocked by"), selection: $blockedById, options: team.map(\.id),
                          title: { id in team.first { $0.id == id }?.name ?? id }, noneTitle: L("Nobody in particular"))
                    .disabled(!isBlocked)
                    .opacity(isBlocked ? 1 : 0.4)
                    .animation(NeonMotion.quick, value: isBlocked)
            }

            if !otherSteps.isEmpty {
                FormSection(L("Waits for"), footer: L("A list that would leave two steps waiting on each other is refused, and nothing is saved.")) {
                    SelectField(L("Steps"), selection: $dependsOn, options: otherSteps.map(\.id),
                                title: { id in otherSteps.first { $0.id == id }?.name ?? id })
                }
            }

            NeonButton(L("Clear scheduling"), symbol: "eraser", kind: .destructive, size: .medium,
                       confirm: L("Clear this cell's scheduling?"),
                       confirmMessage: L("The assignee, dates, note and priority go back to nothing. The tick history stays.")) {
                await clear()
            }
            .frame(maxWidth: .infinity)
        }
        .neonSheet([.large])
    }

    // MARK: - Pieces

    /// Where this step sits and who is on the hook, before anything changes.
    private var summary: some View {
        HStack(alignment: .center, spacing: 12) {
            if let url = resolvedMediaURL(project.coverImageUrl) {
                RemoteImage(url: url)
                    .frame(width: 48, height: 48)
                    .clipShape(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous))
                    .accessibilityHidden(true)
            } else {
                IconTile("folder.fill", hue: .blue, size: 48)
            }
            VStack(alignment: .leading, spacing: 6) {
                if let section {
                    HStack(spacing: 6) {
                        Circle().fill(tasksColorHue(section.color).color).frame(width: 7, height: 7)
                        DirText(section.name, font: .system(.caption, weight: .bold), color: .neonTextSecondary, fill: false, lineLimit: 1)
                    }
                }
                FlowRow(spacing: 6) {
                    StateBadge(state: currentState)
                    if priority == "HIGH" { BadgeView(text: L("High"), tone: .pink, symbol: "flame.fill") }
                    if isBlocked { BadgeView(text: L("Blocked"), tone: .danger, symbol: "exclamationmark.octagon.fill") }
                    if excludedFromProgress { BadgeView(text: L("Not counted"), tone: .neutral) }
                }
                if let owner {
                    MetaLabel(L("On the hook: %@", owner.name), symbol: "person.fill", tint: .neonTextSecondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(NeonSpace.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .animation(NeonMotion.snappy, value: currentState)
    }

    /// What the person doing it last said about it, and when.
    private func lastWord(_ note: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            IconTile("text.bubble.fill", hue: .blue, size: 32)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(L("Last word from the team"))
                        .font(.system(.caption, weight: .bold))
                        .foregroundStyle(Color.neonBlueStrong)
                    if let when = formattedISODate(cell.lastUpdateAt) {
                        Text(verbatim: "·").foregroundStyle(Color.neonTextFaint)
                        Text(when)
                            .font(.neonMeta)
                            .foregroundStyle(Color.neonTextTertiary)
                            .lineLimit(1)
                    }
                }
                DirText(note, font: .neonCallout)
                if let next = cell.nextStep, !next.isEmpty {
                    DirText(L("Next: %@", next), font: .neonSubtitle, color: .neonTextSecondary)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.tinted(.neonBlue), radius: NeonRadius.md)
    }

    // MARK: - Actions

    private func setState(_ target: String) async {
        guard target != currentState else { return }
        do {
            try await api.setBoardCellState(projectId: project.id, taskId: cell.taskId, state: target)
            withNeonAnimation(NeonMotion.snappy) { currentState = target }
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
            "blockedById": isBlocked ? (blockedById ?? "") : "",
            "dependsOnPresent": "1",
            "dependsOn": Array(dependsOn),
        ]
        do {
            try await api.updateCellDetails(projectId: project.id, taskId: cell.taskId, form: form)
            Haptic.success()
            Toast.success(L("Saved"))
            dismiss()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func clear() async {
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
