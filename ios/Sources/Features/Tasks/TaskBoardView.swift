import SwiftUI

/// The "Board" segment: `getTaskBoard()`'s matrix, as a phone can actually use
/// it — the four figures on top, where every counted step stands, what the
/// stage periods say is due next, then a card per project with its steps as
/// chips grouped by section, rather than a table nobody can scroll on a
/// screen this size. Tapping a chip (or an upcoming step) opens the cell editor.
///
/// Content only: `TasksRootView` owns the scroll, the header and the refresh.
struct TaskBoardView: View {
    @EnvironmentObject var api: APIClient
    @ObservedObject var store: TaskBoardStore

    @State private var query = ""
    @State private var person: String? // nil = everyone
    @State private var hideDone = false
    @State private var editing: EditingCell?
    @State private var resetting: BoardRow?

    struct EditingCell: Identifiable {
        let project: BoardProject
        let cell: BoardCell
        let step: BoardStepRef
        var id: String { "\(project.id):\(cell.taskId)" }
    }

    var body: some View {
        LoadStateView(value: store.value, error: store.errorMessage, cachedAt: store.cachedAt, retry: { await store.load(api) }) {
            TasksBoardSkeleton()
        } content: { board in
            VStack(alignment: .leading, spacing: NeonSpace.stack) {
                figures(board)
                standing(board)
                    .id("progress")
                    .neonAppear(delay: 0.05)
                if board.awaitingReview > 0 {
                    reviewLink(board.awaitingReview)
                        .transition(.neonRise)
                }
                upcoming(board)
                    .id("upcoming")
                    .neonAppear(delay: 0.1)
                projects(board)
                    .id("projects")
            }
        }
        .sheet(item: $editing) { editing in
            CellEditorSheet(project: editing.project, cell: editing.cell, step: editing.step, board: store.value)
        }
        .confirmDestructive(
            item: $resetting,
            title: { L("Start \"%@\" over?", $0.project.name) },
            message: { _ in L("Every ticked step on this project goes back to pending.") },
            actionTitle: L("Reset")
        ) { row in
            Task {
                do {
                    try await api.resetProjectTasks(projectId: row.project.id)
                    Haptic.success()
                    Toast.success(L("Project reset"))
                } catch { Toast.error(error) }
            }
        }
    }

    // MARK: - The four figures

    /// Four figures, none of them repeated below: the projects on the board
    /// (and how many of their counted steps are still open), the steps
    /// finished over the last seven days — with those days as bars and the
    /// change on the seven before — what is in progress, and what is planned
    /// for tomorrow. "In progress" and the steps in "Tomorrow" count the same
    /// counted set the card under them splits, so the two never differ.
    private func figures(_ board: TaskBoardResponse) -> some View {
        let cells = board.rows.flatMap(\.cells)
        let counted = cells.filter { !$0.excludedFromProgress }
        let open = counted.filter { $0.state != "DONE" }.count
        let inProgress = counted.filter { $0.state == "IN_PROGRESS" }.count
        // The server's figure is every step flagged for tomorrow plus the jobs
        // handed out to start tomorrow; the jobs are what is left once its own
        // steps are taken off, and the steps are then the counted ones.
        let jobsTomorrow = max(0, board.stats.dueTomorrow - cells.filter { $0.state == "TOMORROW" }.count)
        let tomorrow = counted.filter { $0.state == "TOMORROW" }.count + jobsTomorrow
        let week = TasksDoneWeek(cells: counted, todayKey: board.todayKey, timezone: board.timezone)
        return StatGrid(columns: 4) {
            KPICard(L("Active projects"), value: Double(board.stats.activeProjects), symbol: "folder.fill", hue: .blue,
                    caption: L("%d steps open", open), density: .compact)
            KPICard(L("Done in 7 days"), value: Double(week.done), symbol: "checkmark.seal.fill", hue: .green,
                    trend: week.trend, bars: week.bars, density: .compact)
            KPICard(L("In progress"), value: Double(inProgress), symbol: "bolt.fill", hue: .cyan, density: .compact)
            KPICard(L("Tomorrow"), value: Double(tomorrow), symbol: "moon.stars.fill", hue: .orange,
                    caption: L("steps and jobs"), density: .compact)
        }
    }

    // MARK: - Where the steps stand

