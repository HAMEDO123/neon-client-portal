import SwiftUI

/// The delivery process, pushed from Settings: the parts of `/admin/settings`
/// that define how work moves — sections, steps, who is on the board, what
/// each kind of work needs, and the stage periods that turn steps into dates.
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
        LoadStateView(value: store.value, error: store.errorMessage, cachedAt: store.cachedAt, retry: { await store.load(api) }) { process in
            List {
                if process.totalDays > 0 {
                    Section {
                        KeyValueRow(L("Timed process"), value: L("%d days", process.totalDays), symbol: "timer")
                            .neonListRow()
                    }
                }

                Section {
                    ForEach(process.sections) { section in
                        sectionRow(section)
                    }
                    Button { addingSection = true } label: { addRow(L("Add a section")) }
                        .neonListRow()
                } header: { SectionLabel(L("Sections")) }

                Section {
                    ForEach(process.sections) { section in
                        let steps = process.steps.filter { $0.sectionId == section.id }.sorted { $0.order < $1.order }
                        if !steps.isEmpty {
                            ForEach(steps) { step in stepRow(step, process: process) }
                        }
                    }
                    let loose = process.steps.filter { $0.sectionId == nil }.sorted { $0.order < $1.order }
                    ForEach(loose) { step in stepRow(step, process: process) }
                    Button { addingStep = true } label: { addRow(L("Add a step")) }
                        .neonListRow()
                } header: { SectionLabel(L("Steps")) }

                Section {
                    ForEach(process.team) { member in ownerRow(member) }
                    Button { addingOwner = true } label: { addRow(L("Add somebody")) }
                        .neonListRow()
                } header: { SectionLabel(L("Owners")) }

                Section {
                    ForEach(process.periods) { period in periodRow(period, process: process) }
                    Button { addingPeriod = true } label: { addRow(L("Add a stage period")) }
                        .neonListRow()
                } header: { SectionLabel(L("Stage periods")) } footer: {
                    Text(L("A range of steps and the days it is allowed to take. Ranges chain, so the whole process carries dates without anyone typing one on a project."))
                        .font(.system(size: 12))
                        .foregroundStyle(Color.neonTextTertiary)
                }
            }
            .neonListStyle()
            .refreshable { await store.load(api) }
        }
        .navigationTitle(L("Delivery process"))
        .neonAmbientBackground()
        .task { await store.load(api) }
        .sheet(isPresented: $addingSection) { SectionEditorSheet(section: nil) { await store.load(api) } }
        .sheet(item: $editingSection) { section in SectionEditorSheet(section: section) { await store.load(api) } }
        .sheet(isPresented: $addingStep) { StepEditorSheet(step: nil, process: store.value) { await store.load(api) } }
        .sheet(item: $editingStep) { step in StepEditorSheet(step: step, process: store.value) { await store.load(api) } }
        .sheet(item: $editingStandard) { step in TaskTypeSheet(step: step, team: store.value?.team ?? []) { await store.load(api) } }
        .sheet(isPresented: $addingOwner) { OwnerEditorSheet(owner: nil) { await store.load(api) } }
        .sheet(item: $editingOwner) { owner in OwnerEditorSheet(owner: owner) { await store.load(api) } }
        .sheet(isPresented: $addingPeriod) { PeriodEditorSheet(period: nil, steps: store.value?.steps ?? []) { await store.load(api) } }
        .sheet(item: $editingPeriod) { period in PeriodEditorSheet(period: period, steps: store.value?.steps ?? []) { await store.load(api) } }
    }

    private func addRow(_ title: String) -> some View {
        Label(title, systemImage: "plus.circle.fill")
            .font(.system(size: 14.5, weight: .semibold))
            .foregroundStyle(Color.neonPurpleStrong)
    }

    // MARK: - Rows

    @ViewBuilder
    private func sectionRow(_ section: ProcessSection) -> some View {
        Button { editingSection = section } label: {
            ListRow(section.name, leading: .icon("square.stack.3d.up", tint: sectionAccentColor(section.color)), chevron: true)
        }
        .buttonStyle(.plain)
        .neonSurface(.solid, radius: 14)
        .neonListRow()
        .destructiveSwipe(L("Delete"), confirm: L("Delete \"%@\"?", section.name), message: L("Its steps survive, ungrouped.")) {
            Task { try? await api.deleteSection(id: section.id); await store.load(api) }
        }
        .swipeAction(L("Up"), symbol: "arrow.up", edge: .leading) {
            Task { try? await api.moveSection(id: section.id, direction: "left"); await store.load(api) }
        }
        .swipeAction(L("Down"), symbol: "arrow.down", tint: .neonInk.opacity(0.5)) {
            Task { try? await api.moveSection(id: section.id, direction: "right"); await store.load(api) }
        }
    }

    @ViewBuilder
    private func stepRow(_ step: ProcessStep, process: ProcessResponse) -> some View {
        let owner = process.team.first { $0.id == step.ownerId }
        Button { editingStep = step } label: {
            ListRow(step.name, subtitle: owner?.name, meta: step.estimateHours.map { L("%@h", NeonFormat.number($0, decimals: 1)) },
                    leading: .plain, badge: step.deliverable == nil && step.acceptance == nil ? L("No standard") : nil,
                    badgeTone: .warning, chevron: true)
        }
        .buttonStyle(.plain)
        .neonSurface(.solid, radius: 14)
        .neonListRow()
        .destructiveSwipe(L("Delete"), confirm: L("Delete \"%@\"?", step.name)) {
            Task { try? await api.deleteStep(id: step.id); await store.load(api) }
        }
        .swipeAction(L("Standard"), symbol: "doc.text", edge: .leading) { editingStandard = step }
    }

    @ViewBuilder
    private func ownerRow(_ member: ProcessMember) -> some View {
        Button { editingOwner = member } label: {
            ListRow(member.name, subtitle: member.role,
                    leading: .icon("person.fill", tint: sectionAccentColor(member.color)),
                    badge: member.active ? nil : L("Inactive"), badgeTone: .neutral, chevron: true)
        }
        .buttonStyle(.plain)
        .neonSurface(.solid, radius: 14)
        .neonListRow()
        .destructiveSwipe(L("Delete"), confirm: L("Delete %@?", member.name), message: L("Their steps survive, unassigned.")) {
            Task { try? await api.deleteOwner(id: member.id); await store.load(api) }
        }
        .swipeAction(L("Up"), symbol: "arrow.up", edge: .leading) {
            Task { try? await api.moveOwner(id: member.id, direction: "left"); await store.load(api) }
        }
        .swipeAction(L("Down"), symbol: "arrow.down", tint: .neonInk.opacity(0.5)) {
            Task { try? await api.moveOwner(id: member.id, direction: "right"); await store.load(api) }
        }
    }

    @ViewBuilder
    private func periodRow(_ period: StagePeriodRow, process: ProcessResponse) -> some View {
        let from = process.steps.first { $0.id == period.fromTaskId }?.name ?? period.fromTaskId
        let to = process.steps.first { $0.id == period.toTaskId }?.name ?? period.toTaskId
        Button { editingPeriod = period } label: {
            ListRow(from == to ? from : "\(from) → \(to)",
                    leading: .icon("calendar.badge.clock", tint: .neonCyanStrong), value: L("%d days", period.days), chevron: true)
        }
        .buttonStyle(.plain)
        .neonSurface(.solid, radius: 14)
        .neonListRow()
        .destructiveSwipe(L("Delete"), confirm: L("Delete this stage period?")) {
            Task { try? await api.deletePeriod(id: period.id); await store.load(api) }
        }
    }
}

