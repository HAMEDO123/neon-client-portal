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
                    StatGrid(columns: 3) {
                        ForEach(0..<3, id: \.self) { _ in SkeletonKPICard(compact: true) }
                    }
                    SkeletonRows(count: 5)
                }
            }
        }
        .navigationTitle(L("Delivery process"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.load(api) }
        .sheet(isPresented: $addingSection) { ProcessSectionSheet(section: nil) { await store.load(api) } }
        .sheet(item: $editingSection) { section in ProcessSectionSheet(section: section) { await store.load(api) } }
        .sheet(isPresented: $addingStep) { ProcessStepSheet(step: nil, process: store.value) { await store.load(api) } }
        .sheet(item: $editingStep) { step in ProcessStepSheet(step: step, process: store.value) { await store.load(api) } }
        .sheet(item: $editingStandard) { step in ProcessTaskTypeSheet(step: step, team: store.value?.team ?? []) { await store.load(api) } }
        .sheet(isPresented: $addingOwner) { ProcessOwnerSheet(owner: nil) { await store.load(api) } }
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
                    summary(process)
                    if process.totalDays > 0 {
                        timeline(process)
                    }
                    let unset = process.steps.filter { $0.deliverable == nil && $0.acceptance == nil }.count
                    if unset > 0 {
                        StatusNote(symbol: "exclamationmark.triangle.fill", tone: .warning,
                                   title: L("%d steps have no standard", unset),
                                   detail: L("Nothing says what finishing them means, so proof sent for them has nothing to be checked against."))
                    }
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

    // MARK: - Summary

    private func summary(_ process: ProcessResponse) -> some View {
        StatGrid(columns: 3) {
            KPICard(L("Sections"), value: Double(process.sections.count), symbol: "square.stack.3d.up.fill", hue: .cyan, density: .compact)
            KPICard(L("Steps"), value: Double(process.steps.count), symbol: "checklist", hue: .purple, density: .compact)
            KPICard(L("Owners"), value: Double(process.team.filter(\.active).count), symbol: "person.2.fill", hue: .pink,
                    caption: process.team.contains { !$0.active } ? L("%d inactive", process.team.filter { !$0.active }.count) : nil,
                    density: .compact)
        }
    }

    /// The stage periods laid end to end: how the timed part of the process
    /// splits its days.
    private func timeline(_ process: ProcessResponse) -> some View {
        SectionCard(L("Timed process"), subtitle: L("%d days", process.totalDays), symbol: "timer", hue: .orange) {
            let parts = process.timeline.enumerated().map { index, range in
                ProgressSegment(stepName(range.fromTaskId, process) + (range.fromTaskId == range.toTaskId ? "" : " → " + stepName(range.toTaskId, process)),
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

    private func stepName(_ id: String, _ process: ProcessResponse) -> String {
        process.steps.first { $0.id == id }?.name ?? id
    }

    private func header(_ title: String, subtitle: String, count: Int, anchor: String) -> some View {
        SectionHeader(title, subtitle: subtitle, count: count)
            .neonListRow(top: 18, bottom: 4)
            .id(anchor)
    }

    // MARK: - Sections

    @ViewBuilder
    private func sectionsBlock(_ process: ProcessResponse) -> some View {
        Section {
            header(L("Sections"), subtitle: L("How the steps are grouped on the board"), count: process.sections.count, anchor: "sections")
            ForEach(process.sections) { section in
                sectionRow(section, steps: process.steps.filter { $0.sectionId == section.id }.count)
            }
            Button { addingSection = true } label: { TasksAddRow(title: L("Add a section"), hue: .cyan) }
                .buttonStyle(.pressableCard)
                .neonListRow()
        }
    }

    @ViewBuilder
    private func sectionRow(_ section: ProcessSection, steps: Int) -> some View {
        let hue = tasksColorHue(section.color, fallback: .indigo)
        Button { editingSection = section } label: {
            ListRow(section.name, subtitle: steps == 1 ? L("1 step") : L("%d steps", steps),
                    leading: .icon("square.stack.3d.up.fill", tint: hue.color), chevron: true)
                .rowCard()
        }
        .buttonStyle(.pressableCard)
        .neonListRow()
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

    @ViewBuilder
    private func stepsBlock(_ process: ProcessResponse) -> some View {
        Section {
            header(L("Steps"), subtitle: L("Every project goes through these"), count: process.steps.count, anchor: "steps")
            ForEach(process.sections) { section in
                let steps = process.steps.filter { $0.sectionId == section.id }.sorted { $0.order < $1.order }
                if !steps.isEmpty {
                    groupLabel(section.name, hue: tasksColorHue(section.color, fallback: .indigo))
                    ForEach(steps) { step in stepRow(step, process: process, hue: tasksColorHue(section.color, fallback: .indigo)) }
                }
            }
            let loose = process.steps.filter { $0.sectionId == nil }.sorted { $0.order < $1.order }
            if !loose.isEmpty {
                groupLabel(L("Not in a section"), hue: .grey)
                ForEach(loose) { step in stepRow(step, process: process, hue: .indigo) }
            }
            Button { addingStep = true } label: { TasksAddRow(title: L("Add a step"), hue: .purple) }
                .buttonStyle(.pressableCard)
                .neonListRow()
        }
    }

    private func groupLabel(_ name: String, hue: NeonHue) -> some View {
        HStack(spacing: 7) {
            Circle().fill(hue == .grey ? hue.gradient[1] : hue.color).frame(width: 8, height: 8)
            DirText(name, font: .system(.caption, weight: .bold), color: .neonTextSecondary, fill: false, lineLimit: 1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 4)
        .neonListRow(top: 10, bottom: 2)
    }

    @ViewBuilder
    private func stepRow(_ step: ProcessStep, process: ProcessResponse, hue: NeonHue) -> some View {
        let owner = process.team.first { $0.id == step.ownerId }
        let meta = [
            step.estimateHours.map { L("%@h", NeonFormat.number($0, decimals: 1)) },
            step.acceptanceLines.isEmpty ? nil : (step.acceptanceLines.count == 1 ? L("1 check") : L("%d checks", step.acceptanceLines.count)),
            step.autoAccept && step.mayAutoAccept ? L("Accepted automatically") : nil,
        ].compactMap { $0 }.joined(separator: " · ")
        Button { editingStep = step } label: {
            ListRow(step.name, subtitle: owner?.name ?? L("Nobody set"), meta: meta.isEmpty ? nil : meta,
                    leading: .icon("checklist", tint: hue.color),
                    badge: step.deliverable == nil && step.acceptance == nil ? L("No standard") : nil,
                    badgeTone: .warning, chevron: true)
                .rowCard()
        }
        .buttonStyle(.pressableCard)
        .neonListRow()
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
        Section {
            header(L("Owners"), subtitle: L("Who is on the board"), count: process.team.count, anchor: "owners")
            ForEach(process.team) { member in ownerRow(member, steps: process.steps.filter { $0.ownerId == member.id }.count) }
            Button { addingOwner = true } label: { TasksAddRow(title: L("Add somebody"), hue: .pink) }
                .buttonStyle(.pressableCard)
                .neonListRow()
        }
    }

    @ViewBuilder
    private func ownerRow(_ member: ProcessMember, steps: Int) -> some View {
        let role = member.role.flatMap { $0.isEmpty ? nil : $0 }
        Button { editingOwner = member } label: {
            ListRow(member.name, subtitle: role, meta: steps == 0 ? nil : (steps == 1 ? L("Usual owner of 1 step") : L("Usual owner of %d steps", steps)),
                    leading: .avatar(url: nil, name: member.name),
                    badge: member.active ? nil : L("Inactive"), badgeTone: .neutral, chevron: true)
                .rowCard()
                .opacity(member.active ? 1 : 0.7)
        }
        .buttonStyle(.pressableCard)
        .neonListRow()
        .destructiveSwipe(L("Delete"), confirm: L("Delete %@?", member.name), message: L("Their steps survive, unassigned.")) {
            Task { await run { try await api.deleteOwner(id: member.id) } }
        }
        .swipeAction(L("Up"), symbol: "arrow.up", edge: .leading) { move { try await api.moveOwner(id: member.id, direction: "left") } }
        .swipeAction(L("Down"), symbol: "arrow.down", tint: .neonTextTertiary) { move { try await api.moveOwner(id: member.id, direction: "right") } }
        .contextMenu {
            Button { editingOwner = member } label: { Label(L("Edit"), systemImage: "pencil") }
            Button { move { try await api.moveOwner(id: member.id, direction: "left") } } label: { Label(L("Up"), systemImage: "arrow.up") }
            Button { move { try await api.moveOwner(id: member.id, direction: "right") } } label: { Label(L("Down"), systemImage: "arrow.down") }
        }
    }

    // MARK: - Stage periods

    @ViewBuilder
    private func periodsBlock(_ process: ProcessResponse) -> some View {
        Section {
            header(L("Stage periods"), subtitle: L("How long a range of steps may take"), count: process.periods.count, anchor: "periods")
            ForEach(process.periods) { period in periodRow(period, process: process) }
            Button { addingPeriod = true } label: { TasksAddRow(title: L("Add a stage period"), hue: .orange) }
                .buttonStyle(.pressableCard)
                .neonListRow()
            Text(L("A range of steps and the days it is allowed to take. Ranges chain, so the whole process carries dates without anyone typing one on a project."))
                .font(.neonMeta)
                .foregroundStyle(Color.neonTextTertiary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 4)
                .neonListRow(top: 4, bottom: 4)
        }
    }

    @ViewBuilder
    private func periodRow(_ period: StagePeriodRow, process: ProcessResponse) -> some View {
        let from = stepName(period.fromTaskId, process)
        let to = stepName(period.toTaskId, process)
        Button { editingPeriod = period } label: {
            ListRow(from == to ? from : "\(from) → \(to)",
                    leading: .icon("calendar.badge.clock", tint: .neonOrange),
                    value: period.days == 1 ? L("1 day") : L("%d days", period.days), chevron: true)
                .rowCard()
        }
        .buttonStyle(.pressableCard)
        .neonListRow()
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
    let onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var color: String

    init(section: ProcessSection?, onSaved: @escaping () async -> Void) {
        self.section = section
        self.onSaved = onSaved
        _name = State(initialValue: section?.name ?? "")
        _color = State(initialValue: section?.color ?? "cyan")
    }

    var body: some View {
        SheetScaffold(section == nil ? L("New section") : L("Edit section"),
                      subtitle: L("A group of steps on the board"),
                      symbol: "square.stack.3d.up.fill",
                      primaryTitle: L("Save"), isPrimaryEnabled: !name.trimmingCharacters(in: .whitespaces).isEmpty,
                      onPrimary: { await save() }) {
            // The server picks a new section's colour itself, so it is only
            // offered once the section exists.
            FormSection(footer: section == nil ? L("A colour is picked for it; change it once it is made.") : nil) {
                NeonTextField(L("Name"), text: $name, prompt: L("Design, Drawings, Site…"), symbol: "textformat", isRequired: true)
                if section != nil {
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
        }
        .neonSheet([.medium, .large])
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
        do {
            if let section {
                try await api.updateSection(id: section.id, name: name, color: color)
            } else {
                try await api.createSection(name: name)
            }
            await onSaved()
            Toast.success(L("Saved"))
            dismiss()
        } catch { Toast.error(error) }
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

    var body: some View {
        SheetScaffold(step == nil ? L("New step") : L("Edit step"),
                      subtitle: L("A step every project goes through"),
                      symbol: "checklist",
                      primaryTitle: L("Save"), isPrimaryEnabled: !name.trimmingCharacters(in: .whitespaces).isEmpty,
                      onPrimary: { await save() }) {
            FormSection {
                NeonTextField(L("Name"), text: $name, symbol: "textformat", isRequired: true)
                MenuField(L("Section"), selection: $sectionId, options: (process?.sections ?? []).map(\.id),
                          title: { id in process?.sections.first { $0.id == id }?.name ?? id },
                          noneTitle: L("None"), leadingSymbol: "square.stack.3d.up")
                MenuField(L("Usual owner"), selection: $ownerId, options: (process?.team ?? []).map(\.id),
                          title: { id in process?.team.first { $0.id == id }?.name ?? id },
                          noneTitle: L("Nobody set"), leadingSymbol: "person")
            }
        }
        .neonSheet([.medium, .large])
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

    var body: some View {
        SheetScaffold(step.name, subtitle: L("What this kind of work needs"), symbol: "doc.text.fill",
                      primaryTitle: L("Save"), onPrimary: { await save() }) {
            HStack(spacing: NeonSpace.sm) {
                StateBadge(step.acceptanceLines.count == 1 ? L("1 check") : L("%d checks", step.acceptanceLines.count),
                           tone: step.acceptanceLines.isEmpty ? .warning : .success,
                           symbol: step.acceptanceLines.isEmpty ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                if step.checklistLines > 0 {
                    StateBadge(L("%d on the checklist", step.checklistLines), tone: .blue, symbol: "list.bullet")
                }
                Spacer(minLength: 0)
            }
            FormSection(L("Deliverable & acceptance"), footer: L("Each line under \"Counts as done when\" is checked on its own when the proof arrives.")) {
                NeonTextEditor(L("What to hand in"), text: $deliverable, minLines: 2, limit: 2000)
                NeonTextEditor(L("Counts as done when"), text: $acceptance, prompt: L("One line per item"), minLines: 3, limit: 4000)
                NumberField(L("Estimate"), value: $estimateHours, unit: L("h"), decimals: 1)
            }
            FormSection(L("Proof")) {
                NeonTextEditor(L("What proof to send"), text: $evidence, minLines: 2, limit: 2000)
                NeonTextEditor(L("Checklist"), text: $checklist, prompt: L("A reminder, one line per item"), minLines: 2, limit: 4000)
            }
            FormSection(L("Review")) {
                MenuField(L("Reviewer"), selection: $reviewerId, options: team.map(\.id),
                          title: { id in team.first { $0.id == id }?.name ?? id }, noneTitle: L("Nobody set"), leadingSymbol: "person.crop.circle.badge.checkmark")
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
    let onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var role: String

    init(owner: ProcessMember?, onSaved: @escaping () async -> Void) {
        self.owner = owner
        self.onSaved = onSaved
        _name = State(initialValue: owner?.name ?? "")
        _role = State(initialValue: owner?.role ?? "")
    }

    var body: some View {
        SheetScaffold(owner == nil ? L("Add somebody") : L("Edit"),
                      subtitle: L("Somebody who owns steps on the board"),
                      symbol: "person.fill",
                      primaryTitle: L("Save"), isPrimaryEnabled: !name.trimmingCharacters(in: .whitespaces).isEmpty,
                      onPrimary: { await save() }) {
            // Adding takes a name only (`createEmployee(name)`); the role is
            // written once they are on the list.
            FormSection(footer: owner == nil ? L("Their role can be added once they are on the list.") : nil) {
                NeonTextField(L("Name"), text: $name, symbol: "person", isRequired: true)
                if owner != nil {
                    NeonTextField(L("Role"), text: $role, prompt: L("Optional"), symbol: "briefcase")
                }
            }
        }
        .neonSheet([.medium, .large])
    }

    private func save() async {
        do {
            if let owner {
                try await api.updateOwner(id: owner.id, name: name, role: role)
            } else {
                try await api.createOwner(name: name)
            }
            await onSaved()
            Toast.success(L("Saved"))
            dismiss()
        } catch { Toast.error(error) }
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
        _fromTaskId = State(initialValue: period?.fromTaskId ?? steps.first?.id)
        _toTaskId = State(initialValue: period?.toTaskId ?? steps.first?.id)
        _days = State(initialValue: period.map { Double($0.days) })
    }

    private var isValid: Bool { fromTaskId != nil && toTaskId != nil && (days ?? 0) > 0 }

    var body: some View {
        SheetScaffold(period == nil ? L("New stage period") : L("Edit stage period"),
                      subtitle: L("How long a range of steps may take"),
                      symbol: "calendar.badge.clock",
                      primaryTitle: L("Save"), isPrimaryEnabled: isValid, onPrimary: { await save() }) {
            FormSection(footer: L("Every step from the first to the last shares this deadline.")) {
                MenuField(L("First step"), selection: $fromTaskId, options: steps.map(\.id),
                          title: { id in steps.first { $0.id == id }?.name ?? id }, leadingSymbol: "flag")
                MenuField(L("Last step"), selection: $toTaskId, options: steps.map(\.id),
                          title: { id in steps.first { $0.id == id }?.name ?? id }, leadingSymbol: "flag.checkered")
                NumberField(L("Days"), value: $days, unit: L("days"), decimals: 0, isRequired: true)
            }
        }
        .neonSheet([.medium, .large])
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
