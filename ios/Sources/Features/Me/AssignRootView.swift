import SwiftUI

/// The Assign view (`components/tasks/assign-work.tsx` on the web): for
/// whoever the manager has trusted to hand work out. Not the manager's two
/// tables — a project-by-step matrix and a seven-day grid, built for a desk —
/// this is the same job without them: a button, the same form the manager
/// uses, and that week's jobs as cards.
struct AssignRootView: View {
    @EnvironmentObject var api: APIClient
    @State private var team: [AssignTeamMember] = []
    @State private var week: AssignWeekResponse?
    @State private var weekOffset = 0
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var editing: AssignedJob?
    @State private var creating = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let cachedAt { OfflineBanner(savedAt: cachedAt) }

                if let week {
                    weekHeader(week)

                    if week.tasks.isEmpty {
                        EmptyState(
                            symbol: "shippingbox",
                            title: L("Nothing handed out this week"),
                            actionTitle: L("Hand out a job")
                        ) {
                            creating = true
                        }
                        .glassCard(radius: 18)
                    } else {
                        VStack(spacing: 10) {
                            ForEach(week.tasks) { job in
                                Button {
                                    Haptic.tap()
                                    editing = job
                                } label: {
                                    assignedJobRow(job)
                                }
                                .buttonStyle(.pressableCard)
                            }
                        }
                    }
                } else if let errorMessage {
                    ErrorState(message: errorMessage) { await load() }
                } else {
                    SkeletonRows(count: 4)
                }
            }
            .padding(16)
            .padding(.bottom, 70)
        }
        .refreshable {
            Haptic.tap()
            await load()
        }
        .navigationTitle(L("Assign"))
        .neonAmbientBackground()
        .floatingActionButton(label: L("New task")) {
            Haptic.tap()
            creating = true
        }
        .navigationDestination(for: JobRoute.self) { JobDetailView(jobId: $0.id) }
        .task(id: weekOffset) { await load() }
        .sheet(isPresented: $creating) {
            AssignJobFormSheet(team: team, job: nil) {
                await load()
            }
        }
        .sheet(item: $editing) { job in
            AssignJobFormSheet(team: team, job: job) {
                await load()
            }
        }
    }

    private func weekHeader(_ week: AssignWeekResponse) -> some View {
        HStack {
            Button {
                Haptic.selection()
                weekOffset -= 1
            } label: {
                Image(systemName: "chevron.backward").font(.system(size: 14, weight: .semibold))
            }
            .buttonStyle(.pressable)

            Spacer()
            VStack(spacing: 2) {
                Text(week.weekLabel).font(.system(size: 15, weight: .semibold))
                if weekOffset != 0 {
                    Button(L("This week")) {
                        Haptic.selection()
                        weekOffset = 0
                    }
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.neonCyanStrong)
                }
            }
            Spacer()

            Button {
                Haptic.selection()
                weekOffset += 1
            } label: {
                Image(systemName: "chevron.forward").font(.system(size: 14, weight: .semibold))
            }
            .buttonStyle(.pressable)
        }
        .padding(.horizontal, 4)
    }

    private func assignedJobRow(_ job: AssignedJob) -> some View {
        HStack(alignment: .top, spacing: 12) {
            AvatarView(url: nil, name: name(for: job.employeeId), size: 38)
            VStack(alignment: .leading, spacing: 5) {
                DirText(job.title, font: .system(size: 15, weight: .semibold))
                Text(name(for: job.employeeId))
                    .font(.system(size: 12))
                    .foregroundStyle(Color.neonInk.opacity(0.5))
                HStack(spacing: 6) {
                    BadgeView(text: taskStateLabel(job.state), tone: taskStateTone(job.state))
                    if let priority = priorityLabel(job.priority) {
                        BadgeView(text: priority, tone: job.priority == "HIGH" ? .pink : .neutral)
                    }
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.forward")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.neonInk.opacity(0.25))
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(radius: 16)
    }

    private func name(for employeeId: String) -> String {
        team.first(where: { $0.id == employeeId })?.name ?? L("Somebody")
    }

    private func load() async {
        let anchor = Calendar.current.date(byAdding: .day, value: weekOffset * 7, to: Date())
        let anchorKey = anchor.map { NeonFormat.dayKey($0) }

        async let teamLoad = api.fetchAssignTeam()
        async let weekLoad = api.fetchAssignWeek(week: anchorKey)
        do {
            let (teamResult, weekResult) = try await (teamLoad, weekLoad)
            team = teamResult.value
            week = weekResult.value
            cachedAt = weekResult.cachedAt
            errorMessage = nil
        } catch {
            if week == nil { errorMessage = error.localizedDescription }
        }
    }
}

// MARK: - Hand out a job, or change one

private struct AssignJobFormSheet: View {
    let team: [AssignTeamMember]
    let job: AssignedJob?
    let onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var employeeId: String?
    @State private var startDay: Date
    @State private var endDay: Date
    @State private var priority: String?
    @State private var note: String
    @State private var deliverable: String
    @State private var acceptance: String
    @State private var errorMessage: String?
    @State private var deleting = false

    init(team: [AssignTeamMember], job: AssignedJob?, onSaved: @escaping () async -> Void) {
        self.team = team
        self.job = job
        self.onSaved = onSaved
        _title = State(initialValue: job?.title ?? "")
        _employeeId = State(initialValue: job?.employeeId ?? team.first?.id)
        _startDay = State(initialValue: job.flatMap { NeonFormat.date(fromDayKey: $0.startKey) } ?? Date())
        _endDay = State(initialValue: job.flatMap { NeonFormat.date(fromDayKey: $0.endKey) } ?? Date())
        _priority = State(initialValue: job?.priority ?? "MEDIUM")
        _note = State(initialValue: job?.note ?? "")
        _deliverable = State(initialValue: job?.deliverable ?? "")
        _acceptance = State(initialValue: job?.acceptance ?? "")
    }

    var body: some View {
        SheetScaffold(
            job == nil ? L("New task") : L("Edit task"),
            symbol: "shippingbox",
            primaryTitle: job == nil ? L("Hand out") : L("Save"),
            isPrimaryEnabled: !title.trimmingCharacters(in: .whitespaces).isEmpty && employeeId != nil
        ) {
            await save()
        } content: {
            FormSection(L("Task")) {
                NeonTextField(L("Title"), text: $title, prompt: L("Negotiate with the marble supplier"), symbol: "textformat", isRequired: true)
                SelectField(L("For"), selection: $employeeId, options: team.map(\.id), title: { id in
                    team.first(where: { $0.id == id })?.name ?? ""
                }, isRequired: true)
            }

            FormSection(L("When")) {
                DateField(L("From"), date: $startDay)
                DateField(L("To"), date: $endDay)
                MenuField(L("Priority"), selection: $priority, options: ["LOW", "MEDIUM", "HIGH"], title: priorityTitle)
            }

            FormSection(L("What counts as finished"), footer: L("What a photo sent for this job is checked against. Left empty, there is nothing to check it against.")) {
                NeonTextEditor(L("What to hand in"), text: $deliverable, minLines: 2, maxLines: 5)
                NeonTextEditor(L("Counts as done when"), text: $acceptance, minLines: 2, maxLines: 6)
            }

            FormSection(L("Notes")) {
                NeonTextEditor(L("Anything else"), text: $note, minLines: 2, maxLines: 6)
            }

            if let errorMessage {
                Text(errorMessage).font(.footnote).foregroundStyle(.red)
            }

            if let job {
                NeonButton(L("Delete this task"), symbol: "trash", kind: .destructive, isLoading: deleting, confirm: L("Delete this task?")) {
                    await delete(job)
                }
            }
        }
        .neonSheet([.large])
    }

    private func priorityTitle(_ value: String) -> String {
        switch value {
        case "HIGH": return L("High")
        case "LOW": return L("Low")
        default: return L("Medium")
        }
    }

    private func save() async {
        guard let employeeId else { return }
        var form: [String: Any] = [
            "title": title.trimmingCharacters(in: .whitespaces),
            "employeeId": employeeId,
            "startDay": NeonFormat.dayKey(startDay),
            "endDay": NeonFormat.dayKey(endDay),
            "priority": priority ?? "MEDIUM",
        ]
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedNote.isEmpty { form["note"] = trimmedNote }
        let trimmedDeliverable = deliverable.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedDeliverable.isEmpty { form["deliverable"] = trimmedDeliverable }
        let trimmedAcceptance = acceptance.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedAcceptance.isEmpty { form["acceptance"] = trimmedAcceptance }

        do {
            if let job {
                try await api.updateAssignedJob(id: job.id, form: form)
            } else {
                try await api.createAssignedJob(form: form)
            }
            Haptic.success()
            await onSaved()
            dismiss()
        } catch {
            Haptic.error()
            errorMessage = error.localizedDescription
        }
    }

    private func delete(_ job: AssignedJob) async {
        deleting = true
        defer { deleting = false }
        do {
            try await api.deleteAssignedJob(id: job.id)
            Haptic.success()
            await onSaved()
            dismiss()
        } catch {
            Haptic.error()
            errorMessage = error.localizedDescription
        }
    }
}
