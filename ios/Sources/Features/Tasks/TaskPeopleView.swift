import SwiftUI

// MARK: - The "Team" segment

/// For every person on the board, what share of the work they were given
/// this week (or month) is done — `tasks/people`. A colourful card each: their
/// face, a big ring with the percentage, and where the rest of it stands.
/// Tapping a card opens that person's list. "Done" is the manager's word: work
/// sent for review is counted separately, never as done, and somebody given
/// nothing reads "Nothing given", never 0%.
struct TaskPeopleView: View {
    @EnvironmentObject var api: APIClient
    @ObservedObject var store: TaskPeopleStore

    var body: some View {
        LoadStateView(value: store.value, error: store.errorMessage, cachedAt: store.cachedAt, retry: { await store.load(api) }) { data in
            NeonScroll {
                TaskPeoplePeriodBar(store: store, data: data)

                if data.people.isEmpty {
                    EmptyState(symbol: "person.3", title: L("Nobody on the board yet"),
                               detail: L("Add the team in Settings, and their work shows here."))
                        .glassCard(radius: 18)
                } else {
                    teamLine(data)
                    ForEach(Array(data.people.enumerated()), id: \.element.id) { index, person in
                        NavigationLink(value: TaskPeopleRoute(id: person.id)) {
                            TaskPeopleCard(person: person, period: data.period)
                        }
                        .buttonStyle(.pressableCard)
                        .staggered(index)
                    }
                }
            }
            .refreshable { await store.load(api) }
        }
        .task {
            if !store.loaded { await store.load(api) }
        }
    }

    /// The whole team in one line, by the same rule as each card.
    @ViewBuilder
    private func teamLine(_ data: TaskPeopleResponse) -> some View {
        let given = data.people.reduce(0) { $0 + $1.total }
        let done = data.people.reduce(0) { $0 + $1.done }
        let late = data.people.reduce(0) { $0 + $1.overdue }
        HStack(spacing: 12) {
            MetaLabel(given == 0 ? taskPeopleNothingGiven(data.period) : L("Team: %d of %d done", done, given),
                      symbol: "person.3.fill", tint: .neonTextSecondary)
            if late > 0 {
                MetaLabel(L("%d overdue", late), symbol: "exclamationmark.triangle.fill", tint: .neonDangerStrong)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 4)
    }
}

/// Opens one person's list, inside the Tasks tab's stack.
struct TaskPeopleRoute: Hashable {
    let id: String
}

func taskPeopleNothingGiven(_ period: String) -> String {
    period == "month" ? L("Nothing given this month") : L("Nothing given this week")
}

/// The accent a person carries on the board — `EMPLOYEE_COLORS` in
/// src/lib/task-board.ts — as a soft fill and a strong ink.
func taskPeopleAccent(_ color: String) -> (fill: Color, ink: Color) {
    switch color {
    case "cyan": return (.neonCyan, .neonCyanStrong)
    case "pink": return (.neonPink, .neonPinkStrong)
    case "orange": return (.neonOrange, .neonOrangeStrong)
    default: return (.neonPurple, .neonPurpleStrong)
    }
}

// MARK: - Week / Month, and which one

struct TaskPeoplePeriodBar: View {
    @EnvironmentObject var api: APIClient
    @ObservedObject var store: TaskPeopleStore
    let data: TaskPeopleResponse

    var body: some View {
        VStack(spacing: 10) {
            SegmentedPill(selection: $store.period, options: TaskPeopleStore.Period.allCases, title: \.label)

            HStack {
                IconButton("chevron.backward", label: data.period == "month" ? L("Previous month") : L("Previous week")) {
                    go(to: data.previous)
                }
                Spacer()
                VStack(spacing: 2) {
                    Text(taskPeoplePeriodLabel(data))
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.neonInk)
                    if data.current {
                        Text(data.period == "month" ? L("This month") : L("This week"))
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.neonPurpleStrong)
                    } else {
                        Button(data.period == "month" ? L("Back to this month") : L("Back to this week")) {
                            go(to: nil)
                        }
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.neonPurpleStrong)
                    }
                }
                .overlay(alignment: .trailing) {
                    if store.loading {
                        ProgressView().controlSize(.small).offset(x: 26)
                    }
                }
                Spacer()
                IconButton("chevron.forward", label: data.period == "month" ? L("Next month") : L("Next week")) {
                    go(to: data.next)
                }
            }
        }
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

// MARK: - A person's card

