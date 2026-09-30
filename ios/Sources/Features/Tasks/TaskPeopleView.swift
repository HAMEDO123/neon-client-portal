import SwiftUI

// MARK: - The "Team" segment

/// For every person on the board, what share of the work they were given
/// this week (or month) is done — `tasks/people`. The whole team first, with
/// the period and its navigator on the same card, then a white card each:
/// their face on their board colour, a ring with the percentage, a bar split
/// by where the rest stands. Tapping a card opens that person's list.
/// "Completed" is the manager's word: work sent for review is counted
/// separately, never as done, and somebody given nothing reads "Nothing
/// given", never 0%. Every figure says what it counts — jobs, board steps or
/// both — because the server counts a board step only once it is scheduled
/// or due in the period.
///
/// Content only: `TasksRootView` owns the scroll and the refresh.
struct TaskPeopleView: View {
    @EnvironmentObject var api: APIClient
    @ObservedObject var store: TaskPeopleStore

    var body: some View {
        LoadStateView(value: store.value, error: store.errorMessage, cachedAt: store.cachedAt, retry: { await store.load(api) }) {
            VStack(spacing: NeonSpace.stack) {
                SkeletonCard(lines: 3)
                SkeletonRows(count: 4)
            }
        } content: { data in
            VStack(alignment: .leading, spacing: NeonSpace.stack) {
                TaskPeopleTeamCard(store: store, data: data)
                    .id("team")
                    .neonAppear()

                if data.people.isEmpty {
                    EmptyState(symbol: "person.3", title: L("Nobody on the board yet"),
                               detail: L("Add the team in Settings, and their work shows here."), hue: .indigo, card: true)
                } else {
                    SectionHeader(L("People"), count: data.people.count)
                        .padding(.top, NeonSpace.sm)
                        .id("people")

                    let hues = TasksTeamHues(data.people)
                    ForEach(Array(data.people.enumerated()), id: \.element.id) { index, person in
                        NavigationLink(value: TaskPeopleRoute(id: person.id)) {
                            TaskPeopleCard(person: person, period: data.period, hue: hues.hue(person))
                        }
                        .buttonStyle(.pressableCard)
                        .staggered(index)
                    }
                }
            }
        }
        .task {
            if !store.loaded { await store.load(api) }
        }
    }
}

/// Opens one person's list, inside the Tasks tab's stack.
struct TaskPeopleRoute: Hashable {
    let id: String
}

func taskPeopleNothingGiven(_ period: String) -> String {
    period == "month" ? L("Nothing given this month") : L("Nothing given this week")
}

/// A person's period split the way the website counts it (`countStates`),
/// in the words every other screen of the tab uses (`taskStateLabel`):
/// completed, sent for review, in progress, and pending — which holds work
/// planned for tomorrow too, as the server counts it.
func taskPeopleParts(done: Int, submitted: Int, inProgress: Int, todo: Int) -> [TasksBreakdownPart] {
    [
        TasksBreakdownPart(id: "DONE", label: taskStateLabel("DONE"), count: done, hue: tasksStateHue("DONE")),
        TasksBreakdownPart(id: "SUBMITTED", label: taskStateLabel("SUBMITTED"), count: submitted, hue: tasksStateHue("SUBMITTED")),
        TasksBreakdownPart(id: "IN_PROGRESS", label: taskStateLabel("IN_PROGRESS"), count: inProgress, hue: tasksStateHue("IN_PROGRESS")),
        TasksBreakdownPart(id: "TODO", label: taskStateLabel("TODO"), count: todo, hue: tasksStateHue("TODO")),
    ]
}

/// "8 of 9 jobs done" when everything given was a job handed out by hand,
/// "3 of 5 board steps done" when everything was on the board, "11 of 14
/// done" when it was both — so a percentage never looks as if it covers the
/// board when no board step was in the period at all.
func taskPeopleDoneLine(done: Int, total: Int, cells: Int, jobs: Int) -> String {
    if cells == 0 { return L("%d of %d jobs done", done, total) }
    if jobs == 0 { return L("%d of %d board steps done", done, total) }
    return L("%d of %d done", done, total)
}

