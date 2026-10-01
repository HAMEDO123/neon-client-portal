import SwiftUI

/// The delivery process, pushed from Settings (and from the Tasks tab's
/// header): the parts of `/admin/settings` that define how work moves —
/// sections, steps, who is on the board, what each kind of work needs, and
/// the stage periods that turn steps into dates.
///
/// A `List`, so every row keeps its swipe actions: move up or down, open a
/// step's standard, delete (always asked first). A long press offers the
/// same moves.
struct ProcessSettingsView: View {
    @EnvironmentObject var api: APIClient
    @StateObject private var store = TaskProcessStore()

    @State private var addingSection = false
    @State private var editingSection: ProcessSection?
    @State private var addingStep = false
    @State private var editingStep: ProcessStep?
    @State private var editingStandard: ProcessStep?
    @State private var addingOwner = false
    @State private var editingOwner: ProcessMember?
    @State private var addingPeriod = false
    @State private var editingPeriod: StagePeriodRow?

    var body: some View {
        Group {
            if let process = store.value {
                list(process)
            } else if let error = store.errorMessage {
                ErrorState(message: error) { await store.load(api) }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .neonAmbientBackground()
            } else {
                NeonScroll(spacing: NeonSpace.stack) {
                    SkeletonCard(lines: 3)
                    SkeletonRows(count: 5)
                }
            }
        }
        .navigationTitle(L("Delivery process"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.load(api) }
        .sheet(isPresented: $addingSection) {
            ProcessSectionSheet(section: nil, existingIds: Set((store.value?.sections ?? []).map(\.id))) { await store.load(api) }
        }
        .sheet(item: $editingSection) { section in ProcessSectionSheet(section: section) { await store.load(api) } }
        .sheet(isPresented: $addingStep) { ProcessStepSheet(step: nil, process: store.value) { await store.load(api) } }
        .sheet(item: $editingStep) { step in ProcessStepSheet(step: step, process: store.value) { await store.load(api) } }
        .sheet(item: $editingStandard) { step in ProcessTaskTypeSheet(step: step, team: store.value?.team ?? []) { await store.load(api) } }
        .sheet(isPresented: $addingOwner) {
            ProcessOwnerSheet(owner: nil, existingIds: Set((store.value?.team ?? []).map(\.id))) { await store.load(api) }
        }
        .sheet(item: $editingOwner) { owner in ProcessOwnerSheet(owner: owner) { await store.load(api) } }
        .sheet(isPresented: $addingPeriod) { ProcessPeriodSheet(period: nil, steps: store.value?.steps ?? []) { await store.load(api) } }
        .sheet(item: $editingPeriod) { period in ProcessPeriodSheet(period: period, steps: store.value?.steps ?? []) { await store.load(api) } }
    }

    private func list(_ process: ProcessResponse) -> some View {
        ScrollViewReader { proxy in
            List {
                Group {
                    if let cachedAt = store.cachedAt {
                        OfflineBanner(savedAt: cachedAt)
                    }
                    if process.totalDays > 0 {
                        timeline(process)
                    }
                    standardsNote(process)
                }
                .neonListRow(top: 6, bottom: 6)

                sectionsBlock(process)
                stepsBlock(process)
                ownersBlock(process)
                periodsBlock(process)

                Text(L("Swipe a row for more: move it, open its standard, or delete it. A long press offers the same."))
                    .font(.neonMeta)
                    .foregroundStyle(Color.neonTextTertiary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .multilineTextAlignment(.center)
                    .neonListRow(top: 14, bottom: 30)
            }
            .neonListStyle()
            .refreshable { await store.load(api) }
            #if DEBUG
            .debugScroll(proxy)
            #endif
        }
    }

    // MARK: - The top

    /// The stage periods laid end to end: how the timed part of the process
    /// splits its days. (How many sections, steps and owners there are is
    /// said once, on each list's own heading below.)
    private func timeline(_ process: ProcessResponse) -> some View {
        SectionCard(L("Timed process"), subtitle: L("%d days", process.totalDays), symbol: "timer", hue: .orange) {
            let parts = process.timeline.enumerated().map { index, range in
                ProgressSegment(range.fromTaskId == range.toTaskId ? stepName(range.fromTaskId, process)
                                    : tasksArrowJoin(stepName(range.fromTaskId, process), stepName(range.toTaskId, process)),
                                value: Double(range.days), hue: NeonPalette.hue(at: index), id: range.id)
            }
            SegmentedProgressBar(parts, height: 12)
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(process.timeline.enumerated()), id: \.element.id) { index, range in
                    HStack(spacing: 8) {
                        Circle().fill(NeonPalette.hue(at: index).color).frame(width: 8, height: 8)
                        DirText(parts[index].label, font: .neonSubtitle, color: .neonTextSecondary, fill: false, lineLimit: 1)
                        Spacer(minLength: 6)
                        Text(L("Day %d–%d", range.startDay, range.endDay))
                            .font(.system(.caption, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(Color.neonTextTertiary)
                    }
                }
            }
        }
    }

    /// Steps nobody has written a standard for, and a way to start on the
    /// first of them, in the order the process runs.
    @ViewBuilder
    private func standardsNote(_ process: ProcessResponse) -> some View {
        let unset = orderedSteps(process).filter { $0.deliverable == nil && $0.acceptance == nil }
        if let first = unset.first {
            VStack(alignment: .leading, spacing: NeonSpace.sm) {
                StatusNote(symbol: "exclamationmark.triangle.fill", tone: .warning,
                           title: unset.count == 1 ? L("1 step has no standard") : L("%d steps have no standard", unset.count),
                           detail: L("Nothing says what finishing them means, so proof sent for them has nothing to be checked against."))
                NeonButton(L("Write the first one"), symbol: "square.and.pencil", kind: .tinted(.neonOrangeStrong), size: .small) {
                    editingStandard = first
                }
                .accessibilityHint(Text(first.name))
            }
        }
    }

    private func stepName(_ id: String, _ process: ProcessResponse) -> String {
        process.steps.first { $0.id == id }?.name ?? id
    }

    /// Every step in the order a project meets them: section by section, then
    /// any not in a section.
    private func orderedSteps(_ process: ProcessResponse) -> [ProcessStep] {
        process.sections.flatMap { section in
            process.steps.filter { $0.sectionId == section.id }.sorted { $0.order < $1.order }
        } + process.steps.filter { $0.sectionId == nil }.sorted { $0.order < $1.order }
    }

    /// A list's heading, with its count and its own + to add one more.
    private func header(_ title: String, subtitle: String, count: Int, anchor: String, addLabel: String, add: @escaping () -> Void) -> some View {
        SectionHeader(title, subtitle: subtitle, count: count) {
            IconButton("plus", label: addLabel, look: .tinted, tint: .neonIndigoStrong) {
                Haptic.tap()
                add()
            }
        }
        .neonListRow(top: 18, bottom: 6)
        .id(anchor)
    }

    // MARK: - Sections

    @ViewBuilder
    private func sectionsBlock(_ process: ProcessResponse) -> some View {
        Section {
            header(L("Sections"), subtitle: L("How the steps are grouped on the board"), count: process.sections.count,
                   anchor: "sections", addLabel: L("Add a section")) { addingSection = true }
            ForEach(Array(process.sections.enumerated()), id: \.element.id) { index, section in
                sectionRow(section, steps: process.steps.filter { $0.sectionId == section.id }.count,
                           position: .of(index, in: process.sections.count))
            }
        }
    }

    @ViewBuilder
    private func sectionRow(_ section: ProcessSection, steps: Int, position: TasksGroupPosition) -> some View {
        let hue = tasksColorHue(section.color, fallback: .indigo)
        Button { editingSection = section } label: {
            ListRow(section.name, subtitle: steps == 1 ? L("1 step") : L("%d steps", steps),
                    leading: .icon("square.stack.3d.up.fill", tint: hue.color), chevron: true)
                .tasksGroupedRow(position)
        }
        .buttonStyle(.pressableCard)
        .neonListRow(top: 0, bottom: 0)
        .destructiveSwipe(L("Delete"), confirm: L("Delete \"%@\"?", section.name), message: L("Its steps survive, ungrouped.")) {
            Task { await run { try await api.deleteSection(id: section.id) } }
        }
        .swipeAction(L("Up"), symbol: "arrow.up", edge: .leading) { move { try await api.moveSection(id: section.id, direction: "left") } }
        .swipeAction(L("Down"), symbol: "arrow.down", tint: .neonTextTertiary) { move { try await api.moveSection(id: section.id, direction: "right") } }
        .contextMenu {
            Button { editingSection = section } label: { Label(L("Edit section"), systemImage: "pencil") }
            Button { move { try await api.moveSection(id: section.id, direction: "left") } } label: { Label(L("Up"), systemImage: "arrow.up") }
            Button { move { try await api.moveSection(id: section.id, direction: "right") } } label: { Label(L("Down"), systemImage: "arrow.down") }
        }
    }

    // MARK: - Steps

    /// The steps as one card per section, under the section's name — rows
    /// with hairlines between them, each keeping its own swipes.
    @ViewBuilder
    private func stepsBlock(_ process: ProcessResponse) -> some View {
        Section {
            header(L("Steps"), subtitle: L("Every project goes through these"), count: process.steps.count,
                   anchor: "steps", addLabel: L("Add a step")) { addingStep = true }
            ForEach(process.sections) { section in
                let steps = process.steps.filter { $0.sectionId == section.id }.sorted { $0.order < $1.order }
                if !steps.isEmpty {
                    let hue = tasksColorHue(section.color, fallback: .indigo)
                    groupLabel(section.name, hue: hue)
                    ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                        stepRow(step, process: process, hue: hue, position: .of(index, in: steps.count))
                    }
                }
            }
            let loose = process.steps.filter { $0.sectionId == nil }.sorted { $0.order < $1.order }
            if !loose.isEmpty {
                groupLabel(L("Not in a section"), hue: .grey)
                ForEach(Array(loose.enumerated()), id: \.element.id) { index, step in
                    stepRow(step, process: process, hue: .indigo, position: .of(index, in: loose.count))
                }
            }
        }
    }

    private func groupLabel(_ name: String, hue: NeonHue) -> some View {
        HStack(spacing: 7) {
            Circle().fill(hue == .grey ? hue.gradient[1] : hue.color).frame(width: 8, height: 8)
            DirText(name, font: .system(.caption, weight: .bold), color: .neonTextSecondary, fill: false, lineLimit: 1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 4)
        .accessibilityAddTraits(.isHeader)
        .neonListRow(top: 12, bottom: 6)
    }

    @ViewBuilder
    private func stepRow(_ step: ProcessStep, process: ProcessResponse, hue: NeonHue, position: TasksGroupPosition) -> some View {
        let owner = process.team.first { $0.id == step.ownerId }
        let unset = step.deliverable == nil && step.acceptance == nil
        let meta = [
            step.estimateHours.map { L("%@h", NeonFormat.number($0, decimals: 1)) },
            step.acceptanceLines.isEmpty ? nil : (step.acceptanceLines.count == 1 ? L("1 check") : L("%d checks", step.acceptanceLines.count)),
            step.autoAccept && step.mayAutoAccept ? L("Accepted automatically") : nil,
        ].compactMap { $0 }.joined(separator: " · ")
        Button { editingStep = step } label: {
            HStack(spacing: 12) {
                IconTile("checklist", hue: hue, size: NeonSize.iconTile)
                VStack(alignment: .leading, spacing: 3) {
                    // The name has the row's whole width; what is missing
                    // is said after the owner, not in a badge beside it.
                    TasksRowTitle(step.name, font: .system(.callout, weight: .semibold))
                    HStack(spacing: 8) {
                        DirText(owner?.name ?? L("Nobody set"), font: .system(.footnote), color: .neonTextSecondary, fill: false, lineLimit: 1)
                        if unset {
                            MetaLabel(L("No standard"), symbol: "exclamationmark.triangle.fill", tint: .neonOrangeStrong)
                        }
                    }
                    if !meta.isEmpty {
                        Text(meta)
                            .font(.system(.caption, weight: .medium))
                            .foregroundStyle(Color.neonTextTertiary)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.forward")
                    .font(.system(.footnote, weight: .semibold))
                    .foregroundStyle(Color.neonTextFaint)
            }
            .padding(.vertical, 11)
            .padding(.horizontal, 14)
            .contentShape(Rectangle())
            .tasksGroupedRow(position)
        }
        .buttonStyle(.pressableCard)
        .neonListRow(top: 0, bottom: 0)
        .destructiveSwipe(L("Delete"), confirm: L("Delete \"%@\"?", step.name)) {
            Task { await run { try await api.deleteStep(id: step.id) } }
        }
        .swipeAction(L("Standard"), symbol: "doc.text", edge: .leading) { editingStandard = step }
        .contextMenu {
            Button { editingStep = step } label: { Label(L("Edit step"), systemImage: "pencil") }
            Button { editingStandard = step } label: { Label(L("What this kind of work needs"), systemImage: "doc.text") }
        }
    }

    // MARK: - Owners

    @ViewBuilder
    private func ownersBlock(_ process: ProcessResponse) -> some View {
        let inactive = process.team.filter { !$0.active }.count
        // Colours are the board's: worked out over the active team, as every
        // other screen of the area does.
        let hues = TasksTeamHues(process.team.filter(\.active))
        Section {
            header(L("Owners"), subtitle: inactive > 0 ? L("Who is on the board · %d inactive", inactive) : L("Who is on the board"),
                   count: process.team.count, anchor: "owners", addLabel: L("Add somebody")) { addingOwner = true }
            ForEach(Array(process.team.enumerated()), id: \.element.id) { index, member in
                ownerRow(member, steps: process.steps.filter { $0.ownerId == member.id }.count,
                         hue: hues.hue(member), position: .of(index, in: process.team.count))
            }
        }
    }

    @ViewBuilder
    private func ownerRow(_ member: ProcessMember, steps: Int, hue: NeonHue, position: TasksGroupPosition) -> some View {
        let role = member.role.flatMap { $0.isEmpty ? nil : $0 }
        Button { editingOwner = member } label: {
            HStack(spacing: 12) {
                TasksAvatar(name: member.name, hue: hue, size: NeonSize.iconTile, photo: facePhotoURL(member.photoUrl))
                    .opacity(member.active ? 1 : 0.55)
                VStack(alignment: .leading, spacing: 3) {
                    DirText(member.name, font: .system(.callout, weight: .semibold), fill: false, lineLimit: 1)
                    if let role {
                        DirText(role, font: .system(.footnote), color: .neonTextSecondary, fill: false, lineLimit: 1)
                    }
                    Text(steps == 0 ? L("No steps yet") : (steps == 1 ? L("Usual owner of 1 step") : L("Usual owner of %d steps", steps)))
                        .font(.system(.caption, weight: .medium))
                        .foregroundStyle(Color.neonTextTertiary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if !member.active {
                    BadgeView(text: L("Inactive"), tone: .neutral)
                }
                Image(systemName: "chevron.forward")
                    .font(.system(.footnote, weight: .semibold))
                    .foregroundStyle(Color.neonTextFaint)
            }
            .padding(.vertical, 11)
            .padding(.horizontal, 14)
            .contentShape(Rectangle())
            .tasksGroupedRow(position)
        }
        .buttonStyle(.pressableCard)
        .neonListRow(top: 0, bottom: 0)
        .destructiveSwipe(L("Delete"), confirm: L("Delete %@?", member.name), message: L("Their steps survive, unassigned.")) {
            Task { await run { try await api.deleteOwner(id: member.id) } }
        }
        .swipeAction(L("Up"), symbol: "arrow.up", edge: .leading) { move { try await api.moveOwner(id: member.id, direction: "left") } }
        .swipeAction(L("Down"), symbol: "arrow.down", tint: .neonTextTertiary) { move { try await api.moveOwner(id: member.id, direction: "right") } }
        .contextMenu {
            Button { editingOwner = member } label: { Label(L("Edit %@", member.name), systemImage: "pencil") }
            Button { move { try await api.moveOwner(id: member.id, direction: "left") } } label: { Label(L("Up"), systemImage: "arrow.up") }
            Button { move { try await api.moveOwner(id: member.id, direction: "right") } } label: { Label(L("Down"), systemImage: "arrow.down") }
        }
    }

    // MARK: - Stage periods

    /// The periods in the order they chain — the timed process card's order
    /// above — with any the timeline doesn't reach after them.
    private func chained(_ process: ProcessResponse) -> [StagePeriodRow] {
        let start = Dictionary(process.timeline.compactMap { range in range.periodId.map { ($0, range.startDay) } },
                               uniquingKeysWith: { first, _ in first })
        return process.periods.enumerated().sorted { a, b in
            switch (start[a.element.id], start[b.element.id]) {
            case let (x?, y?): return x == y ? a.offset < b.offset : x < y
            case (.some, .none): return true
            case (.none, .some): return false
            case (.none, .none): return a.offset < b.offset
            }
        }.map(\.element)
    }

    @ViewBuilder
    private func periodsBlock(_ process: ProcessResponse) -> some View {
        let periods = chained(process)
        Section {
            header(L("Stage periods"), subtitle: L("How long a range of steps may take"), count: periods.count,
                   anchor: "periods", addLabel: L("Add a stage period")) { addingPeriod = true }
            ForEach(Array(periods.enumerated()), id: \.element.id) { index, period in
                periodRow(period, process: process, position: .of(index, in: periods.count))
            }
            Text(L("A range of steps and the days it is allowed to take. Ranges chain, so the whole process carries dates without anyone typing one on a project."))
                .font(.neonMeta)
                .foregroundStyle(Color.neonTextTertiary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 4)
                .neonListRow(top: 10, bottom: 4)
        }
    }

    @ViewBuilder
    private func periodRow(_ period: StagePeriodRow, process: ProcessResponse, position: TasksGroupPosition) -> some View {
        let from = stepName(period.fromTaskId, process)
        let to = stepName(period.toTaskId, process)
        Button { editingPeriod = period } label: {
            ListRow(from == to ? from : tasksArrowJoin(from, to),
                    leading: .icon("calendar.badge.clock", tint: .neonOrange),
                    value: period.days == 1 ? L("1 day") : L("%d days", period.days), chevron: true)
                .tasksGroupedRow(position)
        }
        .buttonStyle(.pressableCard)
        .neonListRow(top: 0, bottom: 0)
        .destructiveSwipe(L("Delete"), confirm: L("Delete this stage period?")) {
            Task { await run { try await api.deletePeriod(id: period.id) } }
        }
        .contextMenu {
            Button { editingPeriod = period } label: { Label(L("Edit stage period"), systemImage: "pencil") }
        }
    }

    // MARK: - Doing

    /// A move, then the list again — and the server's own sentence if it refuses.
    private func move(_ action: @escaping () async throws -> Void) {
        Task {
            await run(action)
            Haptic.selection()
        }
    }

    private func run(_ action: () async throws -> Void) async {
        do {
            try await action()
        } catch {
            Toast.error(error)
        }
        await store.load(api)
    }
}

// MARK: - Sheets

/// The four colours a section can wear on the board — `EMPLOYEE_COLORS`.
let processSectionColors = ["cyan", "purple", "pink", "orange"]

func processColorName(_ color: String) -> String {
    switch color {
    case "cyan": return L("Cyan")
    case "purple": return L("Purple")
    case "pink": return L("Pink")
    case "orange": return L("Orange")
    default: return color
    }
}

struct ProcessSectionSheet: View {
    let section: ProcessSection?
    /// The sections there are now, so the one just made can be found again.
    var existingIds: Set<String> = []
    let onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    /// Nil on a new section until a colour is chosen: the server then picks.
    @State private var color: String?

    init(section: ProcessSection?, existingIds: Set<String> = [], onSaved: @escaping () async -> Void) {
        self.section = section
        self.existingIds = existingIds
        self.onSaved = onSaved
        _name = State(initialValue: section?.name ?? "")
        _color = State(initialValue: section?.color)
    }

    private var isValid: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        SheetScaffold(section == nil ? L("New section") : L("Edit section"),
                      subtitle: L("A group of steps on the board"),
                      symbol: "square.stack.3d.up.fill",
                      primaryTitle: L("Save"), primaryKind: isValid ? .primary : .secondary, isPrimaryEnabled: isValid,
                      onPrimary: { await save() }) {
            FormSection(footer: section == nil && color == nil ? L("Leave it, and a colour is picked for it.") : nil) {
                NeonTextField(L("Name"), text: $name, prompt: L("Design, Drawings, Site…"), symbol: "textformat", isRequired: true)
                FormField(L("Colour")) {
                    HStack(spacing: NeonSpace.md) {
                        ForEach(processSectionColors, id: \.self) { option in
                            swatch(option)
                        }
                        Spacer(minLength: 0)
                    }
                }
            }
        }
        .neonSheet(tasksShortSheet)
    }

    private func swatch(_ option: String) -> some View {
        let hue = tasksColorHue(option)
        let selected = option == color
        return Button {
            Haptic.selection()
            withNeonAnimation(NeonMotion.snappy) { color = option }
        } label: {
            ZStack {
                Circle().fill(hue.fill)
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(.subheadline, weight: .bold))
                        .foregroundStyle(.white)
                        .transition(.neonPop)
                }
            }
            .frame(width: 40, height: 40)
            .padding(3)
            .overlay(Circle().strokeBorder(selected ? hue.color : Color.clear, lineWidth: 2))
            .neonShadow(selected ? .glow(hue.color) : .none)
        }
        .buttonStyle(PressableStyle(scale: 0.9))
        .accessibilityLabel(Text(processColorName(option)))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func save() async {
        let name = name.trimmingCharacters(in: .whitespaces)
        do {
            if let section {
                try await api.updateSection(id: section.id, name: name, color: color ?? section.color)
            } else {
                try await api.createSection(name: name)
                // Making a section takes a name only; a colour chosen here is
                // written onto the new section straight after.
                if let color {
                    let made = try await api.fetchTaskProcess().value.sections
                        .first { !existingIds.contains($0.id) && $0.name == name }
                    if let made, made.color != color {
                        try await api.updateSection(id: made.id, name: name, color: color)
                    }
                }
            }
            await onSaved()
            Toast.success(L("Saved"))
            dismiss()
        } catch {
            await onSaved()
            Toast.error(error)
        }
    }
}

struct ProcessStepSheet: View {
    let step: ProcessStep?
    let process: ProcessResponse?
    let onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var ownerId: String?
    @State private var sectionId: String?

    init(step: ProcessStep?, process: ProcessResponse?, onSaved: @escaping () async -> Void) {
        self.step = step
        self.process = process
        self.onSaved = onSaved
        _name = State(initialValue: step?.name ?? "")
        _ownerId = State(initialValue: step?.ownerId)
        _sectionId = State(initialValue: step?.sectionId)
    }

    private var isValid: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        SheetScaffold(step == nil ? L("New step") : L("Edit step"),
                      subtitle: L("A step every project goes through"),
                      symbol: "checklist",
                      primaryTitle: L("Save"), primaryKind: isValid ? .primary : .secondary, isPrimaryEnabled: isValid,
                      onPrimary: { await save() }) {
            FormSection {
                NeonTextField(L("Name"), text: $name, prompt: L("What the step is called"), symbol: "textformat", isRequired: true)
                MenuField(L("Section"), selection: $sectionId, options: (process?.sections ?? []).map(\.id),
                          title: { id in process?.sections.first { $0.id == id }?.name ?? id },
                          placeholder: L("None"), noneTitle: L("None"), leadingSymbol: "square.stack.3d.up")
                MenuField(L("Usual owner"), selection: $ownerId, options: (process?.team ?? []).map(\.id),
                          title: { id in process?.team.first { $0.id == id }?.name ?? id },
                          placeholder: L("Nobody set"), noneTitle: L("Nobody set"), leadingSymbol: "person")
            }
        }
        .neonSheet(tasksShortSheet)
    }

    private func save() async {
        do {
            if let step {
                try await api.updateStep(id: step.id, name: name, employeeId: ownerId, sectionId: sectionId)
            } else {
                try await api.createStep(name: name, employeeId: ownerId, sectionId: sectionId)
            }
            await onSaved()
            Toast.success(L("Saved"))
            dismiss()
        } catch { Toast.error(error) }
    }
}

/// "What each kind of work needs" — a step's own standard: what is handed in,
/// what counts as finished, the proof, the checklist, the hours, the reviewer.
struct ProcessTaskTypeSheet: View {
    let step: ProcessStep
    let team: [ProcessMember]
    let onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var deliverable: String
    @State private var acceptance: String
    @State private var evidence: String
    @State private var checklist: String
    @State private var estimateHours: Double?
    @State private var autoAccept: Bool
    @State private var reviewerId: String?

    init(step: ProcessStep, team: [ProcessMember], onSaved: @escaping () async -> Void) {
        self.step = step
        self.team = team
        self.onSaved = onSaved
        _deliverable = State(initialValue: step.deliverable ?? "")
        _acceptance = State(initialValue: step.acceptance ?? "")
        _evidence = State(initialValue: step.evidence ?? "")
        _checklist = State(initialValue: step.checklist ?? "")
        _estimateHours = State(initialValue: step.estimateHours)
        _autoAccept = State(initialValue: step.autoAccept)
        _reviewerId = State(initialValue: step.reviewerId)
    }

    /// What the standard holds so far, under its name: how many lines are
    /// checked, and how long the checklist is.
    private var checksLine: String {
        let checks = step.acceptanceLines.count
        var line = checks == 0 ? L("No checks written yet") : (checks == 1 ? L("1 check") : L("%d checks", checks))
        if step.checklistLines > 0 { line += " · " + L("%d on the checklist", step.checklistLines) }
        return line
    }

    var body: some View {
        SheetScaffold(step.name, subtitle: checksLine, symbol: "doc.text.fill",
                      primaryTitle: L("Save"), onPrimary: { await save() }) {
            FormSection(L("Deliverable & acceptance"), footer: L("Each line under \"Counts as done when\" is checked on its own when the proof arrives.")) {
                NeonTextEditor(L("What to hand in"), text: $deliverable, prompt: L("The file or photo that is handed in"), minLines: 2,
                               limit: tasksLimit(deliverable, 2000))
                NeonTextEditor(L("Counts as done when"), text: $acceptance, prompt: L("One line per item"), minLines: 3,
                               limit: tasksLimit(acceptance, 4000))
                NumberField(L("Estimate"), value: $estimateHours, unit: L("h"), decimals: 1, prompt: L("e.g. 3"))
            }
            FormSection(L("Proof")) {
                NeonTextEditor(L("What proof to send"), text: $evidence, prompt: L("What the photo or file has to show"), minLines: 2,
                               limit: tasksLimit(evidence, 2000))
                NeonTextEditor(L("Checklist"), text: $checklist, prompt: L("A reminder, one line per item"), minLines: 2,
                               limit: tasksLimit(checklist, 4000))
            }
            FormSection(L("Review")) {
                MenuField(L("Reviewer"), selection: $reviewerId, options: team.map(\.id),
                          title: { id in team.first { $0.id == id }?.name ?? id },
                          placeholder: L("Nobody set"), noneTitle: L("Nobody set"), leadingSymbol: "person.crop.circle.badge.checkmark")
                ToggleRow(L("Accept automatically"), detail: step.mayAutoAccept ? nil : L("Needs acceptance criteria written above first."),
                          symbol: "wand.and.stars", isOn: $autoAccept)
                    .disabled(!step.mayAutoAccept && !autoAccept)
            }
        }
        .neonSheet([.large])
    }

    private func save() async {
        let form: [String: Any] = [
            "deliverable": deliverable,
            "acceptance": acceptance,
            "evidence": evidence,
            "checklist": checklist,
            "estimateHours": estimateHours.map { String($0) } ?? "",
            "autoAccept": autoAccept ? "on" : "",
            "reviewerId": reviewerId ?? "",
        ]
        do {
            try await api.saveTaskType(id: step.id, form: form)
            await onSaved()
            Toast.success(L("Saved"))
            dismiss()
        } catch { Toast.error(error) }
    }
}

struct ProcessOwnerSheet: View {
    let owner: ProcessMember?
    /// Who is on the list now, so somebody just added can be found again.
    var existingIds: Set<String> = []
    let onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var role: String

    init(owner: ProcessMember?, existingIds: Set<String> = [], onSaved: @escaping () async -> Void) {
        self.owner = owner
        self.existingIds = existingIds
        self.onSaved = onSaved
        _name = State(initialValue: owner?.name ?? "")
        _role = State(initialValue: owner?.role ?? "")
    }

    private var isValid: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        SheetScaffold(owner.map { L("Edit %@", $0.name) } ?? L("Add somebody"),
                      subtitle: L("Somebody who owns steps on the board"),
                      symbol: "person.fill",
                      primaryTitle: L("Save"), primaryKind: isValid ? .primary : .secondary, isPrimaryEnabled: isValid,
                      onPrimary: { await save() }) {
            FormSection {
                NeonTextField(L("Name"), text: $name, prompt: L("Their name"), symbol: "person", isRequired: true)
                NeonTextField(L("Role"), text: $role, prompt: L("Optional"), symbol: "briefcase")
            }
        }
        .neonSheet(tasksShortSheet)
    }

    private func save() async {
        let name = name.trimmingCharacters(in: .whitespaces)
        let role = role.trimmingCharacters(in: .whitespaces)
        do {
            if let owner {
                try await api.updateOwner(id: owner.id, name: name, role: role)
            } else {
                try await api.createOwner(name: name)
                // Adding takes a name only (`createEmployee(name)`); a role
                // typed here is written onto them straight after.
                if !role.isEmpty {
                    let added = try await api.fetchTaskProcess().value.team
                        .first { !existingIds.contains($0.id) && $0.name == name }
                    if let added {
                        try await api.updateOwner(id: added.id, name: name, role: role)
                    }
                }
            }
            await onSaved()
            Toast.success(L("Saved"))
            dismiss()
        } catch {
            await onSaved()
            Toast.error(error)
        }
    }
}

struct ProcessPeriodSheet: View {
    let period: StagePeriodRow?
    let steps: [ProcessStep]
    let onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var fromTaskId: String?
    @State private var toTaskId: String?
    @State private var days: Double?

    init(period: StagePeriodRow?, steps: [ProcessStep], onSaved: @escaping () async -> Void) {
        self.period = period
        self.steps = steps
        self.onSaved = onSaved
        // A new period starts with nothing chosen: both ends are a decision,
        // and "Site visit to Site visit" filled in for you is not one.
        _fromTaskId = State(initialValue: period?.fromTaskId)
        _toTaskId = State(initialValue: period?.toTaskId)
        _days = State(initialValue: period.map { Double($0.days) })
    }

    private var isValid: Bool { fromTaskId != nil && toTaskId != nil && (days ?? 0) > 0 }

    var body: some View {
        SheetScaffold(period == nil ? L("New stage period") : L("Edit stage period"),
                      subtitle: L("How long a range of steps may take"),
                      symbol: "calendar.badge.clock",
                      primaryTitle: L("Save"), primaryKind: isValid ? .primary : .secondary, isPrimaryEnabled: isValid,
                      onPrimary: { await save() }) {
            FormSection(footer: L("Every step from the first to the last shares this deadline.")) {
                MenuField(L("First step"), selection: $fromTaskId, options: steps.map(\.id),
                          title: { id in steps.first { $0.id == id }?.name ?? id },
                          placeholder: L("Choose the first step"), leadingSymbol: "flag", isRequired: true)
                MenuField(L("Last step"), selection: $toTaskId, options: steps.map(\.id),
                          title: { id in steps.first { $0.id == id }?.name ?? id },
                          placeholder: L("Choose the last step"), leadingSymbol: "flag.checkered", isRequired: true)
                NumberField(L("Days"), value: $days, unit: L("days"), decimals: 0, prompt: "—", isRequired: true)
            }
        }
        .neonSheet(tasksShortSheet)
    }

    private func save() async {
        guard let fromTaskId, let toTaskId, let days else { return }
        let form: [String: Any] = ["fromTaskId": fromTaskId, "toTaskId": toTaskId, "days": String(Int(days))]
        do {
            try await api.savePeriod(form: form)
            await onSaved()
            Toast.success(L("Saved"))
            dismiss()
        } catch { Toast.error(error) }
    }
}
