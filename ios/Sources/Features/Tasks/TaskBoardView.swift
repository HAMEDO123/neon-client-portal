import SwiftUI

/// The "Board" segment: `getTaskBoard()`'s matrix, as a phone can actually use
/// it — a card per project with its steps as chips, grouped by section, rather
/// than a table nobody can scroll on a screen this size. Tapping a chip opens
/// the cell editor.
struct TaskBoardView: View {
    @EnvironmentObject var api: APIClient
    @ObservedObject var store: TaskBoardStore

    @State private var query = ""
    @State private var person: String? // nil = everyone
    @State private var showLegend = false
    @State private var editing: EditingCell?
    @State private var resetting: BoardRow?

    struct EditingCell: Identifiable {
        let project: BoardProject
        let cell: BoardCell
        let step: BoardStepRef
        var id: String { "\(project.id):\(cell.taskId)" }
    }

    var body: some View {
        LoadStateView(value: store.value, error: store.errorMessage, cachedAt: store.cachedAt, retry: { await store.load(api) }) { board in
            NeonScroll {
                statTiles(board)

                SectionHeader(L("Upcoming"), count: board.upcoming.isEmpty ? nil : board.upcoming.count)
                if board.upcoming.isEmpty {
                    Text(L("Nothing due from the stage periods."))
                        .font(.system(size: 13))
                        .foregroundStyle(Color.neonTextTertiary)
                } else {
                    CardList(board.upcoming) { stage in
                        ListRow(
                            stage.taskName, subtitle: stage.projectName,
                            meta: formattedDay(stage.dueBy).map { L("Due %@", $0) },
                            leading: .icon("clock.badge.exclamationmark", tint: .neonOrangeStrong)
                        )
                    }
                }

                HStack {
                    SearchField(text: $query, prompt: L("Search projects"))
                    Button {
                        Haptic.tap()
                        withNeonAnimation { showLegend.toggle() }
                    } label: {
                        Image(systemName: "questionmark.circle")
                            .font(.system(size: 20))
                            .foregroundStyle(Color.neonInk.opacity(0.4))
                    }
                }

                if showLegend { legend }

                FilterChips(selection: $person, options: personOptions(board), inset: 16, title: personTitle(board))
                    .padding(.horizontal, -16)

                SectionHeader(L("Projects"), count: filteredRows(board).count)
                if filteredRows(board).isEmpty {
                    EmptyState(symbol: "square.grid.3x3", title: L("No projects match"))
                        .glassCard(radius: 18)
                } else {
                    ForEach(filteredRows(board)) { row in
                        projectCard(row, board: board)
                            .staggered(filteredRows(board).firstIndex { $0.id == row.id } ?? 0)
                    }
                }
            }
            .refreshable { await store.load(api) }
        }
        .sheet(item: $editing) { editing in
            CellEditorSheet(project: editing.project, cell: editing.cell, step: editing.step, board: store.value)
                .neonSheet([.large])
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
                    Toast.success(L("Project reset"))
                } catch { Toast.error(error) }
            }
        }
    }

    // MARK: - Stats

    @ViewBuilder
    private func statTiles(_ board: TaskBoardResponse) -> some View {
        StatGrid {
            StatTile(L("Active projects"), value: Double(board.stats.activeProjects), symbol: "folder", tint: .neonPurpleStrong)
            StatTile(L("Steps done"), text: "\(board.stats.stepsDone)/\(board.stats.stepsCounted)", symbol: "checkmark.seal", tint: .neonSuccessStrong)
            StatTile(L("In progress"), value: Double(board.stats.inProgress), symbol: "bolt", tint: .neonCyanStrong)
            StatTile(L("Due tomorrow"), value: Double(board.stats.dueTomorrow), symbol: "moon.stars", tint: .neonOrangeStrong)
        }
        if board.awaitingReview > 0 {
            StatusNote(
                symbol: "paperplane.fill", tone: .info,
                title: L("%d awaiting your review", board.awaitingReview),
                detail: L("Open Reviews from the Chat segment to approve or send work back.")
            )
        }
    }

    // MARK: - Legend

    private var legend: some View {
        FlowRow(spacing: 8) {
            ForEach(["TODO", "IN_PROGRESS", "SUBMITTED", "DONE", "TOMORROW"], id: \.self) { state in
                StateBadge(state: state)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.sunken, radius: 14)
        .transition(.neonRise)
    }

    // MARK: - Filtering

    private func personOptions(_ board: TaskBoardResponse) -> [String?] {
        [nil] + board.team.map { $0.id }
    }

    private func personTitle(_ board: TaskBoardResponse) -> (String?) -> String {
        { id in
            guard let id else { return L("Everyone") }
            return board.team.first { $0.id == id }?.name ?? id
        }
    }

    private func filteredRows(_ board: TaskBoardResponse) -> [BoardRow] {
        board.rows.filter { row in
            if !query.isEmpty, !"\(row.project.name) \(row.project.clientName ?? "")".matchesSearch(query) { return false }
            if let person { return row.cells.contains { $0.ownerId == person } }
            return true
        }
    }

    // MARK: - A project's card

    @ViewBuilder
    private func projectCard(_ row: BoardRow, board: TaskBoardResponse) -> some View {
        NeonCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    DirText(row.project.name, font: .system(size: 16, weight: .bold))
                    if let client = row.project.clientName, !client.isEmpty {
                        DirText(client, font: .system(size: 12.5), color: .neonTextSecondary)
                    }
                }
                Spacer(minLength: 8)
                Menu {
                    Button(L("Start over"), role: .destructive) { resetting = row }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 18))
                        .foregroundStyle(Color.neonInk.opacity(0.35))
                }
            }

            HStack(spacing: 10) {
                MetaLabel(L("%d done", row.done), symbol: "checkmark.circle")
                if row.tomorrow > 0 { MetaLabel(L("%d tomorrow", row.tomorrow), symbol: "moon.stars") }
            }

            ForEach(board.sections) { section in
                let stepsInSection = row.cells.filter { cell in
                    section.steps.contains { $0.id == cell.taskId } && (person == nil || cell.ownerId == person)
                }
                if !stepsInSection.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 6) {
                            Circle().fill(sectionAccentColor(section.color)).frame(width: 6, height: 6)
                            Text(section.name)
                                .font(.system(size: 11.5, weight: .semibold))
                                .foregroundStyle(Color.neonTextTertiary)
                                .textCase(.uppercase)
                        }
                        FlowRow(spacing: 6) {
                            ForEach(stepsInSection) { cell in
                                if let step = section.steps.first(where: { $0.id == cell.taskId }) {
                                    cellChip(cell, step: step, project: row.project)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private func cellChip(_ cell: BoardCell, step: BoardStepRef, project: BoardProject) -> some View {
        Button {
            Haptic.tap()
            editing = EditingCell(project: project, cell: cell, step: step)
        } label: {
            HStack(spacing: 5) {
                if let symbol = StateBadge.symbol(for: cell.state) {
                    Image(systemName: symbol).font(.system(size: 9, weight: .bold))
                }
                Text(step.name).lineLimit(1)
                if cell.priority == "HIGH" {
                    Image(systemName: "flame.fill").font(.system(size: 9))
                }
            }
            .font(.system(size: 12.5, weight: .semibold))
            .foregroundStyle(taskStateTone(cell.state).foreground)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(taskStateTone(cell.state).background, in: Capsule())
            .overlay(
                Capsule().strokeBorder(cell.blockedReason != nil ? Color.neonDanger.opacity(0.6) : .clear, lineWidth: 1.3)
            )
        }
        .buttonStyle(PressableStyle(scale: 0.93))
    }
}