/// "5 jobs overdue", "2 board steps overdue" or "3 overdue" — past the day it
/// was due and not done — or nothing when none is.
func taskPeopleOverdueLine(_ items: [TaskPeopleItem]) -> String? {
    let late = items.filter(\.overdue)
    guard !late.isEmpty else { return nil }
    if late.allSatisfy({ !$0.isCell }) { return late.count == 1 ? L("1 job overdue") : L("%d jobs overdue", late.count) }
    if late.allSatisfy(\.isCell) { return late.count == 1 ? L("1 board step overdue") : L("%d board steps overdue", late.count) }
    return L("%d overdue", late.count)
}

/// "Board steps 3/5 · Jobs 8/9", only when the period held both kinds —
/// with one kind, the done line has already said which.
func taskPeopleKindsLine(cells: TaskPeopleCount, jobs: TaskPeopleCount) -> String? {
    guard cells.total > 0, jobs.total > 0 else { return nil }
    return L("Board steps %d/%d", cells.done, cells.total) + " · " + L("Jobs %d/%d", jobs.done, jobs.total)
}

/// "27 Sep – 3 Oct" for a week, "September 2026" for a month.
func taskPeoplePeriodLabel(_ data: TaskPeopleResponse) -> String {
    if data.period == "month", let date = parseISODate("\(data.from)T00:00:00.000Z") {
        var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: AppLanguage.current.locale).month(.wide).year()
        style.timeZone = TimeZone(identifier: "UTC")!
        return date.formatted(style)
    }
    return tasksDayRange(data.from, data.to)
}

// MARK: - The whole team

/// Everybody's period in one card, by the same rule as each person's: done
/// over given, and nothing given is said as that, never as 0%. The period is
/// chosen here too — a menu in the card's corner and the navigator under the
/// heading — rather than on a second segment switch of its own.
struct TaskPeopleTeamCard: View {
    @EnvironmentObject var api: APIClient
    @ObservedObject var store: TaskPeopleStore
    let data: TaskPeopleResponse

