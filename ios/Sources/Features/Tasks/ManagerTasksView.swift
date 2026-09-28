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

struct ManagerTasksView: View {
    @EnvironmentObject var api: APIClient
    @StateObject private var cards = ChatCardsLoader()
    @State private var filter: CardFilter = .open
    @State private var web: WebPortalLink?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    // The board and the review queue are the website's own
                    // pages until the phone API has them (ios/SERVER-REQUEST.md).
                    HStack(spacing: 10) {
                        WebTile(title: L("Task board"), symbol: "square.grid.3x3") {
                            web = WebPortalLink(path: "/admin/tasks", title: L("Task board"))
                        }
                        WebTile(title: L("Reviews"), symbol: "checkmark.seal", badge: reviewCount) {
                            web = WebPortalLink(path: "/admin/reviews", title: L("Reviews"),
                                                hint: L("Approve the proof, or send it back with a reason."))
                        }
                    }

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
            .navigationTitle(L("Tasks"))
            .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountMenu() } }
            .navigationDestination(for: ChatRoute.self) { ChatRoomView(route: $0) }
            .neonAmbientBackground()
        }
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
