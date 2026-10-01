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
    @State private var editing: MyAssignedJob?
    @State private var creating = false

    var body: some View {
        NeonScroll(spacing: NeonSpace.stack) {
            if let cachedAt { OfflineBanner(savedAt: cachedAt) }

            if let week {
                weekHeader(week)

                if week.tasks.isEmpty {
                    EmptyState(
                        symbol: "shippingbox",
                        title: L("Nothing handed out this week"),
                        actionTitle: L("Hand out a job"),
                        action: { creating = true },
                        hue: .purple,
                        card: true
                    )
                } else {
                    SectionHeader(L("This week"), count: week.tasks.count) { EmptyView() }
                    VStack(spacing: NeonSpace.sm) {
                        ForEach(Array(week.tasks.enumerated()), id: \.element.id) { index, job in
                            // A colleague can rewrite or delete a job the manager
                            // has already approved from here — so once it is
                            // SUBMITTED or DONE, tapping only opens it to read,
                            // never the edit form.
                            if job.state == "SUBMITTED" || job.state == "DONE" {
                                NavigationLink(value: JobRoute(id: job.id)) {
                                    assignedJobRow(job)
                                }
                                .buttonStyle(.pressableCard)
                                .staggered(index)
                            } else {
                                Button {
                                    Haptic.tap()
                                    editing = job
                                } label: {
                                    assignedJobRow(job)
                                }
                                .buttonStyle(.pressableCard)
                                .staggered(index)
                            }
                        }
                    }
                }
            } else if let errorMessage {
                ErrorState(message: errorMessage) { await load() }
            } else {
                SkeletonRows(count: 4)
            }
        }
        .refreshable {
            Haptic.tap()
            await load()
        }
        .navigationTitle(L("Hand out work"))
        .floatingActionButton("plus", label: L("Hand out a job")) {
            Haptic.tap()
            creating = true
        }
        .navigationDestination(for: JobRoute.self) { JobDetailView(jobId: $0.id) }
        .task(id: weekOffset) { await load() }
        // A face changed (their own, from Profile): the rows draw it.
        .onReceive(NotificationCenter.default.publisher(for: .neonDataChanged)) { note in
            guard isFaceChange(note.object as? String) else { return }
            Task { await load() }
        }
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
            IconButton("chevron.backward", label: L("Previous week"), size: NeonSize.circleButton) {
                Haptic.selection()
                weekOffset -= 1
            }

            Spacer()
            VStack(spacing: 4) {
                Text(week.weekLabel).font(.neonCardTitle)
                if weekOffset != 0 {
                    ViewAllButton(L("This week"), chevron: false) {
                        withNeonAnimation(.snappy) { weekOffset = 0 }
                    }
                } else {
                    // Keeps the header's height steady whether the link is
                    // showing or not, so nothing else on the page shifts.
                    Color.clear.frame(height: 30)
                }
            }
            Spacer()

            IconButton("chevron.forward", label: L("Next week"), size: NeonSize.circleButton) {
                Haptic.selection()
                weekOffset += 1
            }
        }
    }

    private func assignedJobRow(_ job: MyAssignedJob) -> some View {
        HStack(alignment: .top, spacing: 12) {
            AvatarView(url: facePhotoURL(team.first { $0.id == job.employeeId }?.photoUrl), name: name(for: job.employeeId), size: 40, style: .solid)
            VStack(alignment: .leading, spacing: 5) {
                // `fill: false`, so the title hugs the leading edge instead of
                // stretching to sit flush against the trailing chevron in
                // Arabic — only the reading direction should flip, not which
                // edge the block sits on.
                DirText(job.title, font: .neonRowTitle, fill: false)
                Text(name(for: job.employeeId))
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextTertiary)
                MetaLabel(jobDateRange(startKey: job.startKey, endKey: job.endKey), symbol: "calendar")
                FlowRow {
                    meStateBadge(job.state)
                    priorityChip(job.priority)
                    if jobHasNoAcceptance(job) {
                        BadgeView(text: L("No finish line written"), tone: .warning, symbol: "exclamationmark.triangle.fill")
                    }
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.forward")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.neonTextFaint)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .neonContextShape(radius: NeonRadius.lg)
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
    let job: MyAssignedJob?
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

    init(team: [AssignTeamMember], job: MyAssignedJob?, onSaved: @escaping () async -> Void) {
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
            job == nil ? L("New job") : L("Edit job"),
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
                }, avatar: { id in
                    facePhotoURL(team.first(where: { $0.id == id })?.photoUrl)
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
                ValidationMessage(errorMessage)
            }

            if let job {
                NeonButton(L("Delete this job"), symbol: "trash", kind: .destructive, isLoading: deleting, confirm: L("Delete this job?")) {
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

    private func delete(_ job: MyAssignedJob) async {
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
