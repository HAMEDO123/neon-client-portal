import SwiftUI

// Routine tasks: what somebody does every working day — the website's
// `components/admin/routines.tsx`, on the manager's Tasks page.
//
// Written once here; from then on each working day puts it on that person's
// list as an ordinary job — started, photographed, sent for review and
// approved like any other, and on the week board with everything else. So
// this screen only holds the standing instructions: who, what, how urgent,
// and whether it is still running.

// MARK: - The card on the Week segment

/// "Every day", under the week's summary: how many routines are running and
/// whose they are, opening the list. It lives on the week because that is
/// where the days a routine makes turn up.
struct RoutinesCard: View {
    @ObservedObject var store: TaskRoutinesStore
    /// The board's team, which the add form chooses from.
    let team: [TaskPerson]

    var body: some View {
        NavigationLink {
            RoutinesView(store: store, team: team)
        } label: {
            label
        }
        .buttonStyle(.pressableCard)
        .accessibilityHint(L("Opens the routine tasks"))
    }

    private var label: some View {
        let routines = store.value?.routines ?? []
        let running = routines.filter(\.active)
        let paused = routines.count - running.count
        // One face per person, in the list's order, however many routines
        // each of them has.
        var seen = Set<String>()
        let people = running.map(\.employee).filter { seen.insert($0.id).inserted }
        let hues = TasksTeamHues(team)

        return HStack(spacing: 12) {
            IconTile("repeat", hue: .indigo, size: NeonSize.iconTileLarge)
            VStack(alignment: .leading, spacing: 2) {
                Text(L("Every day"))
                    .font(.neonCardTitle)
                    .foregroundStyle(Color.neonInk)
                Text(summary(running: running.count, paused: paused))
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextSecondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if !people.isEmpty {
                // Overlapping faces, the first on top, mirrored in Arabic by
                // the stack itself.
                HStack(spacing: -10) {
                    ForEach(Array(people.prefix(3).enumerated()), id: \.element.id) { index, person in
                        TasksAvatar(name: person.name, hue: hues.hue(person.id, name: person.name, color: person.color),
                                    size: 30, ring: true, photo: facePhotoURL(person.photoUrl))
                            .zIndex(Double(10 - index))
                    }
                }
                .accessibilityHidden(true)
            }
            Image(systemName: "chevron.forward")
                .font(.system(.footnote, weight: .semibold))
                .foregroundStyle(Color.neonTextFaint)
        }
        .padding(NeonSpace.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .neonContextShape(radius: NeonRadius.lg)
    }

    /// Before the first answer the card says what a routine is, not "0".
    private func summary(running: Int, paused: Int) -> String {
        guard store.value != nil else { return L("Done every working day") }
        if running == 0 && paused == 0 { return L("No routine tasks yet.") }
        let line = running == 1 ? L("1 routine task, on the list each working day") : L("%d routine tasks, on the list each working day", running)
        return paused > 0 ? L("%@ · %d paused", line, paused) : line
    }
}

// MARK: - The list

/// Every routine, with pause, resume and remove; the floating button adds one.
struct RoutinesView: View {
    @EnvironmentObject var api: APIClient
    @ObservedObject var store: TaskRoutinesStore
    let team: [TaskPerson]

    @State private var adding = false
    @State private var removing: RoutineTask?

    var body: some View {
        NeonScroll(spacing: NeonSpace.stack) {
            LoadStateView(value: store.value, error: store.errorMessage, cachedAt: store.cachedAt, retry: { await store.load(api) }) {
                VStack(spacing: NeonSpace.stack) {
                    SkeletonCard(lines: 1)
                    SkeletonRows(count: 3)
                }
            } content: { data in
                list(data.routines)
                    // Room under the last row for the floating "New routine task".
                    .padding(.bottom, NeonSize.fab + NeonSpace.xl)
            }
        }
        .refreshable {
            Haptic.soft()
            await store.load(api)
        }
        .navigationTitle(L("Every day"))
        .navigationBarTitleDisplayMode(.inline)
        .floatingActionButton(label: L("New routine task"), isVisible: store.value != nil) {
            adding = true
        }
        .sheet(isPresented: $adding) {
            RoutineEditorSheet(team: team) { await store.load(api) }
        }
        .confirmDestructive(
            item: $removing,
            title: { _ in L("Remove this routine task?") },
            message: { _ in L("The days already handed out stay.") },
            actionTitle: L("Remove")
        ) { routine in
            Task { await remove(routine) }
        }
        .task { await store.load(api) }
    }

    @ViewBuilder
    private func list(_ routines: [RoutineTask]) -> some View {
        let hues = TasksTeamHues(team)
        SectionCard(
            L("Routine tasks"),
            subtitle: L("Done every working day"),
            symbol: "repeat", hue: .indigo
        ) {
            // The rest of the website's sentence, whole: a card's subtitle
            // stops at two lines, and this is the part that explains it.
            Text(L("Each one is put on that person's list every morning as a task of its own, due that day."))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if routines.isEmpty {
                EmptyState(symbol: "repeat", title: L("No routine tasks yet."),
                           detail: L("Add one, and it is on that person's list from today."),
                           actionTitle: L("Add a routine task"), action: { adding = true }, hue: .indigo)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(routines.enumerated()), id: \.element.id) { index, routine in
                        if index > 0 { NeonDivider().padding(.leading, 68) }
                        row(routine, hues: hues)
                            .staggered(index)
                    }
                }
                .padding(.horizontal, -NeonSpace.card + 2)
            }
        }
        .neonAppear()
    }

