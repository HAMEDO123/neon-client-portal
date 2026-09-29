import SwiftUI

/// The "Week" segment: jobs the manager (or anybody ticked `canAssignTasks`)
/// hands out by hand, outside any project — `assignedTasksForWeek`, one week
/// at a time, weeks starting Sunday. A phone can't show the web's grid, so
/// this is the week as a strip of seven days on top, then a card for each day
/// with the jobs that cover it.
///
/// Content only: `TasksRootView` owns the scroll, the floating "New job" and
/// the job sheet (`editing`), so the button stays put while the days scroll.
struct WeekBoardView: View {
    @EnvironmentObject var api: APIClient
    @ObservedObject var store: TaskWeekStore
    @Binding var editing: JobSheetTarget?
    /// The page's scroll, so tapping a day in the strip goes to its card.
    var proxy: ScrollViewProxy?

    @State private var person: String?
    @State private var deleting: AssignedJob?
    @State private var moving = false

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

    /// The states a job moves through, in the order a tally reads them.
    static let jobStates = ["DONE", "SUBMITTED", "IN_PROGRESS", "TODO"]

    var body: some View {
        LoadStateView(value: store.value, error: store.errorMessage, cachedAt: store.cachedAt, retry: { await store.load(api) }) {
            VStack(spacing: NeonSpace.stack) {
                SkeletonCard(lines: 3)
                SkeletonRows(count: 3)
            }
        } content: { week in
            let jobs = week.tasks.filter { person == nil || $0.employeeId == person }
            VStack(alignment: .leading, spacing: NeonSpace.stack) {
                weekCard(week, jobs: jobs)
                    .neonAppear()

                if !week.team.isEmpty {
                    TasksPersonFilter(selection: $person, people: week.team)
                        .padding(.horizontal, -NeonSpace.gutter)
                }

                VStack(spacing: NeonSpace.stack) {
                    ForEach(Array(week.weekKeys.enumerated()), id: \.element) { index, day in
                        dayCard(day, week: week, jobs: jobs.filter { $0.startKey <= day && day <= $0.endKey })
                            .id("day-\(day)")
                            .staggered(index)
                    }
                }
                .id("days")
            }
            .animation(NeonMotion.smooth, value: person)
        }
        .confirmDestructive(
            item: $deleting, title: { L("Delete \"%@\"?", $0.title) }, message: { _ in L("It comes off the week for good.") }, actionTitle: L("Delete")
        ) { job in
            Task {
                do {
                    try await api.deleteJob(id: job.id)
                    Haptic.success()
                    Toast.success(L("Deleted"))
                } catch { Toast.error(error) }
            }
        }
    }

    // MARK: - The week

    private func weekCard(_ week: WeekBoardResponse, jobs: [AssignedJob]) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            TasksPeriodNavigator(
                label: weekLabel(week),
                isCurrent: week.weekKeys.contains(week.todayKey),
                currentTitle: L("This week"),
                backTitle: L("Back to this week"),
                previousLabel: L("Previous week"),
                nextLabel: L("Next week"),
                loading: moving,
                onPrevious: { go(to: week.previousWeek) },
                onNext: { go(to: week.nextWeek) },
                onCurrent: { go(to: nil) }
            )

            dayStrip(week, jobs: jobs)