    /// Every counted step on the board by state, and the ring with the share
    /// done. The subtitle says how many are counted; the ring and the key say
    /// the rest, so no figure is said twice.
    @ViewBuilder
    private func standing(_ board: TaskBoardResponse) -> some View {
        let cells = board.rows.flatMap(\.cells)
        let counted = cells.filter { !$0.excludedFromProgress }
        let blocked = cells.filter { $0.blockedReason?.isEmpty == false }.count
        let high = cells.filter { $0.priority == "HIGH" && $0.state != "DONE" }.count
        let notCounted = cells.count - counted.count
        SectionCard(L("Where the steps stand"),
                    subtitle: counted.isEmpty ? L("No steps counted yet") : L("%d counted steps", counted.count),
                    symbol: "chart.bar.doc.horizontal.fill", hue: .indigo) {
            TasksBreakdown(parts: TasksBreakdownPart.states(counted.map(\.state)))
            NeonDivider()
            // The chips' key: what the marks on a step mean, each with how
            // many carry it. A mark nobody carries stays grey, so "0 blocked"
            // never reads as an alarm.
            FlowRow(spacing: NeonSpace.md) {
                MetaLabel(L("%d high priority", high), symbol: "flame.fill", tint: high > 0 ? .neonPinkStrong : .neonTextTertiary)
                MetaLabel(L("%d blocked", blocked), symbol: "exclamationmark.octagon.fill", tint: blocked > 0 ? .neonDangerStrong : .neonTextTertiary)
                MetaLabel(L("%d not counted", notCounted), symbol: "circle.lefthalf.filled", tint: .neonTextTertiary)
            }
        } trailing: {
            if !counted.isEmpty {
                ProgressRing(progress: Double(board.stats.stepsDone) / Double(max(board.stats.stepsCounted, 1)), size: 46, lineWidth: 6,
                             tint: board.stats.stepsDone == board.stats.stepsCounted ? .neonSuccess : nil)
            }
        }
    }