struct TaskPeopleCard: View {
    let person: TaskPeopleMember
    let period: String

    var body: some View {
        let accent = taskPeopleAccent(person.color)
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        AvatarView(url: resolvedMediaURL(person.avatar), name: person.name, size: 46, ring: true)
                            .shadow(color: accent.fill.opacity(0.35), radius: 8, x: 0, y: 3)
                        VStack(alignment: .leading, spacing: 2) {
                            DirText(person.name, font: .system(size: 17, weight: .bold, design: .rounded), lineLimit: 1)
                            if let role = person.role, !role.isEmpty {
                                DirText(role, font: .system(size: 12.5), color: .neonTextSecondary, lineLimit: 1)
                            }
                        }
                    }
                    Text(person.total == 0 ? taskPeopleNothingGiven(period) : L("%d of %d done", person.done, person.total))
                        .font(.system(size: 13.5, weight: .semibold))
                        .foregroundStyle(person.total == 0 ? Color.neonTextTertiary : accent.ink)
                }
                Spacer(minLength: 4)
                TaskPeopleRing(percent: person.percent, size: 82, lineWidth: 10, accent: accent.fill)
            }

            if person.total > 0 {
                TaskPeopleCounts(person: person)
                HStack(spacing: 12) {
                    MetaLabel(L("Board steps %d/%d", person.boardCells.done, person.boardCells.total), symbol: "square.grid.3x3")
                    MetaLabel(L("Jobs %d/%d", person.jobs.done, person.jobs.total), symbol: "calendar.badge.clock")
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.forward")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.neonInk.opacity(0.3))
                        .flipsForRightToLeftLayoutDirection(true)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous)
                .fill(LinearGradient(colors: [accent.fill.opacity(0.20), accent.fill.opacity(0.04)],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
        }
        .neonSurface(.glass, radius: NeonRadius.lg)
        .neonContextShape(radius: NeonRadius.lg)
        .accessibilityElement(children: .combine)
    }
}

/// The big ring: the percentage done, filling as it appears — green once
/// everything given is done. Nothing given is a dashed empty ring and a dash,
/// never 0%.
struct TaskPeopleRing: View {
    let percent: Int?
    var size: CGFloat = 82
    var lineWidth: CGFloat = 10
    var accent: Color = .neonPurple