    var body: some View {
        let month = data.period == "month"
        let given = data.people.reduce(0) { $0 + $1.total }
        let done = data.people.reduce(0) { $0 + $1.done }
        let cells = data.people.reduce(0) { $0 + $1.boardCells.total }
        let jobs = data.people.reduce(0) { $0 + $1.jobs.total }
        SectionCard(L("The team"), symbol: "person.3.fill", hue: .indigo) {
            TasksPeriodNavigator(
                label: taskPeoplePeriodLabel(data),
                isCurrent: data.current,
                currentTitle: month ? L("This month") : L("This week"),
                backTitle: month ? L("Back to this month") : L("Back to this week"),
                previousLabel: month ? L("Previous month") : L("Previous week"),
                nextLabel: month ? L("Next month") : L("Next week"),
                loading: store.loading,
                onPrevious: { go(to: data.previous) },
                onNext: { go(to: data.next) },
                onCurrent: { go(to: nil) }
            )
            NeonDivider()
            if given > 0 {
                HStack(alignment: .center, spacing: 14) {
                    TaskPeopleRing(percent: Int((Double(done) / Double(given) * 100).rounded()), size: 52, lineWidth: 7)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(taskPeopleDoneLine(done: done, total: given, cells: cells, jobs: jobs))
                            .font(.system(.headline, weight: .semibold))
                            .foregroundStyle(Color.neonInk)
                        if let late = taskPeopleOverdueLine(data.people.flatMap(\.items)) {
                            MetaLabel(late, symbol: "exclamationmark.triangle.fill", tint: .neonDangerStrong)
                        }
                    }
                    Spacer(minLength: 0)
                }
                TasksBreakdown(parts: taskPeopleParts(
                    done: done,
                    submitted: data.people.reduce(0) { $0 + $1.submitted },
                    inProgress: data.people.reduce(0) { $0 + $1.inProgress },
                    todo: data.people.reduce(0) { $0 + $1.todo }
                ), columns: 2)
            } else {
                VStack(alignment: .leading, spacing: 3) {
                    Text(taskPeopleNothingGiven(data.period))
                        .font(.system(.headline, weight: .semibold))
                        .foregroundStyle(Color.neonTextSecondary)
                    Text(L("Nothing given is not a mark against anybody."))
                        .font(.neonSubtitle)
                        .foregroundStyle(Color.neonTextTertiary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } trailing: {
            PillMenu(month ? L("Month") : L("Week")) {
                ForEach(TaskPeopleStore.Period.allCases) { option in
                    Button {
                        choose(option)
                    } label: {
                        if option == store.period {
                            Label(option.label, systemImage: "checkmark")
                        } else {
                            Text(option.label)
                        }
                    }
                }
            }
            .accessibilityLabel(L("Period"))
        }
    }

    private func choose(_ period: TaskPeopleStore.Period) {
        guard period != store.period else { return }
        Haptic.selection()
        store.period = period
        store.day = nil
        Task { await store.load(api) }
    }

    private func go(to day: String?) {
        store.day = day
        Task { await store.load(api) }
    }
}

// MARK: - A person's card

/// One person on a white card: their face on their board colour, their role,
/// how much of what they were given is done and what that counts, the ring,
/// the split bar, and a chip for each state they have work in.
struct TaskPeopleCard: View {
    let person: TaskPeopleMember
    let period: String
    let hue: NeonHue

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .center, spacing: 12) {
                    TasksAvatar(name: person.name, hue: hue, size: 48)
                    VStack(alignment: .leading, spacing: 3) {
                        DirText(person.name, font: .system(.body, weight: .bold), fill: false, lineLimit: 1)
                        if let role = person.role, !role.isEmpty {
                            DirText(role, font: .neonSubtitle, color: .neonTextSecondary, fill: false, lineLimit: 1)
                        }
                        Text(person.total == 0
                             ? taskPeopleNothingGiven(period)
                             : taskPeopleDoneLine(done: person.done, total: person.total, cells: person.boardCells.total, jobs: person.jobs.total))
                            .font(.system(.footnote, weight: .semibold))
                            .foregroundStyle(person.total == 0 ? Color.neonTextTertiary : Color.neonTextSecondary)
                        if let kinds = taskPeopleKindsLine(cells: person.boardCells, jobs: person.jobs) {
                            Text(kinds)
                                .font(.neonMeta)
                                .foregroundStyle(Color.neonTextTertiary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    TaskPeopleRing(percent: person.percent, size: 58, lineWidth: 8)
                }

                if person.total > 0 {
                    TasksBreakdown(parts: taskPeopleParts(done: person.done, submitted: person.submitted,
                                                          inProgress: person.inProgress, todo: person.todo),
                                   barHeight: 8, showsKey: false)
                    TaskPeopleCounts(person: person)
                }
            }
            Image(systemName: "chevron.forward")
                .font(.system(.footnote, weight: .semibold))
                .foregroundStyle(Color.neonTextFaint)
        }
        .padding(NeonSpace.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .neonContextShape(radius: NeonRadius.lg)
        .accessibilityElement(children: .combine)
    }
}

/// The ring: the percentage done, filling as it appears — green with a seal
/// once everything given is done. Nothing given is a dashed empty ring and a
/// dash, never 0%.
struct TaskPeopleRing: View {
    let percent: Int?
    var size: CGFloat = 82
    var lineWidth: CGFloat = 10

    var body: some View {
        if let percent {
            ProgressRing(progress: Double(percent) / 100, size: size, lineWidth: lineWidth,
                         tint: percent >= 100 ? Color.neonSuccess : nil)
                .overlay(alignment: .topTrailing) {
                    if percent >= 100 {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: max(12, size * 0.22)))
                            .foregroundStyle(Color.neonSuccessStrong)
                            .background(Circle().fill(Color.white).padding(2))
                            .transition(.neonPop)
                    }
                }
        } else {
            ZStack {
                Circle()
                    .strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [5, 5]))
                    .foregroundStyle(Color.neonTextFaint)
                Text(verbatim: "—")
                    .font(.system(size: max(12, size * 0.26), weight: .bold))
                    .foregroundStyle(Color.neonTextTertiary)
            }
            .frame(width: size, height: size)
            .padding(lineWidth / 2)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(L("Nothing given")))
        }
    }
}