    private func reviewLink(_ count: Int) -> some View {
        NavigationLink { ReviewsRootView() } label: {
            HStack(spacing: 12) {
                IconTile("paperplane.fill", hue: .purple, size: NeonSize.iconTileLarge, style: .filled)
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("%d awaiting your review", count))
                        .font(.neonRowTitle)
                        .foregroundStyle(Color.neonInk)
                    Text(L("Approve the proof, or send the work back."))
                        .font(.neonSubtitle)
                        .foregroundStyle(Color.neonTextSecondary)
                }
                Spacer(minLength: 8)
                CountBadge(count, tone: .purple, size: 22)
                Image(systemName: "chevron.forward")
                    .font(.system(.footnote, weight: .semibold))
                    .foregroundStyle(Color.neonTextFaint)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .rowCard(pinned: true)
        }
        .buttonStyle(.pressableCard)
    }

    // MARK: - Due dates

    /// What the stage periods say is due, soonest first: what is already past
    /// its deadline under its own red heading, then what comes next — so a
    /// card of late work is never called "Upcoming".
    @ViewBuilder
    private func upcoming(_ board: TaskBoardResponse) -> some View {
        let late = board.upcoming.filter { $0.dueDayKey < board.todayKey }
        let next = board.upcoming.filter { $0.dueDayKey >= board.todayKey }
        SectionCard(L("Due dates"), subtitle: L("From the stage periods"),
                    symbol: late.isEmpty ? "hourglass" : "exclamationmark.triangle.fill", hue: late.isEmpty ? .orange : .red,
                    spacing: board.upcoming.isEmpty ? 14 : 8) {
            if board.upcoming.isEmpty {
                Text(L("Nothing due from the stage periods."))
                    .font(.neonLabel)
                    .foregroundStyle(Color.neonTextSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                if !late.isEmpty {
                    dueGroup(L("Past their deadline"), symbol: "exclamationmark.triangle.fill", tint: .neonDangerStrong, late, board: board)
                }
                if !next.isEmpty {
                    dueGroup(L("Coming up"), symbol: "hourglass", tint: .neonTextSecondary, next, board: board)
                        .padding(.top, late.isEmpty ? 0 : NeonSpace.sm)
                }
            }
        }
    }

    private func dueGroup(_ title: String, symbol: String, tint: Color, _ stages: [UpcomingStage], board: TaskBoardResponse) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            MetaLabel(title, symbol: symbol, tint: tint)
                .accessibilityAddTraits(.isHeader)
            VStack(spacing: 0) {
                ForEach(Array(stages.enumerated()), id: \.element.id) { index, stage in
                    if index > 0 { NeonDivider().padding(.leading, 60) }
                    upcomingRow(stage, board: board)
                }
            }
            .padding(.horizontal, -NeonSpace.card + 2)
        }
    }

    @ViewBuilder
    private func upcomingRow(_ stage: UpcomingStage, board: TaskBoardResponse) -> some View {
        let target = editingCell(projectId: stage.projectId, taskId: stage.taskId, board: board)
        let late = stage.dueDayKey < board.todayKey
        let cover = board.rows.first { $0.project.id == stage.projectId }?.project.coverImageUrl
        let row = ListRow(stage.taskName, subtitle: stage.projectName,
                          leading: resolvedMediaURL(cover).map { RowLeading.thumbnail(url: $0) } ?? RowLeading.icon("folder.fill", tint: .neonBlueStrong),
                          titleLines: 1) {
            VStack(alignment: .trailing, spacing: 5) {
                Text(dueLabel(stage.dueDayKey, board: board))
                    .font(.system(.footnote, weight: .semibold))
                    .foregroundStyle(late ? Color.neonDangerStrong : Color.neonTextSecondary)
                    .lineLimit(1)
                StateBadge(state: stage.state)
            }
            .fixedSize()
        }
        if let target {
            Button {
                Haptic.tap()
                editing = target
            } label: { row }
            .buttonStyle(.pressableCard)
        } else {
            row
        }
    }

    /// "Today", "Tomorrow", "Was due Sep 12" or the day — on the studio's calendar.
    private func dueLabel(_ key: String, board: TaskBoardResponse) -> String {
        if key == board.todayKey { return L("Today") }
        if key == board.tomorrowKey { return L("Tomorrow") }
        if key < board.todayKey { return L("Was due %@", tasksShortDay(key, today: board.todayKey)) }
        return tasksShortDay(key, today: board.todayKey)
    }

    // MARK: - Projects

    @ViewBuilder
    private func projects(_ board: TaskBoardResponse) -> some View {
        let rows = filteredRows(board)
        VStack(alignment: .leading, spacing: NeonSpace.stack) {
            SectionHeader(L("Projects"), count: rows.count) {
                Chip(L("Hide completed"), symbol: hideDone ? "eye.slash.fill" : "eye.slash", isSelected: hideDone) {
                    withNeonAnimation(NeonMotion.smooth) { hideDone.toggle() }
                }
            }
            .padding(.top, NeonSpace.sm)

            SearchField(text: $query, prompt: L("Search projects"))

            if !board.team.isEmpty {
                TasksPersonFilter(selection: $person, people: board.team)
                    .padding(.horizontal, -NeonSpace.gutter)
            }

            if rows.isEmpty {
                EmptyState(symbol: "square.grid.3x3", title: board.rows.isEmpty ? L("No active projects") : L("No projects match"),
                           detail: board.rows.isEmpty ? L("A project's steps show here once it is active.") : L("Try another name, or everyone."),
                           hue: .blue, card: true)
            } else {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    TasksProjectCard(row: row, sections: board.sections, person: person, hideDone: hideDone,
                                     onOpen: { cell, step in editing = EditingCell(project: row.project, cell: cell, step: step) },
                                     onReset: { resetting = row })
                        .staggered(index)
                }
            }
        }
        .animation(NeonMotion.smooth, value: person)
        .animation(NeonMotion.smooth, value: query)
    }

    private func filteredRows(_ board: TaskBoardResponse) -> [BoardRow] {
        board.rows.filter { row in
            if !query.isEmpty, !matchesSearch(query, row.project.name, row.project.clientName) { return false }
            if let person { return row.cells.contains { $0.ownerId == person } }
            return true
        }
    }

    private func editingCell(projectId: String, taskId: String, board: TaskBoardResponse) -> EditingCell? {
        guard let row = board.rows.first(where: { $0.project.id == projectId }),
              let cell = row.cells.first(where: { $0.taskId == taskId }),
              let step = board.sections.lazy.flatMap(\.steps).first(where: { $0.id == taskId })
        else { return nil }
        return EditingCell(project: row.project, cell: cell, step: step)
    }
}

// MARK: - A project's card

/// One project on the board: its picture, name and client, a ring with its
/// share of counted steps done, a bar split by state, and every step as a
/// chip under its section. With a person chosen, only their steps count.
struct TasksProjectCard: View {
    let row: BoardRow
    let sections: [BoardSection]
    let person: String?
    let hideDone: Bool
    let onOpen: (BoardCell, BoardStepRef) -> Void
    let onReset: () -> Void

