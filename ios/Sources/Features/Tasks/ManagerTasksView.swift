import SwiftUI

// MARK: - The manager's Tasks tab

enum CardFilter: String, CaseIterable, Identifiable {
    case open, review, done, all
    var id: String { rawValue }
    var label: String {
        switch self {
        case .open: return L("Open")
        case .review: return L("To review")
        case .done: return L("Done")
        case .all: return L("All")
        }
    }
}

/// The "Chat" segment of `TasksRootView`: task cards handed out from a
/// conversation. Embedded, so it owns no `NavigationStack` and no title of
/// its own — the tab root's `navigationDestination(for: ChatRoute.self)`
/// carries it to the conversation.
struct ManagerTasksView: View {
    @EnvironmentObject var api: APIClient
    @StateObject private var cards = ChatCardsLoader()
    @State private var filter: CardFilter = .open
    @State private var web: WebPortalLink?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                NavigationLink { ReviewsRootView() } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "checkmark.seal")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(Color.neonPurpleStrong)
                        Text(L("Reviews"))
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.neonInk)
                        Spacer(minLength: 0)
                        if reviewCount > 0 { CountBadge(reviewCount) }
                        Image(systemName: "chevron.forward")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color.neonInk.opacity(0.3))
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity)
                    .glassCard(radius: 16)
                }
                .buttonStyle(.pressable)

                WebTile(title: L("Hand out a task"), symbol: "plus.circle") {
                    web = WebPortalLink(path: "/admin/chat/team", title: L("Hand out a task"),
                                        hint: L("Press + in the chat and choose Task. For one person, open their chat instead."))
                }

                SectionLabel(L("Handed out in chat"))
                Picker(L("Show"), selection: $filter) {
                    ForEach(CardFilter.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)

                if let cachedAt = cards.cachedAt { OfflineBanner(savedAt: cachedAt) }

                if !cards.loaded, let error = cards.errorMessage {
                    ErrorState(message: error) { await cards.load(api) }
                } else if !cards.loaded {
                    SkeletonRows(count: 4)
                } else if shown.isEmpty {
                    EmptyState(symbol: "checklist", title: L("No tasks here"))
                        .glassCard(radius: 18)
                } else {
                    ForEach(shown) { item in
                        NavigationLink(value: ChatRoute(item.conversation)) {
                            ChatTaskRow(item: item, viewer: api.identity)
                        }
                        .buttonStyle(.pressable)
                    }
                }

                Text(L("Tasks from the last 200 messages of each chat."))
                    .font(.system(size: 11))
                    .foregroundStyle(Color.neonInk.opacity(0.4))
            }
            .padding(16)
        }
        .refreshable { await cards.load(api) }
        .task { await cards.load(api) }
        .fullScreenCover(item: $web) { WebPortalSheet(link: $0) }
    }

    private var reviewCount: Int {
        cards.tasks.reduce(0) { $0 + ($1.message.task?.assignments.filter { $0.state == "SUBMITTED" }.count ?? 0) }
    }

    private var shown: [ChatCardsLoader.Item] {
        cards.tasks.filter { item in
            guard let card = item.message.task else { return false }
            switch filter {
            case .open: return card.overall == "TODO" || card.overall == "IN_PROGRESS"
            case .review: return card.overall == "SUBMITTED"
            case .done: return card.overall == "DONE"
            case .all: return true
            }
        }
    }
}

/// One task card in a list: what it is, where it was handed out, when it is
/// due, and where each person on it stands.