    private func row(_ routine: RoutineTask, hues: TasksTeamHues) -> some View {
        let person = routine.employee
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                TasksAvatar(name: person.name, hue: hues.hue(person.id, name: person.name, color: person.color), size: 42,
                            photo: facePhotoURL(person.photoUrl))
                VStack(alignment: .leading, spacing: 3) {
                    TasksRowTitle(routine.title, font: .system(.callout, weight: .semibold))
                    DirText(meta(routine), font: .system(.footnote), color: .neonTextSecondary, fill: false, lineLimit: 2)
                    if let acceptance = routine.acceptance?.trimmingCharacters(in: .whitespacesAndNewlines), !acceptance.isEmpty {
                        HStack(alignment: .firstTextBaseline, spacing: 5) {
                            Image(systemName: "checkmark.seal")
                                .font(.system(.caption2, weight: .semibold))
                                .foregroundStyle(Color.neonTextTertiary)
                                .accessibilityLabel(L("Counts as done when"))
                            DirText(acceptance, font: .system(.caption), color: .neonTextTertiary, fill: false, lineLimit: 2)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .trailing, spacing: 5) {
                    if routine.active {
                        BadgeView(text: L("On"), tone: .success, symbol: "repeat")
                    } else {
                        BadgeView(text: L("Paused"), tone: .neutral, symbol: "pause.fill")
                    }
                    // Medium is what a task is when nobody chose, so it is
                    // not a mark — the rule every task list here follows.
                    if routine.priority == "HIGH" {
                        TaskHighChip()
                    } else if routine.priority == "LOW" {
                        BadgeView(text: L("Low"), tone: .neutral)
                    }
                }
                .fixedSize()
            }
            // A paused routine stays readable but steps back; its buttons do not.
            .opacity(routine.active ? 1 : 0.55)

            HStack(spacing: 8) {
                NeonButton(routine.active ? L("Pause") : L("Resume"), symbol: routine.active ? "pause.fill" : "play.fill",
                           kind: .secondary, size: .small, fullWidth: false) {
                    await setActive(routine, !routine.active)
                }
                NeonButton(L("Remove"), symbol: "trash", kind: .ghost, size: .small, fullWidth: false) {
                    Haptic.tap()
                    removing = routine
                }
                .accessibilityLabel(L("Remove %@", routine.title))
                Spacer(minLength: 0)
            }
            .padding(.leading, 54)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 14)
        // The row wears its priority while it runs, as the jobs it makes do.
        .taskPriorityWash(routine.priority, state: routine.active ? "TODO" : "DONE", inset: 0)
    }

