import SwiftUI

// MARK: - The manager's Tasks tab

enum CardFilter: String, CaseIterable, Identifiable {
    case open, review, done, all
    var id: String { rawValue }
    var label: String {
        switch self {
        case .open: return L("Open")
        case .review: return L("Review")
        case .done: return L("Done")
        case .all: return L("All")
        }
    }
}

/// The "Chat" segment of `TasksRootView`: task cards handed out from a
/// conversation. Content only — the tab root owns the scroll, the refresh and
/// the `navigationDestination(for: ChatRoute.self)` that carries a card to
/// its conversation.
struct ManagerTasksView: View {
    @EnvironmentObject var api: APIClient
    @ObservedObject var cards: ChatCardsLoader
    /// The board's team, so each person on a card wears the colour they
    /// wear on every other segment.
    var team: [TaskPerson] = []
    /// Opens the team's chat, where a card is handed out from.
    let onOpenTeamChat: () -> Void
    @State private var filter: CardFilter = .open

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.stack) {
            NavigationLink { ReviewsRootView() } label: {
                entryRow(symbol: "checkmark.seal.fill", hue: .purple, title: L("Reviews"),
                         detail: L("Proof your team has sent, to approve or send back."), count: reviewCount)
            }
            .buttonStyle(.pressableCard)
            .neonAppear()

            // A task card is handed out from a conversation's + (the chat
            // area builds it); this opens the team's, natively.
            NavigationLink(value: tasksTeamChatRoute) {
                entryRow(symbol: "plus", hue: .indigo, title: L("Hand out a task"),
                         detail: L("Press + in the chat and choose Task. For one person, open their chat instead."), count: 0)
            }
            .buttonStyle(.pressableCard)
            .neonAppear(delay: 0.05)

            // No count here: the filter under it says how many each option
            // holds, and a total above an "Open" list that is empty read as
            // a contradiction.
            SectionHeader(L("Handed out in chat"))
                .padding(.top, NeonSpace.sm)

            PillFilterBar(selection: $filter, options: CardFilter.allCases, title: \.label,
                          count: { $0 == .review ? count(.review) : nil })

            if let cachedAt = cards.cachedAt { OfflineBanner(savedAt: cachedAt) }

            if !cards.loaded, let error = cards.errorMessage {
                ErrorState(message: error) { await cards.load(api) }
            } else if !cards.loaded {
                SkeletonRows(count: 4)
            } else if shown.isEmpty {
                EmptyState(symbol: "checklist", title: emptyTitle,
                           detail: filter == .open || filter == .all ? L("Hand one out with + in any chat.") : nil,
                           actionTitle: filter == .open || filter == .all ? L("Open team chat") : nil,
                           action: filter == .open || filter == .all ? onOpenTeamChat : nil,
                           hue: .indigo, card: true)
            } else {
                let hues = TasksTeamHues(team)
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, item in
                    NavigationLink(value: ChatRoute(item.conversation)) {
                        TasksChatCardRow(item: item, hues: hues)
                    }
                    .buttonStyle(.pressableCard)
                    .staggered(index)
                }
            }
        }
        .animation(NeonMotion.smooth, value: filter)
        // Read again each time the segment opens, over what is already shown.
        .task { await cards.load(api) }
    }

    private func entryRow(symbol: String, hue: NeonHue, title: String, detail: String, count: Int) -> some View {
        HStack(spacing: 12) {
            IconTile(symbol, hue: hue, size: NeonSize.iconTileLarge + 4, style: .filled)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.neonRowTitle)
                    .foregroundStyle(Color.neonInk)
                Text(detail)
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextSecondary)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            CountBadge(count, tone: .purple, size: 22)
            Image(systemName: "chevron.forward")
                .font(.system(.footnote, weight: .semibold))
                .foregroundStyle(Color.neonTextFaint)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .rowCard()
    }

    private var emptyTitle: String {
        switch filter {
        case .open: return L("No open task cards")
        case .review: return L("Nothing to review")
        case .done: return L("No finished task cards")
        case .all: return L("No tasks here")
        }
    }

    /// People on chat cards who have sent proof and wait on the manager.
    private var reviewCount: Int {
        cards.tasks.reduce(0) { $0 + ($1.message.task?.assignments.filter { $0.state == "SUBMITTED" }.count ?? 0) }
    }

    private func count(_ filter: CardFilter) -> Int {
        cards.tasks.filter { matches($0, filter) }.count
    }

    private var shown: [ChatCardsLoader.Item] {
        cards.tasks.filter { matches($0, filter) }
    }

    private func matches(_ item: ChatCardsLoader.Item, _ filter: CardFilter) -> Bool {
        guard let card = item.message.task else { return false }
        switch filter {
        case .open: return card.overall == "TODO" || card.overall == "IN_PROGRESS"
        case .review: return card.overall == "SUBMITTED"
        case .done: return card.overall == "DONE"
        case .all: return true
        }
    }
}