/// Where the period's work stands, one capsule per state the person has
/// work in — completed, sent for review, in progress, and in red, overdue.
/// A state with nothing in it is left out rather than shown as a faded zero;
/// what is still pending is the grey end of the bar above.
struct TaskPeopleCounts: View {
    let person: TaskPeopleMember

    var body: some View {
        let parts: [(count: Int, text: String, tone: BadgeTone, symbol: String)] = [
            (person.done, L("%d completed", person.done), .success, "checkmark.seal.fill"),
            (person.submitted, L("%d sent for review", person.submitted), .purple, "paperplane.fill"),
            (person.inProgress, L("%d in progress", person.inProgress), .cyan, "bolt.fill"),
            (person.overdue, L("%d overdue", person.overdue), .danger, "exclamationmark.triangle.fill"),
        ].filter { $0.count > 0 }
        if !parts.isEmpty {
            FlowRow(spacing: 6) {
                ForEach(parts, id: \.text) { part in
                    StateBadge(part.text, tone: part.tone, symbol: part.symbol)
                }
            }
        }
    }
}

// MARK: - One person's list

/// Everything behind a person's number for the period: what is late, what is
/// still open, what waits on the manager's review, and what is done. A board
/// step opens the cell editor, as it does on the board.
struct TaskPeopleDetailView: View {
    let personId: String
    @ObservedObject var store: TaskPeopleStore
    @ObservedObject var board: TaskBoardStore

    @EnvironmentObject var api: APIClient
    @State private var editing: TaskBoardView.EditingCell?

