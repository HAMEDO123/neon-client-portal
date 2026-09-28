import SwiftUI

/// The "Week" segment: jobs the manager (or anybody ticked `canAssignTasks`)
/// hands out by hand, outside any project — `assignedTasksForWeek`, one week
/// at a time, weeks starting Sunday. A phone can't show the web's grid, so
/// this lists each day of the week with the jobs that cover it.
struct WeekBoardView: View {
    @EnvironmentObject var api: APIClient
    @ObservedObject var store: TaskWeekStore

    @State private var person: String?
    @State private var editing: JobSheetTarget?
    @State private var deleting: AssignedJob?

    enum JobSheetTarget: Identifiable {
        case new(day: String)
        case existing(AssignedJob)
        var id: String {
            switch self {
            case .new(let day): return "new:\(day)"
            case .existing(let job): return job.id
            }
        }
    }

    var body: some View {
        LoadStateView(value: store.value, error: store.errorMessage, cachedAt: store.cachedAt, retry: { await store.load(api) }) { week in
            NeonScroll {
                weekNavigator(week)

                FilterChips(selection: $person, options: [nil] + week.team.map(\.id), inset: 16,
                            title: { id in id.flatMap { pid in week.team.first { $0.id == pid }?.name } ?? L("Everyone") })
                    .padding(.horizontal, -16)

                ForEach(week.weekKeys, id: \.self) { day in
                    daySection(day, week: week)
                }
            }
            .refreshable { await store.load(api) }
            .floatingActionButton(label: L("New job")) {
                editing = .new(day: week.todayKey)
            }
        }
        .sheet(item: $editing) { target in
            JobEditorSheet(target: target, team: store.value?.team ?? [])
                .neonSheet([.large])
        }
        .confirmDestructive(
            item: $deleting, title: { L("Delete \"%@\"?", $0.title) }, actionTitle: L("Delete")
        ) { job in
            Task {
                do { try await api.deleteJob(id: job.id); Toast.success(L("Deleted")) } catch { Toast.error(error) }
            }
        }
    }

    @ViewBuilder
    private func weekNavigator(_ week: WeekBoardResponse) -> some View {
        HStack {
            IconButton("chevron.backward", label: L("Previous week")) {
                store.week = week.previousWeek
                Task { await store.load(api) }
            }
            Spacer()
            VStack(spacing: 2) {
                Text(weekLabel(week))
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                if week.weekKeys.contains(week.todayKey) {
                    Text(L("This week")).font(.system(size: 11, weight: .semibold)).foregroundStyle(Color.neonPurpleStrong)
                }
            }
            Spacer()
            IconButton("chevron.forward", label: L("Next week")) {
                store.week = week.nextWeek
                Task { await store.load(api) }
            }
        }
    }

    private func weekLabel(_ week: WeekBoardResponse) -> String {
        guard let first = week.weekKeys.first, let last = week.weekKeys.last else { return "" }
        return "\(formattedDayKey(first)) – \(formattedDayKey(last))"
    }

    @ViewBuilder
    private func daySection(_ day: String, week: WeekBoardResponse) -> some View {
        let jobs = week.tasks.filter { $0.startKey <= day && day <= $0.endKey && (person == nil || $0.employeeId == person) }
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                SectionLabel(formattedDayKey(day) + (day == week.todayKey ? " · \(L("Today"))" : ""))
                Spacer()
                IconButton("plus", label: L("New job on this day"), look: .tinted, size: 28) {
                    editing = .new(day: day)
                }
            }
            if jobs.isEmpty {
                Text(L("Nothing planned")).font(.system(size: 12.5)).foregroundStyle(Color.neonTextFaint).padding(.leading, 4)
            } else {
                CardList(jobs) { job in
                    jobRow(job, week: week)
                }
            }
        }
    }

    @ViewBuilder
    private func jobRow(_ job: AssignedJob, week: WeekBoardResponse) -> some View {
        let owner = week.team.first { $0.id == job.employeeId }
        Button {
            Haptic.tap()
            editing = .existing(job)
        } label: {
            ListRow(
                job.title,
                subtitle: owner?.name ?? job.employeeId,
                meta: job.days > 1 ? L("%d days", job.days) : nil,
                leading: .avatar(url: nil, name: owner?.name ?? "?", online: false),
                badge: taskStateLabel(job.state), badgeTone: taskStateTone(job.state),
                chevron: true
            )
        }
        .buttonStyle(.pressableCard)
        .contextMenu {
            ForEach(["TODO", "IN_PROGRESS", "DONE"], id: \.self) { state in
                Button(taskStateLabel(state)) { Task { try? await api.setJobState(id: job.id, state: state) } }
            }
            Button(L("Delete"), role: .destructive) { deleting = job }
        }
    }
}