/// One task card from a chat, on a card of its own: what it is, its overall
/// state, where it was handed out and when it is due (red once late), and
/// each person on it with where their part stands.
struct TasksChatCardRow: View {
    let item: ChatCardsLoader.Item
    var hues = TasksTeamHues([TaskPerson]())

    var body: some View {
        if let card = item.message.task {
            let tone = taskStateTone(card.overall)
            HStack(alignment: .top, spacing: 12) {
                IconTile(tasksStateSymbol(card.overall), hue: tone.hue, size: NeonSize.iconTile)
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        DirText(card.title, font: .neonRowTitle, fill: false, lineLimit: 2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        StateBadge(cardStateLabel(card.overall), tone: tone, symbol: StateBadge.symbol(for: card.overall),
                                   pulsing: card.overall == "IN_PROGRESS")
                    }
                    FlowRow(spacing: NeonSpace.md) {
                        MetaLabel(item.conversation.title, symbol: item.conversation.isGroup ? "person.3.fill" : "bubble.left.fill")
                        if let due = formattedISODate(card.dueAt) {
                            MetaLabel(card.isOverdue ? L("Was due %@", due) : L("Due %@", due),
                                      symbol: card.isOverdue ? "exclamationmark.triangle.fill" : "clock",
                                      tint: card.isOverdue ? .neonDangerStrong : .neonTextTertiary)
                        }
                        if card.priority == "HIGH" {
                            MetaLabel(L("High"), symbol: "flame.fill", tint: .neonPinkStrong)
                        }
                    }
                    if !card.assignments.isEmpty {
                        FlowRow(spacing: 6) {
                            ForEach(card.assignments) { part in
                                let name = part.employee?.name ?? "—"
                                HStack(spacing: 6) {
                                    TasksAvatar(name: name, hue: hues.hue(part.employeeId, name: name, color: part.employee?.color), size: 20,
                                                photo: facePhotoURL(part.employee?.photoUrl))
                                    Text(verbatim: name)
                                        .font(.system(.caption, weight: .semibold))
                                        .foregroundStyle(Color.neonInk.opacity(0.8))
                                        .lineLimit(1)
                                    Circle()
                                        .fill(taskStateTone(part.state).color)
                                        .frame(width: 7, height: 7)
                                }
                                .padding(.leading, 3)
                                .padding(.trailing, 9)
                                .padding(.vertical, 3)
                                .background(Capsule().fill(taskStateTone(part.state).background))
                                .accessibilityElement(children: .combine)
                                .accessibilityValue(Text(cardStateLabel(part.state)))
                            }
                        }
                    }
                }
                Image(systemName: "chevron.forward")
                    .font(.system(.caption, weight: .semibold))
                    .foregroundStyle(Color.neonTextFaint)
                    .padding(.top, 4)
            }
            .padding(14)
            .rowCard(highlighted: card.overall == "SUBMITTED")
        }
    }
}