    /// The website's line under the title, word for word.
    private func meta(_ routine: RoutineTask) -> String {
        // The name is isolated, so a Latin name at the start of an Arabic
        // line does not turn the whole line left to right and scramble it.
        var line = L("%@ · every working day", "\u{2068}\(routine.employee.name)\u{2069}")
        if !routine.employee.active { line = L("%@ · this person's account is off", line) }
        return line
    }

    private func setActive(_ routine: RoutineTask, _ active: Bool) async {
        do {
            try await api.setRoutineActive(id: routine.id, active: active)
            Haptic.success()
            // Bringing one back puts today's on the list at once.
            Toast.success(active ? L("Resumed") : L("Paused"),
                          detail: active ? L("Today's is on the list, if the studio works today.") : L("It makes no more days. The ones it made stay."))
            await store.load(api)
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func remove(_ routine: RoutineTask) async {
        do {
            try await api.deleteRoutine(id: routine.id)
            Haptic.success()
            Toast.success(L("Removed"), detail: routine.title)
            await store.load(api)
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

// MARK: - Adding one

/// The website's add row, as a form: who, what, priority, and what counts
/// as done — the line each day's photo is checked against.
struct RoutineEditorSheet: View {
    let team: [TaskPerson]
    var onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss

    // Nobody until somebody is chosen, as on the job form: a required field
    // that starts filled in is met without anybody deciding.
    @State private var employeeId: String?
    @State private var title = ""
    @State private var priority = "MEDIUM"
    @State private var acceptance = ""
    @State private var note = ""

    private var isValid: Bool {
        employeeId != nil && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        SheetScaffold(L("New routine task"),
                      subtitle: L("Done every working day, as a task of its own"),
                      symbol: "repeat",
                      primaryTitle: L("Add"),
                      primaryKind: isValid ? .brand : .secondary,
                      isPrimaryEnabled: isValid,
                      onPrimary: { await save() }) {
            FormSection(L("Routine task")) {
                if team.isEmpty {
                    StatusNote(symbol: "person.crop.circle.badge.exclamationmark", tone: .warning, title: L("Nobody on the board yet"),
                               detail: L("Add the team in Settings, and their work shows here."))
                } else {
                    MenuField(L("Who does it"), selection: $employeeId, options: team.map(\.id),
                              title: { id in team.first { $0.id == id }?.name ?? id },
                              placeholder: L("Choose somebody"), leadingSymbol: "person", isRequired: true)
                }
                NeonTextField(L("Title"), text: $title, prompt: L("What is done every day"), symbol: "textformat", isRequired: true)
                MenuField(L("Priority"), selection: $priority, options: taskPriorities, title: localizedPriority)
                NeonTextEditor(L("Counts as done when"), text: $acceptance,
                               prompt: L("What the day's photo is checked against — optional"), minLines: 3,
                               limit: tasksLimit(acceptance, 2000))
                NeonTextEditor(L("Note"), text: $note, minLines: 2, limit: tasksLimit(note, 2000))
            }
            StatusNote(symbol: "calendar.badge.clock", tone: .info, title: L("On the list from today"),
                       detail: L("If the studio works today, today's is handed out as soon as it is added. A day the studio does not work makes none."))
        }
        .neonSheet([.large])
    }

    private func save() async {
        guard let employeeId else { return }
        do {
            try await api.createRoutine(form: [
                "employeeId": employeeId,
                "title": title,
                "acceptance": acceptance,
                "note": note,
                "priority": priority,
            ])
            Haptic.success()
            Toast.success(L("Added"), detail: L("Every working day, from today."))
            dismiss()
            await onSaved()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}