/// Create or edit a job handed out by hand — `TaskDialog` on the website,
/// exported from week-board.tsx: title, who, the days it runs, priority,
/// what to hand in and what counts as finished, plus the job's own state.
struct JobEditorSheet: View {
    let target: WeekBoardView.JobSheetTarget
    let team: [TaskPerson]

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var title: String
    @State private var employeeId: String?
    @State private var startDay: Date
    @State private var endDay: Date
    @State private var priority: String
    @State private var note: String
    @State private var deliverable: String
    @State private var acceptance: String
    @State private var state: String
    @State private var deleting = false

    private var existing: AssignedJob? {
        if case .existing(let job) = target { return job }
        return nil
    }

    init(target: WeekBoardView.JobSheetTarget, team: [TaskPerson]) {
        self.target = target
        self.team = team
        switch target {
        case .new(let day):
            let date = NeonFormat.date(fromDayKey: day) ?? Date()
            _title = State(initialValue: "")
            _employeeId = State(initialValue: team.first?.id)
            _startDay = State(initialValue: date)
            _endDay = State(initialValue: date)
            _priority = State(initialValue: "MEDIUM")
            _note = State(initialValue: "")
            _deliverable = State(initialValue: "")
            _acceptance = State(initialValue: "")
            _state = State(initialValue: "TODO")
        case .existing(let job):
            _title = State(initialValue: job.title)
            _employeeId = State(initialValue: job.employeeId)
            _startDay = State(initialValue: NeonFormat.date(fromDayKey: job.startKey) ?? Date())
            _endDay = State(initialValue: NeonFormat.date(fromDayKey: job.endKey) ?? Date())
            _priority = State(initialValue: job.priority)
            _note = State(initialValue: job.note ?? "")
            _deliverable = State(initialValue: job.deliverable ?? "")
            _acceptance = State(initialValue: job.acceptance ?? "")
            _state = State(initialValue: job.state)
        }
    }

    private var isValid: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && employeeId != nil
    }

    var body: some View {
        SheetScaffold(existing == nil ? L("New job") : L("Edit job"), symbol: "calendar.badge.clock",
                      primaryTitle: existing == nil ? L("Hand out") : L("Save"), isPrimaryEnabled: isValid,
                      onPrimary: { await save() }) {
            if let existing {
                FormSection(L("State")) {
                    HStack(spacing: 8) {
                        ForEach(["TODO", "IN_PROGRESS", "DONE"], id: \.self) { option in
                            NeonButton(taskStateLabel(option), kind: state == option ? .tinted(taskStateTone(option).foreground) : .secondary, size: .small) {
                                await setState(option, jobId: existing.id)
                            }
                        }
                    }
                }
                if let chatTaskId = existing.chatTaskId, !chatTaskId.isEmpty {
                    StatusNote(symbol: "bubble.left.and.bubble.right", tone: .info, title: L("From a chat task card"),
                               detail: L("This job was handed out from a conversation."))
                }
            }

            FormSection(L("Job")) {
                NeonTextField(L("Title"), text: $title, isRequired: true)
                MenuField(L("For"), selection: $employeeId, options: team.map(\.id),
                          title: { id in team.first { $0.id == id }?.name ?? id }, isRequired: true)
                DateField(L("Starts"), date: $startDay)
                DateField(L("Ends"), date: $endDay, in: startDay...Date.distantFuture)
                MenuField(L("Priority"), selection: $priority, options: taskPriorities, title: localizedPriority)
            }

            FormSection(L("What it takes")) {
                NeonTextEditor(L("What to hand in"), text: $deliverable, minLines: 2, limit: 2000)
                NeonTextEditor(L("Counts as done when"), text: $acceptance,
                               prompt: L("One line per item — this is what a photo is checked against"), minLines: 3, limit: 4000)
                NeonTextEditor(L("Note"), text: $note, minLines: 2, limit: 2000)
            }

            if existing != nil {
                NeonButton(L("Delete this job"), symbol: "trash", kind: .destructive,
                           confirm: L("Delete this job?"), confirmMessage: L("It comes off the week for good.")) {
                    await delete()
                }
            }
        }
        .neonSheet([.large])
    }

    private func setState(_ target: String, jobId: String) async {
        guard target != state else { return }
        do {
            try await api.setJobState(id: jobId, state: target)
            state = target
            Haptic.success()
        } catch { Toast.error(error) }
    }

    private func form() -> [String: Any] {
        [
            "title": title,
            "employeeId": employeeId ?? "",
            "startDay": NeonFormat.dayKey(startDay),
            "endDay": NeonFormat.dayKey(endDay),
            "priority": priority,
            "note": note,
            "deliverable": deliverable,
            "acceptance": acceptance,
        ]
    }

    private func save() async {
        do {
            if let existing {
                try await api.updateJob(id: existing.id, form: form())
            } else {
                _ = try await api.createJob(form: form())
            }
            Toast.success(L("Saved"))
            dismiss()
        } catch { Toast.error(error) }
    }

    private func delete() async {
        guard let existing else { return }
        do {
            try await api.deleteJob(id: existing.id)
            Toast.success(L("Deleted"))
            dismiss()
        } catch { Toast.error(error) }
    }
}