    var body: some View {
        Group {
            if let data = store.value, let person = data.people.first(where: { $0.id == personId }) {
                ScrollViewReader { proxy in
                    NeonScroll(spacing: NeonSpace.stack) {
                        header(person, data: data, hue: TasksTeamHues(data.people).hue(person))
                        if person.total > 0 {
                            // The share done is the header's; this card only
                            // splits the rest by where it stands.
                            SectionCard(L("Where it stands"), symbol: "chart.bar.fill", hue: .indigo) {
                                TasksBreakdown(parts: taskPeopleParts(done: person.done, submitted: person.submitted,
                                                                      inProgress: person.inProgress, todo: person.todo), columns: 2)
                                if let late = taskPeopleOverdueLine(person.items) {
                                    MetaLabel(late, symbol: "exclamationmark.triangle.fill", tint: .neonDangerStrong)
                                }
                            }
                            .neonAppear(delay: 0.05)
                        }
                        lists(person, data: data)
                            .id("lists")
                    }
                    .refreshable {
                        await store.load(api)
                        await board.load(api)
                    }
                    #if DEBUG
                    .debugScroll(proxy)
                    #endif
                }
                // The header card already names them in large type; the bar
                // stays empty rather than saying it twice.
                .navigationTitle("")
            } else if store.value != nil {
                EmptyState(symbol: "person.crop.circle.badge.questionmark", title: L("No longer on the board"),
                           detail: L("They are not among the active people for this period."))
                    .frame(maxHeight: .infinity)
                    .neonAmbientBackground()
            } else if let error = store.errorMessage {
                ErrorState(message: error) { await store.load(api) }
                    .frame(maxHeight: .infinity)
                    .neonAmbientBackground()
            } else {
                NeonScroll {
                    SkeletonCard(lines: 4)
                    SkeletonRows(count: 4)
                }
                    .task { await store.load(api) }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $editing) { editing in
            CellEditorSheet(project: editing.project, cell: editing.cell, step: editing.step, board: board.value)
        }
    }

    // MARK: Header

    /// Who, which period, and the share of what they were given that is done
    /// — said once, with what it counts ("8 of 9 jobs done").
    private func header(_ person: TaskPeopleMember, data: TaskPeopleResponse, hue: NeonHue) -> some View {
        VStack(spacing: 16) {
            HStack(spacing: 14) {
                TasksAvatar(name: person.name, hue: hue, size: 60, ring: true)
                VStack(alignment: .leading, spacing: 4) {
                    DirText(person.name, font: .neonTitle2, fill: false, lineLimit: 2)
                        .accessibilityAddTraits(.isHeader)
                    if let role = person.role, !role.isEmpty {
                        DirText(role, font: .neonSubtitle, color: .neonTextSecondary, fill: false, lineLimit: 1)
                    }
                    MetaLabel(taskPeoplePeriodLabel(data), symbol: "calendar", tint: .neonTextSecondary)
                }
                Spacer(minLength: 0)
            }

            TaskPeopleRing(percent: person.percent, size: 128, lineWidth: 14)
                .padding(.vertical, 4)

            Text(person.total == 0
                 ? taskPeopleNothingGiven(data.period)
                 : taskPeopleDoneLine(done: person.done, total: person.total, cells: person.boardCells.total, jobs: person.jobs.total))
                .font(.system(.headline, weight: .semibold))
                .foregroundStyle(person.total == 0 ? Color.neonTextTertiary : Color.neonInk)

            if let kinds = taskPeopleKindsLine(cells: person.boardCells, jobs: person.jobs) {
                Text(kinds)
                    .font(.neonMeta)
                    .foregroundStyle(Color.neonTextSecondary)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .neonSurface(.glass, radius: NeonRadius.xl)
        .neonAppear()
    }

    // MARK: The list

    @ViewBuilder
    private func lists(_ person: TaskPeopleMember, data: TaskPeopleResponse) -> some View {
        if person.items.isEmpty {
            EmptyState(symbol: "tray", title: taskPeopleNothingGiven(data.period),
                       detail: L("Nothing given is not a mark against anybody."), hue: .indigo, card: true)
        } else {
            let late = person.items.filter { $0.overdue }
            let open = person.items.filter { !$0.overdue && $0.state != "SUBMITTED" && $0.state != "DONE" }
            let review = person.items.filter { !$0.overdue && $0.state == "SUBMITTED" }
            let done = person.items.filter { $0.state == "DONE" }
            VStack(spacing: NeonSpace.stack) {
                // A group whose title already says the state doesn't repeat
                // it on every row.
                group(L("Overdue"), symbol: "exclamationmark.triangle.fill", hue: .red, late, showsState: true, data: data)
                group(L("Still to do"), symbol: "circle.dashed", hue: .blue, open, showsState: true, data: data)
                group(taskStateLabel("SUBMITTED"), symbol: "paperplane.fill", hue: .purple, review, showsState: false, data: data)
                group(taskStateLabel("DONE"), symbol: "checkmark.seal.fill", hue: .green, done, showsState: false, data: data)
            }
        }
    }

    @ViewBuilder
    private func group(_ title: String, symbol: String, hue: NeonHue, _ items: [TaskPeopleItem], showsState: Bool, data: TaskPeopleResponse) -> some View {
        if !items.isEmpty {
            SectionCard(title, symbol: symbol, hue: hue, spacing: 6) {
                VStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { NeonDivider().padding(.leading, 62) }
                        if let target = editingCell(for: item) {
                            Button {
                                Haptic.tap()
                                editing = target
                            } label: {
                                TaskPeopleItemRow(item: item, timezone: data.timezone, todayKey: data.todayKey, showsState: showsState, opens: true)
                            }
                            .buttonStyle(.pressableCard)
                        } else {
                            TaskPeopleItemRow(item: item, timezone: data.timezone, todayKey: data.todayKey, showsState: showsState, opens: false)
                        }
                    }
                }
                .padding(.horizontal, -NeonSpace.card + 2)
            } trailing: {
                CountBadge(items.count, tone: .neutral)
            }
        }
    }

    /// The board's own cell, when this item is one of its cells and the
    /// board has it (an archived project's cell is not on the board).
    private func editingCell(for item: TaskPeopleItem) -> TaskBoardView.EditingCell? {
        guard item.isCell, let projectId = item.projectId, let taskId = item.taskId, let value = board.value,
              let row = value.rows.first(where: { $0.project.id == projectId }),
              let cell = row.cells.first(where: { $0.taskId == taskId }),
              let step = value.sections.lazy.flatMap(\.steps).first(where: { $0.id == taskId })
        else { return nil }
        return TaskBoardView.EditingCell(project: row.project, cell: cell, step: step)
    }
}

/// One board step or job in a person's list: what it is (a job's tile is the
/// calendar, a step's the board), the project a step belongs to, where it
/// stands when its group doesn't already say, and when it is — the days a
/// job runs, the day something is due (red once late), or the day it was
/// completed.
struct TaskPeopleItemRow: View {
    let item: TaskPeopleItem
    let timezone: String
    let todayKey: String
    var showsState = true
    let opens: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconTile(item.isCell ? "square.grid.3x3.fill" : "calendar.badge.clock",
                     hue: item.overdue ? .red : (item.isCell ? .purple : .cyan), size: 38)
                .accessibilityLabel(Text(item.isCell ? L("Board step") : L("Job handed out by hand")))
            VStack(alignment: .leading, spacing: 5) {
                TasksRowTitle(item.title)
                if let project = item.projectName, !project.isEmpty {
                    DirText(project, font: .neonSubtitle, color: .neonTextSecondary, fill: false, lineLimit: 1)
                }
                FlowRow(spacing: 6) {
                    if showsState {
                        StateBadge(state: item.state)
                    }
                    if item.priority == "HIGH" {
                        BadgeView(text: L("High"), tone: .pink, symbol: "flame.fill")
                    }
                    if let when = whenLabel {
                        MetaLabel(when.text, symbol: when.symbol, tint: when.tint)
                            .padding(.top, showsState || item.priority == "HIGH" ? 3 : 0)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if opens {
                Image(systemName: "chevron.forward")
                    .font(.system(.caption, weight: .semibold))
                    .foregroundStyle(Color.neonTextFaint)
                    .padding(.top, 10)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    private var whenLabel: (text: String, symbol: String, tint: Color)? {
        if item.state == "DONE", let completed = completedDay {
            // The group is "Completed"; the day is all that is left to say.
            return (completed, "checkmark", Color.neonSuccessStrong)
        }
        if item.overdue, let due = item.dueDay {
            var text = tasksShortDay(due, today: todayKey)
            if let time = item.dueTime { text += " · \(time)" }
            return (L("Was due %@", text), "exclamationmark.triangle.fill", Color.neonDangerStrong)
        }
        // A job runs over days: say them, rather than only the last.
        if !item.isCell, let start = item.startDay, let end = item.endDay, start != end {
            return (L("%@ – %@", tasksShortDay(start, today: todayKey), tasksShortDay(end, today: todayKey)), "calendar", Color.neonTextTertiary)
        }
        if let due = item.dueDay {
            var text = tasksShortDay(due, today: todayKey)
            if let time = item.dueTime { text += " · \(time)" }
            return (L("Due %@", text), item.dueSource == "derived" ? "timer" : "clock", Color.neonTextTertiary)
        }
        if let scheduled = item.scheduledFor {
            return (L("Scheduled %@", tasksShortDay(scheduled, today: todayKey)), "calendar", Color.neonTextTertiary)
        }
        return nil
    }

    /// The day it was finished, on the studio's calendar.
    private var completedDay: String? {
        guard let date = parseISODate(item.completedAt) else { return nil }
        let zone = TimeZone(identifier: timezone) ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: AppLanguage.current.locale).month(.abbreviated).day()
        if String(calendar.component(.year, from: date)) != todayKey.prefix(4) { style = style.year() }
        style.timeZone = zone
        return date.formatted(style)
    }
}