// MARK: - Sheets

private struct SectionEditorSheet: View {
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
        SheetScaffold(section == nil ? L("New section") : L("Edit section"), symbol: "square.stack.3d.up",
                      primaryTitle: L("Save"), isPrimaryEnabled: !name.trimmingCharacters(in: .whitespaces).isEmpty,
                      onPrimary: { await save() }) {
            FormSection {
                NeonTextField(L("Name"), text: $name, isRequired: true)
                MenuField(L("Colour"), selection: $color, options: ["cyan", "purple", "pink", "orange"],
                          title: { $0.capitalized }, symbol: { _ in "circle.fill" })
            }
        }
        .neonSheet([.medium])
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

private struct StepEditorSheet: View {
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
        SheetScaffold(step == nil ? L("New step") : L("Edit step"), symbol: "checklist",
                      primaryTitle: L("Save"), isPrimaryEnabled: !name.trimmingCharacters(in: .whitespaces).isEmpty,
                      onPrimary: { await save() }) {
            FormSection {
                NeonTextField(L("Name"), text: $name, isRequired: true)
                MenuField(L("Section"), selection: $sectionId, options: (process?.sections ?? []).map(\.id),
                          title: { id in process?.sections.first { $0.id == id }?.name ?? id }, noneTitle: L("None"))
                MenuField(L("Usual owner"), selection: $ownerId, options: (process?.team ?? []).map(\.id),
                          title: { id in process?.team.first { $0.id == id }?.name ?? id }, noneTitle: L("Nobody set"))
            }
        }
        .neonSheet([.medium])
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
private struct TaskTypeSheet: View {
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
        SheetScaffold(step.name, subtitle: L("What this kind of work needs"), symbol: "doc.text",
                      primaryTitle: L("Save"), onPrimary: { await save() }) {
            FormSection(L("Deliverable & acceptance")) {
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
                          title: { id in team.first { $0.id == id }?.name ?? id }, noneTitle: L("Nobody set"))
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

private struct OwnerEditorSheet: View {
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
        SheetScaffold(owner == nil ? L("Add somebody") : L("Edit"), symbol: "person.fill",
                      primaryTitle: L("Save"), isPrimaryEnabled: !name.trimmingCharacters(in: .whitespaces).isEmpty,
                      onPrimary: { await save() }) {
            FormSection {
                NeonTextField(L("Name"), text: $name, isRequired: true)
                NeonTextField(L("Role"), text: $role, prompt: L("Optional"))
            }
        }
        .neonSheet([.medium])
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

private struct PeriodEditorSheet: View {
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
        SheetScaffold(period == nil ? L("New stage period") : L("Edit stage period"), symbol: "calendar.badge.clock",
                      primaryTitle: L("Save"), isPrimaryEnabled: isValid, onPrimary: { await save() }) {
            FormSection(footer: L("Every step from the first to the last shares this deadline.")) {
                MenuField(L("First step"), selection: $fromTaskId, options: steps.map(\.id), title: { id in steps.first { $0.id == id }?.name ?? id })
                MenuField(L("Last step"), selection: $toTaskId, options: steps.map(\.id), title: { id in steps.first { $0.id == id }?.name ?? id })
                NumberField(L("Days"), value: $days, unit: L("days"), decimals: 0, isRequired: true)
            }
        }
        .neonSheet([.medium])
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
