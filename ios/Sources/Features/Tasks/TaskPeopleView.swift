import SwiftUI

// MARK: - The "Team" segment

/// For every person on the board, what share of the work they were given
/// this week (or month) is done — `tasks/people`. The whole team first, then a
/// colourful card each: their face, a ring with the percentage, a bar split
/// by where the rest stands. Tapping a card opens that person's list. "Done"
/// is the manager's word: work sent for review is counted separately, never
/// as done, and somebody given nothing reads "Nothing given", never 0%.
///
/// Content only: `TasksRootView` owns the scroll and the refresh.
struct TaskPeopleView: View {
    @EnvironmentObject var api: APIClient
    @ObservedObject var store: TaskPeopleStore

    var body: some View {
        LoadStateView(value: store.value, error: store.errorMessage, cachedAt: store.cachedAt, retry: { await store.load(api) }) {
            VStack(spacing: NeonSpace.stack) {
                SkeletonCard(lines: 2)
                SkeletonRows(count: 4)
            }
        } content: { data in
            VStack(alignment: .leading, spacing: NeonSpace.stack) {
                TaskPeoplePeriodBar(store: store, data: data)
                    .neonAppear()

                if data.people.isEmpty {
                    EmptyState(symbol: "person.3", title: L("Nobody on the board yet"),
                               detail: L("Add the team in Settings, and their work shows here."), hue: .indigo, card: true)
                } else {
                    TaskPeopleTeamCard(data: data)
                        .id("team")
                        .neonAppear(delay: 0.05)

                    SectionHeader(L("People"), count: data.people.count)
                        .padding(.top, NeonSpace.sm)
                        .id("people")

                    ForEach(Array(data.people.enumerated()), id: \.element.id) { index, person in
                        NavigationLink(value: TaskPeopleRoute(id: person.id)) {
                            TaskPeopleCard(person: person, period: data.period)
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

/// The colour a person carries on the board — `EMPLOYEE_COLORS` in
/// src/lib/task-board.ts — as a kit hue.
func taskPeopleHue(_ color: String) -> NeonHue {
    tasksColorHue(color, fallback: .purple)
}

/// A person's period split the way the website counts it (`countStates`):
/// done, sent for review, in progress, and everything else still to do.
func taskPeopleParts(done: Int, submitted: Int, inProgress: Int, todo: Int) -> [TasksBreakdownPart] {
    [
        TasksBreakdownPart(id: "DONE", label: L("Done"), count: done, hue: tasksStateHue("DONE")),
        TasksBreakdownPart(id: "SUBMITTED", label: L("Sent for review"), count: submitted, hue: tasksStateHue("SUBMITTED")),
        TasksBreakdownPart(id: "IN_PROGRESS", label: L("In progress"), count: inProgress, hue: tasksStateHue("IN_PROGRESS")),
        TasksBreakdownPart(id: "TODO", label: L("To do"), count: todo, hue: tasksStateHue("TODO")),
    ]
}

// MARK: - Week / Month, and which one

struct TaskPeoplePeriodBar: View {
    @EnvironmentObject var api: APIClient
    @ObservedObject var store: TaskPeopleStore
    let data: TaskPeopleResponse

    var body: some View {
        let month = data.period == "month"
        VStack(spacing: 14) {
            SegmentedPill(selection: $store.period, options: TaskPeopleStore.Period.allCases, title: \.label,
                          symbol: { $0 == .week ? "calendar" : "calendar.circle" })
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
        }
        .padding(NeonSpace.card)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .onChange(of: store.period) { _ in
            store.day = nil
            Task { await store.load(api) }
        }
    }

    private func go(to day: String?) {
        store.day = day
        Task { await store.load(api) }
    }
}

/// "27 Sep – 3 Oct" for a week, "September 2026" for a month.
func taskPeoplePeriodLabel(_ data: TaskPeopleResponse) -> String {
    if data.period == "month", let date = parseISODate("\(data.from)T00:00:00.000Z") {
        var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: AppLanguage.current.locale).month(.wide).year()
        style.timeZone = TimeZone(identifier: "UTC")!
        return date.formatted(style)
    }
    return "\(formattedDayKey(data.from)) – \(formattedDayKey(data.to))"
}

// MARK: - The whole team

/// Everybody's period in one card, by the same rule as each person's: done
/// over given, and nothing given is said as that, never as 0%.
struct TaskPeopleTeamCard: View {
    let data: TaskPeopleResponse

    var body: some View {
        let given = data.people.reduce(0) { $0 + $1.total }
        let done = data.people.reduce(0) { $0 + $1.done }
        let late = data.people.reduce(0) { $0 + $1.overdue }
        SectionCard(L("The team"),
                    subtitle: given == 0 ? taskPeopleNothingGiven(data.period) : L("Team: %d of %d done", done, given),
                    symbol: "person.3.fill", hue: .indigo) {
            if given > 0 {
                TasksBreakdown(parts: taskPeopleParts(
                    done: done,
                    submitted: data.people.reduce(0) { $0 + $1.submitted },
                    inProgress: data.people.reduce(0) { $0 + $1.inProgress },
                    todo: data.people.reduce(0) { $0 + $1.todo }
                ), columns: 4)
                if late > 0 {
                    StatusNote(symbol: "exclamationmark.triangle.fill", tone: .danger, title: L("%d overdue", late),
                               detail: L("Past the day it was due, and not done."))
                }
            } else {
                Text(L("Nothing given is not a mark against anybody."))
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextSecondary)
            }
        } trailing: {
            TaskPeopleRing(percent: given > 0 ? Int((Double(done) / Double(given) * 100).rounded()) : nil, size: 48, lineWidth: 6)
        }
    }
}

// MARK: - A person's card

struct TaskPeopleCard: View {
    let person: TaskPeopleMember
    let period: String

    var body: some View {
        let hue = taskPeopleHue(person.color)
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 12) {
                AvatarView(url: resolvedMediaURL(person.avatar), name: person.name, size: 52, ring: true)
                    .neonShadow(.glow(hue.color))
                VStack(alignment: .leading, spacing: 3) {
                    DirText(person.name, font: .system(.body, weight: .bold), fill: false, lineLimit: 1)
                    if let role = person.role, !role.isEmpty {
                        DirText(role, font: .neonSubtitle, color: .neonTextSecondary, fill: false, lineLimit: 1)
                    }
                    Text(person.total == 0 ? taskPeopleNothingGiven(period) : L("%d of %d done", person.done, person.total))
                        .font(.system(.footnote, weight: .semibold))
                        .foregroundStyle(person.total == 0 ? Color.neonTextTertiary : hue.deep)
                        .padding(.top, 1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                TaskPeopleRing(percent: person.percent, size: 64, lineWidth: 8)
            }

            if person.total > 0 {
                TasksBreakdown(parts: taskPeopleParts(done: person.done, submitted: person.submitted,
                                                      inProgress: person.inProgress, todo: person.todo),
                               barHeight: 8, showsKey: false)
                TaskPeopleCounts(person: person)
                HStack(spacing: 12) {
                    MetaLabel(L("Board steps %d/%d", person.boardCells.done, person.boardCells.total), symbol: "square.grid.3x3.fill")
                    MetaLabel(L("Jobs %d/%d", person.jobs.done, person.jobs.total), symbol: "calendar.badge.clock")
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.forward")
                        .font(.system(.caption, weight: .semibold))
                        .foregroundStyle(Color.neonTextFaint)
                }
            }
        }
        .padding(NeonSpace.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            // The person's own colour, washing in from the leading corner.
            RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous)
                .fill(LinearGradient(colors: [hue.wash, hue.wash.opacity(0)], startPoint: .topLeading, endPoint: .center))
                .flipsForRightToLeftLayoutDirection(true)
        }
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

/// Where the period's work stands: done, sent for review, in progress, to do,
/// and — in red — overdue.
struct TaskPeopleCounts: View {
    let person: TaskPeopleMember

    var body: some View {
        FlowRow(spacing: 6) {
            TaskPeopleCountChip(count: person.done, label: L("done"), symbol: "checkmark.seal.fill", tone: .success)
            TaskPeopleCountChip(count: person.submitted, label: L("sent for review"), symbol: "paperplane.fill", tone: .purple)
            TaskPeopleCountChip(count: person.inProgress, label: L("in progress"), symbol: "bolt.fill", tone: .cyan)
            TaskPeopleCountChip(count: person.todo, label: L("to do"), symbol: "circle.dashed", tone: .neutral)
            TaskPeopleCountChip(count: person.overdue, label: L("overdue"), symbol: "exclamationmark.triangle.fill", tone: .danger)
        }
    }
}

struct TaskPeopleCountChip: View {
    let count: Int
    let label: String
    let symbol: String
    let tone: BadgeTone

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: symbol).font(.system(.caption2, weight: .bold))
            Text(NeonFormat.integer(count)).font(.system(.caption, weight: .bold)).monospacedDigit()
            Text(label).font(.system(.caption, weight: .medium))
        }
        .foregroundStyle(tone.foreground)
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(tone.background, in: Capsule())
        .opacity(count == 0 ? 0.45 : 1)
        .accessibilityElement(children: .combine)
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
                        header(person, data: data)
                        if person.total > 0 {
                            SectionCard(L("Where it stands"), subtitle: L("%d of %d done", person.done, person.total),
                                        symbol: "chart.bar.fill", hue: taskPeopleHue(person.color)) {
                                TasksBreakdown(parts: taskPeopleParts(done: person.done, submitted: person.submitted,
                                                                      inProgress: person.inProgress, todo: person.todo), columns: 4)
                                if person.overdue > 0 {
                                    MetaLabel(L("%d overdue", person.overdue), symbol: "exclamationmark.triangle.fill", tint: .neonDangerStrong)
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
                .navigationTitle(person.name)
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

    private func header(_ person: TaskPeopleMember, data: TaskPeopleResponse) -> some View {
        let hue = taskPeopleHue(person.color)
        return VStack(spacing: 16) {
            HStack(spacing: 14) {
                AvatarView(url: resolvedMediaURL(person.avatar), name: person.name, size: 60, ring: true)
                    .neonShadow(.glow(hue.color))
                VStack(alignment: .leading, spacing: 4) {
                    DirText(person.name, font: .neonTitle2, fill: false, lineLimit: 2)
                    if let role = person.role, !role.isEmpty {
                        DirText(role, font: .neonSubtitle, color: .neonTextSecondary, fill: false, lineLimit: 1)
                    }
                    MetaLabel(taskPeoplePeriodLabel(data), symbol: "calendar", tint: hue.deep)
                }
                Spacer(minLength: 0)
            }

            TaskPeopleRing(percent: person.percent, size: 128, lineWidth: 14)
                .padding(.vertical, 4)

            Text(person.total == 0 ? taskPeopleNothingGiven(data.period) : L("%d of %d done", person.done, person.total))
                .font(.system(.headline, weight: .semibold))
                .foregroundStyle(person.total == 0 ? Color.neonTextTertiary : Color.neonInk)

            if person.total > 0 {
                HStack(spacing: 16) {
                    MetaLabel(L("Board steps %d/%d", person.boardCells.done, person.boardCells.total), symbol: "square.grid.3x3.fill", tint: .neonTextSecondary)
                    MetaLabel(L("Jobs %d/%d", person.jobs.done, person.jobs.total), symbol: "calendar.badge.clock", tint: .neonTextSecondary)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .background {
            RoundedRectangle(cornerRadius: NeonRadius.xl, style: .continuous)
                .fill(LinearGradient(colors: [hue.wash, hue.wash.opacity(0)], startPoint: .top, endPoint: .bottom))
        }
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
                group(L("Overdue"), symbol: "exclamationmark.triangle.fill", hue: .red, late, data: data)
                group(L("Still to do"), symbol: "circle.dashed", hue: .blue, open, data: data)
                group(L("Sent for review"), symbol: "paperplane.fill", hue: .purple, review, data: data)
                group(L("Done"), symbol: "checkmark.seal.fill", hue: .green, done, data: data)
            }
        }
    }

    @ViewBuilder
    private func group(_ title: String, symbol: String, hue: NeonHue, _ items: [TaskPeopleItem], data: TaskPeopleResponse) -> some View {
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
                                TaskPeopleItemRow(item: item, timezone: data.timezone, opens: true)
                            }
                            .buttonStyle(.pressableCard)
                        } else {
                            TaskPeopleItemRow(item: item, timezone: data.timezone, opens: false)
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

/// One board step or job in a person's list: what it is, where it stands,
/// and when it is (or was) due — in red once it is late.
struct TaskPeopleItemRow: View {
    let item: TaskPeopleItem
    let timezone: String
    let opens: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconTile(item.isCell ? "square.grid.3x3.fill" : "calendar.badge.clock",
                     hue: item.overdue ? .red : (item.isCell ? .purple : .cyan), size: 38)
            VStack(alignment: .leading, spacing: 5) {
                DirText(item.title, font: .neonRowTitle, fill: false, lineLimit: 2)
                if let project = item.projectName, !project.isEmpty {
                    DirText(project, font: .neonSubtitle, color: .neonTextSecondary, fill: false, lineLimit: 1)
                } else if !item.isCell {
                    Text(L("Job handed out by hand"))
                        .font(.neonSubtitle)
                        .foregroundStyle(Color.neonTextSecondary)
                }
                FlowRow(spacing: 6) {
                    StateBadge(state: item.state)
                    if item.priority == "HIGH" {
                        BadgeView(text: L("High"), tone: .pink, symbol: "flame.fill")
                    }
                    if let when = whenLabel {
                        MetaLabel(when.text, symbol: when.symbol, tint: when.tint)
                            .padding(.top, 3)
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
            return (L("Completed %@", completed), "checkmark", Color.neonSuccessStrong)
        }
        if let due = item.dueDay {
            var text = formattedDayKey(due)
            if let time = item.dueTime { text += " · \(time)" }
            if item.overdue { return (L("Was due %@", text), "exclamationmark.triangle.fill", Color.neonDangerStrong) }
            return (L("Due %@", text), item.dueSource == "derived" ? "timer" : "clock", Color.neonTextTertiary)
        }
        if let scheduled = item.scheduledFor {
            return (L("Scheduled %@", formattedDayKey(scheduled)), "calendar", Color.neonTextTertiary)
        }
        return nil
    }

    /// The day it was finished, on the studio's calendar.
    private var completedDay: String? {
        guard let date = parseISODate(item.completedAt) else { return nil }
        var style = Date.FormatStyle(date: .abbreviated, time: .omitted, locale: AppLanguage.current.locale)
        style.timeZone = TimeZone(identifier: timezone) ?? .current
        return date.formatted(style)
    }
}