    var body: some View {
        if let percent {
            ProgressRing(progress: Double(percent) / 100, size: size, lineWidth: lineWidth,
                         tint: percent >= 100 ? Color.neonSuccess : nil)
                .background(Circle().fill(Color.white.opacity(0.55)).padding(lineWidth / 2))
                .overlay(alignment: .topTrailing) {
                    if percent >= 100 {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: size * 0.22))
                            .foregroundStyle(Color.neonSuccessStrong)
                            .background(Circle().fill(Color.white).padding(2))
                            .transition(.neonPop)
                    }
                }
        } else {
            ZStack {
                Circle()
                    .strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [5, 5]))
                    .foregroundStyle(Color.neonInk.opacity(0.18))
                Text(verbatim: "—")
                    .font(.system(size: size * 0.26, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.neonTextTertiary)
            }
            .frame(width: size, height: size)
            .padding(lineWidth / 2)
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
            Image(systemName: symbol).font(.system(size: 9.5, weight: .bold))
            Text(verbatim: "\(count)").font(.system(size: 12.5, weight: .bold, design: .rounded)).monospacedDigit()
            Text(label).font(.system(size: 12, weight: .medium))
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
                NeonScroll {
                    header(person, data: data)
                    stats(person)
                    lists(person, data: data)
                }
                .refreshable {
                    await store.load(api)
                    await board.load(api)
                }
                .navigationTitle(person.name)
            } else if store.value != nil {
                EmptyState(symbol: "person.crop.circle.badge.questionmark", title: L("No longer on the board"))
                    .frame(maxHeight: .infinity)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .neonAmbientBackground()
        .sheet(item: $editing) { editing in
            CellEditorSheet(project: editing.project, cell: editing.cell, step: editing.step, board: board.value)
                .neonSheet([.large])
        }
    }

    // MARK: Header

    @ViewBuilder
    private func header(_ person: TaskPeopleMember, data: TaskPeopleResponse) -> some View {
        let accent = taskPeopleAccent(person.color)
        VStack(spacing: 14) {
            HStack(spacing: 12) {
                AvatarView(url: resolvedMediaURL(person.avatar), name: person.name, size: 56, ring: true)
                    .shadow(color: accent.fill.opacity(0.4), radius: 10, x: 0, y: 4)
                VStack(alignment: .leading, spacing: 3) {
                    DirText(person.name, font: .system(size: 20, weight: .bold, design: .rounded))
                    if let role = person.role, !role.isEmpty {
                        DirText(role, font: .system(size: 13), color: .neonTextSecondary)
                    }
                    Text(taskPeoplePeriodLabel(data))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(accent.ink)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            TaskPeopleRing(percent: person.percent, size: 132, lineWidth: 14, accent: accent.fill)

            Text(person.total == 0 ? taskPeopleNothingGiven(data.period) : L("%d of %d done", person.done, person.total))
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(person.total == 0 ? Color.neonTextTertiary : Color.neonInk)

            if person.total > 0 {
                HStack(spacing: 12) {
                    MetaLabel(L("Board steps %d/%d", person.boardCells.done, person.boardCells.total), symbol: "square.grid.3x3")
                    MetaLabel(L("Jobs %d/%d", person.jobs.done, person.jobs.total), symbol: "calendar.badge.clock")
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity)
        .background {
            RoundedRectangle(cornerRadius: NeonRadius.xl, style: .continuous)
                .fill(LinearGradient(colors: [accent.fill.opacity(0.22), accent.fill.opacity(0.05)],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
        }
        .neonSurface(.glass, radius: NeonRadius.xl)
        .neonAppear()
    }

    @ViewBuilder
    private func stats(_ person: TaskPeopleMember) -> some View {
        if person.total > 0 {
            StatGrid {
                StatTile(L("Done"), value: Double(person.done), symbol: "checkmark.seal", tint: .neonSuccessStrong)
                StatTile(L("Sent for review"), value: Double(person.submitted), symbol: "paperplane", tint: .neonPurpleStrong)
                StatTile(L("In progress"), value: Double(person.inProgress), symbol: "bolt", tint: .neonCyanStrong)
                StatTile(L("To do"), value: Double(person.todo), symbol: "circle.dashed", tint: .neonInk.opacity(0.6))
                StatTile(L("Overdue"), value: Double(person.overdue), symbol: "exclamationmark.triangle",
                         tint: person.overdue > 0 ? .neonDangerStrong : .neonInk.opacity(0.4))
            }
        }
    }

    // MARK: The list

    @ViewBuilder
    private func lists(_ person: TaskPeopleMember, data: TaskPeopleResponse) -> some View {
        if person.items.isEmpty {
            EmptyState(symbol: "tray", title: taskPeopleNothingGiven(data.period),
                       detail: L("Nothing given is not a mark against anybody."))
                .glassCard(radius: 18)
        } else {
            let late = person.items.filter { $0.overdue }
            let open = person.items.filter { !$0.overdue && $0.state != "SUBMITTED" && $0.state != "DONE" }
            let review = person.items.filter { !$0.overdue && $0.state == "SUBMITTED" }
            let done = person.items.filter { $0.state == "DONE" }
            group(L("Overdue"), late, data: data)
            group(L("Still to do"), open, data: data)
            group(L("Sent for review"), review, data: data)
            group(L("Done"), done, data: data)
        }
    }

    @ViewBuilder
    private func group(_ title: String, _ items: [TaskPeopleItem], data: TaskPeopleResponse) -> some View {
        if !items.isEmpty {
            SectionHeader(title, count: items.count)
            CardList(items) { item in
                let target = editingCell(for: item)
                if let target {
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
        HStack(alignment: .center, spacing: 12) {
            IconTile(item.isCell ? "square.grid.3x3" : "calendar.badge.clock",
                     tint: item.overdue ? .neonDangerStrong : (item.isCell ? .neonPurpleStrong : .neonCyanStrong), size: 36)
            VStack(alignment: .leading, spacing: 5) {
                DirText(item.title, font: .system(size: 15, weight: .semibold), lineLimit: 2)
                if let project = item.projectName, !project.isEmpty {
                    DirText(project, font: .system(size: 12.5), color: .neonTextSecondary, lineLimit: 1)
                } else if !item.isCell {
                    Text(L("Job handed out by hand"))
                        .font(.system(size: 12.5))
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
            Spacer(minLength: 4)
            if opens {
                Image(systemName: "chevron.forward")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.neonInk.opacity(0.3))
                    .flipsForRightToLeftLayoutDirection(true)
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