    /// Sections whose completed steps are unfolded.
    @State private var openSections: Set<String> = []

    var body: some View {
        let cells = row.cells.filter { person == nil || $0.ownerId == person }
        let counted = cells.filter { !$0.excludedFromProgress }
        let done = counted.filter { $0.state == "DONE" }.count
        let tomorrow = counted.filter { $0.state == "TOMORROW" }.count
        let blocked = cells.filter { $0.blockedReason?.isEmpty == false }.count
        let high = cells.filter { $0.priority == "HIGH" && $0.state != "DONE" }.count

        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 12) {
                cover
                VStack(alignment: .leading, spacing: 3) {
                    DirText(row.project.name, font: .system(.body, weight: .bold), fill: false, lineLimit: 2)
                    if let client = row.project.clientName, !client.isEmpty {
                        DirText(client, font: .neonSubtitle, color: .neonTextSecondary, fill: false, lineLimit: 1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if counted.isEmpty {
                    Text(verbatim: "—")
                        .font(.system(.headline, weight: .bold))
                        .foregroundStyle(Color.neonTextTertiary)
                        .frame(width: 52, height: 52)
                } else {
                    ProgressRing(progress: Double(done) / Double(counted.count), size: 46, lineWidth: 6,
                                 tint: done == counted.count ? .neonSuccess : nil)
                }
                Menu {
                    Button(role: .destructive, action: onReset) {
                        Label(L("Start over"), systemImage: "arrow.counterclockwise")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(.subheadline, weight: .bold))
                        .rotationEffect(.degrees(90))
                        .foregroundStyle(Color.neonTextTertiary)
                        .frame(width: 28, height: 44)
                        .contentShape(Rectangle())
                }
                .padding(.trailing, -8)
                .accessibilityLabel(L("More"))
            }

            TasksBreakdown(parts: TasksBreakdownPart.states(counted.map(\.state)), barHeight: 8, showsKey: false)

            FlowRow(spacing: NeonSpace.md) {
                MetaLabel(L("%d of %d done", done, counted.count), symbol: "checkmark.circle.fill", tint: .neonSuccessStrong)
                if tomorrow > 0 { MetaLabel(L("%d tomorrow", tomorrow), symbol: "moon.stars.fill", tint: .neonOrangeStrong) }
                if blocked > 0 { MetaLabel(L("%d blocked", blocked), symbol: "exclamationmark.octagon.fill", tint: .neonDangerStrong) }
                if high > 0 { MetaLabel(L("%d high priority", high), symbol: "flame.fill", tint: .neonPinkStrong) }
            }

            let groups = TasksSectionGroup.groups(cells: cells, sections: sections, hideDone: hideDone)
            if groups.isEmpty {
                Text(hideDone && !cells.isEmpty ? L("Every step here is completed.") : L("No steps here."))
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextTertiary)
            } else {
                ForEach(groups) { group in
                    let section = group.section
                    let sectionCells = cells.filter { cell in section.steps.contains { $0.id == cell.taskId } && !cell.excludedFromProgress }
                    let unfolded = openSections.contains(section.id)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 7) {
                            Circle()
                                .fill(tasksColorHue(section.color).color)
                                .frame(width: 8, height: 8)
                            DirText(section.name, font: .system(.caption, weight: .bold), color: .neonTextSecondary, fill: false, lineLimit: 1)
                            Spacer(minLength: 4)
                            if !sectionCells.isEmpty {
                                Text(verbatim: "\(NeonFormat.integer(sectionCells.filter { $0.state == "DONE" }.count))/\(NeonFormat.integer(sectionCells.count))")
                                    .font(.system(.caption, weight: .semibold))
                                    .monospacedDigit()
                                    .foregroundStyle(Color.neonTextTertiary)
                            }
                        }
                        // What is still open, each on its own chip; what is
                        // finished folded into one chip that opens on a tap, so
                        // the open steps are not lost among a wall of green.
                        FlowRow(spacing: 6) {
                            ForEach(group.open) { item in
                                TasksCellChip(cell: item.cell, name: item.step.name) { onOpen(item.cell, item.step) }
                                    .transition(.neonPop)
                            }
                            if !hideDone, !group.done.isEmpty {
                                Chip(L("%d completed", group.done.count), symbol: unfolded ? "chevron.up" : "checkmark.seal.fill",
                                     isSelected: unfolded, tint: .neonSuccessStrong) {
                                    withNeonAnimation(NeonMotion.smooth) {
                                        if unfolded { openSections.remove(section.id) } else { openSections.insert(section.id) }
                                    }
                                }
                                .accessibilityHint(Text(unfolded ? L("Hides the completed steps") : L("Shows the completed steps")))
                                if unfolded {
                                    ForEach(group.done) { item in
                                        TasksCellChip(cell: item.cell, name: item.step.name) { onOpen(item.cell, item.step) }
                                            .transition(.neonPop)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        .padding(NeonSpace.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .neonContextShape(radius: NeonRadius.lg)
        .animation(NeonMotion.smooth, value: hideDone)
    }

    @ViewBuilder
    private var cover: some View {
        if let url = resolvedMediaURL(row.project.coverImageUrl) {
            RemoteImage(url: url)
                .frame(width: 52, height: 52)
                .clipShape(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous))
                .accessibilityHidden(true)
        } else {
            IconTile("folder.fill", hue: .blue, size: 52)
        }
    }
}

/// A section of a project's card: the section, its steps still open, and
/// its completed ones (folded on the card).
struct TasksSectionGroup: Identifiable {
    struct Item: Identifiable {
        let cell: BoardCell
        let step: BoardStepRef
        var id: String { cell.taskId }
    }

    let section: BoardSection
    let open: [Item]
    let done: [Item]
    var id: String { section.id }

    /// Each section with its cells, in the board's own order; a section with
    /// nothing to show is left out — with "Hide completed" on, that is one
    /// whose every step is completed.
    static func groups(cells: [BoardCell], sections: [BoardSection], hideDone: Bool) -> [TasksSectionGroup] {
        sections.compactMap { section in
            let items = cells.compactMap { cell in
                section.steps.first { $0.id == cell.taskId }.map { Item(cell: cell, step: $0) }
            }
            let open = items.filter { $0.cell.state != "DONE" }
            let done = hideDone ? [] : items.filter { $0.cell.state == "DONE" }
            return open.isEmpty && done.isEmpty ? nil : TasksSectionGroup(section: section, open: open, done: done)
        }
    }
}

// MARK: - The last seven days

/// Steps finished over the last seven days on the studio's calendar, read
/// off each counted cell's `completedAt` — the moment it was ticked or
/// approved — with each day as a bar and the change on the seven days
/// before. A step reopened since loses its moment and is not counted; one
/// finished before anybody recorded the moment has none and is not guessed.
struct TasksDoneWeek {
    let done: Int
    let bars: [Double]?
    let trend: StatTrend?

    init(cells: [BoardCell], todayKey: String, timezone: String) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timezone) ?? .current
        var perDay: [String: Int] = [:]
        for cell in cells where cell.state == "DONE" {
            guard let at = parseISODate(cell.completedAt) else { continue }
            perDay[NeonFormat.dayKey(at, calendar: calendar), default: 0] += 1
        }
        // Today and the thirteen days before it, newest first.
        let days = (0..<14).map { tasksShiftDay(todayKey, by: -$0) }
        let week = days.prefix(7).reversed().map { perDay[$0] ?? 0 }
        let before = days.suffix(7).reduce(0) { $0 + (perDay[$1] ?? 0) }
        done = week.reduce(0, +)
        bars = week.contains { $0 > 0 } ? week.map(Double.init) : nil
        let change = done - before
        if done == 0 && before == 0 {
            trend = nil
        } else if change == 0 {
            trend = .steady(L("No change"), L("vs the week before"))
        } else {
            let text = "\u{200E}" + (change > 0 ? "+" : "−") + NeonFormat.integer(abs(change))
            // Fewer finished is a fact about the week, not a verdict on
            // anybody: fewer may simply have been due.
            trend = change > 0 ? .rising(text, L("vs the week before")) : .falling(text, L("vs the week before"), tone: .neutral)
        }
    }
}

// MARK: - Loading

/// The board's shape while it loads: four figures, then two cards.
struct TasksBoardSkeleton: View {
    var body: some View {
        VStack(spacing: NeonSpace.stack) {
            StatGrid(columns: 4) {
                ForEach(0..<4, id: \.self) { _ in SkeletonKPICard(compact: true) }
            }
            SkeletonCard(lines: 3)
            SkeletonCard(lines: 4)
        }
    }
}