            NeonDivider()

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(NeonFormat.integer(jobs.count))
                    .font(.system(.title2, weight: .heavy))
                    .monospacedDigit()
                    .foregroundStyle(Color.neonInk)
                Text(jobs.count == 1 ? L("job this week") : L("jobs this week"))
                    .font(.neonLabel)
                    .foregroundStyle(Color.neonTextSecondary)
                Spacer(minLength: 0)
            }
            if jobs.isEmpty {
                Text(L("Nothing handed out for this week yet."))
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextTertiary)
            } else {
                TasksBreakdown(parts: TasksBreakdownPart.states(jobs.map(\.state), order: Self.jobStates), barHeight: 8, columns: 4)
            }
        }
        .padding(NeonSpace.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.glass, radius: NeonRadius.lg)
    }

    /// The seven days, today in the brand's colours, each with how many jobs
    /// cover it. Tapping one goes to its card.
    private func dayStrip(_ week: WeekBoardResponse, jobs: [AssignedJob]) -> some View {
        HStack(spacing: 6) {
            ForEach(week.weekKeys, id: \.self) { day in
                let parts = tasksDayParts(day)
                let count = jobs.filter { $0.startKey <= day && day <= $0.endKey }.count
                let today = day == week.todayKey
                Button {
                    Haptic.selection()
                    withAnimation(NeonMotion.smooth) { proxy?.scrollTo("day-\(day)", anchor: .top) }
                } label: {
                    VStack(spacing: 4) {
                        Text(parts.weekday)
                            .font(.system(.caption2, weight: .semibold))
                            .foregroundStyle(today ? Color.white.opacity(0.85) : Color.neonTextTertiary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        Text(parts.day)
                            .font(.system(.headline, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(today ? Color.white : Color.neonInk)
                        Circle()
                            .fill(count > 0 ? (today ? Color.white : Color.neonIndigo) : Color.clear)
                            .frame(width: 5, height: 5)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background {
                        let shape = RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous)
                        if today {
                            shape.fill(LinearGradient.neonBrand)
                                .shadow(color: Color.neonIndigo.opacity(0.3), radius: 6, x: 0, y: 3)
                        } else {
                            shape.fill(NeonHue.indigo.wash.opacity(count > 0 ? 1 : 0.5))
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressableStyle(scale: 0.92))
                .accessibilityLabel(Text(verbatim: "\(tasksWeekdayName(day)) \(formattedDayKey(day))"))
                .accessibilityValue(Text(L("%d jobs", count)))
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    private func weekLabel(_ week: WeekBoardResponse) -> String {
        guard let first = week.weekKeys.first, let last = week.weekKeys.last else { return "" }
        return tasksDayRange(first, last)
    }

    private func go(to weekKey: String?) {
        store.week = weekKey
        Task {
            withNeonAnimation(NeonMotion.quick) { moving = true }
            await store.load(api)
            withNeonAnimation(NeonMotion.quick) { moving = false }
        }
    }

    // MARK: - A day

    private func dayCard(_ day: String, week: WeekBoardResponse, jobs: [AssignedJob]) -> some View {
        let parts = tasksDayParts(day)
        let today = day == week.todayKey
        let past = day < week.todayKey
        return VStack(alignment: .leading, spacing: jobs.isEmpty ? 0 : 6) {
            HStack(spacing: 12) {
                VStack(spacing: 0) {
                    Text(parts.month)
                        .font(.system(.caption2, weight: .bold))
                        .textCase(.uppercase)
                        .foregroundStyle(today ? Color.white.opacity(0.85) : NeonHue.indigo.deep.opacity(0.8))
                        .lineLimit(1)
                    Text(parts.day)
                        .font(.system(.title3, weight: .heavy))
                        .monospacedDigit()
                        .foregroundStyle(today ? Color.white : NeonHue.indigo.deep)
                }
                .frame(width: 46, height: 46)
                .background {
                    let shape = RoundedRectangle(cornerRadius: NeonRadius.tile(46), style: .continuous)
                    if today {
                        shape.fill(LinearGradient.neonBrand)
                    } else {
                        shape.fill(LinearGradient(colors: [NeonHue.indigo.wash, NeonHue.indigo.pastel], startPoint: .topLeading, endPoint: .bottomTrailing))
                    }
                }
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(tasksWeekdayName(day))
                            .font(.neonCardTitle)
                            .foregroundStyle(Color.neonInk)
                        if today {
                            Text(L("Today"))
                                .font(.system(.caption, weight: .bold))
                                .foregroundStyle(Color.neonIndigoStrong)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 2)
                                .background(Capsule().fill(NeonHue.indigo.wash))
                        }
                    }
                    Text(jobs.isEmpty ? L("Nothing planned") : (jobs.count == 1 ? L("1 job") : L("%d jobs", jobs.count)))
                        .font(.neonSubtitle)
                        .foregroundStyle(jobs.isEmpty ? Color.neonTextTertiary : Color.neonTextSecondary)
                }
                Spacer(minLength: 8)
                IconButton("plus", label: L("New job on this day"), look: .tinted, tint: .neonIndigoStrong, size: 34) {
                    editing = .new(day: day)
                }
            }
            .padding(.bottom, jobs.isEmpty ? 0 : 4)

            if !jobs.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(jobs.enumerated()), id: \.element.id) { index, job in
                        if index > 0 { NeonDivider().padding(.leading, 58) }
                        jobRow(job, week: week)
                    }
                }
                .padding(.horizontal, -NeonSpace.card + 2)
            }
        }
        .padding(NeonSpace.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .opacity(past && jobs.isEmpty ? 0.75 : 1)
    }

    @ViewBuilder
    private func jobRow(_ job: AssignedJob, week: WeekBoardResponse) -> some View {
        let owner = week.team.first { $0.id == job.employeeId }
        let span = job.days > 1
            ? L("%d days · %@ – %@", job.days, tasksShortDay(job.startKey, today: week.todayKey), tasksShortDay(job.endKey, today: week.todayKey))
            : nil
        Button {
            Haptic.tap()
            editing = .existing(job)
        } label: {
            ListRow(job.title, subtitle: owner?.name ?? job.employeeId, meta: span,
                    leading: .avatar(url: nil, name: owner?.name ?? "?"), chevron: true) {
                VStack(alignment: .trailing, spacing: 5) {
                    StateBadge(state: job.state)
                    HStack(spacing: 5) {
                        if job.priority == "HIGH" {
                            Image(systemName: "flame.fill")
                                .foregroundStyle(Color.neonPinkStrong)
                                .accessibilityLabel(L("High"))
                        }
                        if job.chatTaskId?.isEmpty == false {
                            Image(systemName: "bubble.left.and.bubble.right.fill")
                                .foregroundStyle(Color.neonTextTertiary)
                                .accessibilityLabel(L("From a chat task card"))
                        }
                    }
                    .font(.system(.caption2, weight: .bold))
                }
                .fixedSize()
            }
        }
        .buttonStyle(.pressableCard)
        .contextMenu {
            ForEach(["TODO", "IN_PROGRESS", "DONE"], id: \.self) { state in
                Button {
                    Task {
                        do {
                            try await api.setJobState(id: job.id, state: state)
                            Haptic.success()
                        } catch { Toast.error(error) }
                    }
                } label: {
                    Label(taskStateLabel(state), systemImage: tasksStateSymbol(state))
                }
                .disabled(job.state == state)
            }
            Divider()
            Button(role: .destructive) { deleting = job } label: {
                Label(L("Delete"), systemImage: "trash")
            }
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

    /// Whole days from the first to the last, both counted.
    private var dayCount: Int {
        let calendar = Calendar.current
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: startDay), to: calendar.startOfDay(for: endDay)).day ?? 0
        return max(1, days + 1)
    }

    var body: some View {
        SheetScaffold(existing == nil ? L("New job") : L("Edit job"),
                      subtitle: existing == nil ? L("Handed out by hand, outside any project") : nil,
                      symbol: "calendar.badge.clock",
                      primaryTitle: existing == nil ? L("Hand out") : L("Save"),
                      primaryKind: existing == nil ? .brand : .primary,
                      isPrimaryEnabled: isValid,
                      onPrimary: { await save() }) {
            if let existing {
                FormSection(L("State"), footer: L("A state changes the moment you tap it — it is not part of Save.")) {
                    TasksStatePicker(states: ["TODO", "IN_PROGRESS", "DONE"], current: state) { option in
                        await setState(option, jobId: existing.id)
                    }
                    if state == "SUBMITTED" {
                        StatusNote(symbol: "paperplane.fill", tone: .purple, title: L("Sent for review"),
                                   detail: L("The proof waits in Reviews, to approve or send back."))
                    }
                }
                if let chatTaskId = existing.chatTaskId, !chatTaskId.isEmpty {
                    StatusNote(symbol: "bubble.left.and.bubble.right.fill", tone: .info, title: L("From a chat task card"),
                               detail: L("This job was handed out from a conversation."))
                }
                if let last = existing.lastUpdateNote, !last.isEmpty {
                    FormSection(L("Last word from the team")) {
                        DirText(last, font: .neonCallout)
                        if let when = formattedISODate(existing.lastUpdateAt) {
                            MetaLabel(when, symbol: "clock")
                        }
                    }
                }
            }

            FormSection(L("Job")) {
                NeonTextField(L("Title"), text: $title, prompt: L("What needs doing"), symbol: "textformat", isRequired: true)
                if team.isEmpty {
                    StatusNote(symbol: "person.crop.circle.badge.exclamationmark", tone: .warning, title: L("Nobody on the board yet"),
                               detail: L("Add the team in Settings, and their work shows here."))
                } else {
                    MenuField(L("For"), selection: $employeeId, options: team.map(\.id),
                              title: { id in team.first { $0.id == id }?.name ?? id }, isRequired: true)
                }
            }

            FormSection(L("When"), footer: dayCount > 1 ? L("Runs %d days.", dayCount) : L("One day.")) {
                DateField(L("Starts"), date: $startDay)
                DateField(L("Ends"), date: $endDay, in: startDay...Date.distantFuture)
                MenuField(L("Priority"), selection: $priority, options: taskPriorities, title: localizedPriority)
            }
            .onChange(of: startDay) { newStart in
                if endDay < newStart { endDay = newStart }
            }

            FormSection(L("What it takes")) {
                NeonTextEditor(L("What to hand in"), text: $deliverable, minLines: 2, limit: 2000)
                NeonTextEditor(L("Counts as done when"), text: $acceptance,
                               prompt: L("One line per item — this is what a photo is checked against"), minLines: 3, limit: 4000)
                NeonTextEditor(L("Note"), text: $note, minLines: 2, limit: 2000)
            }

            if existing != nil {
                NeonButton(L("Delete this job"), symbol: "trash", kind: .destructive, size: .medium,
                           confirm: L("Delete this job?"), confirmMessage: L("It comes off the week for good.")) {
                    await delete()
                }
                .frame(maxWidth: .infinity)
            }
        }
        .neonSheet([.large])
    }

    private func setState(_ target: String, jobId: String) async {
        guard target != state else { return }
        do {
            try await api.setJobState(id: jobId, state: target)
            withNeonAnimation(NeonMotion.snappy) { state = target }
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
            Haptic.success()
            Toast.success(existing == nil ? L("Handed out") : L("Saved"))
            dismiss()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
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
