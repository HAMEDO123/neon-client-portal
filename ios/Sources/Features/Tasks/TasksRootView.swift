import SwiftUI

// MARK: - The manager's Tasks tab

/// The one `NavigationStack` for the whole area: Board (the project × step
/// matrix, as cards on a phone), Week (jobs handed out by hand), Chat (task
/// cards from conversations — `ManagerTasksView`, kept as this segment) and
/// Team (each person's share of the work they were given, done).
struct TasksRootView: View {
    enum Segment: String, CaseIterable, Identifiable {
        case board, week, chat, team
        var id: String { rawValue }
        var label: String {
            switch self {
            case .board: return L("Board")
            case .week: return L("Week")
            case .chat: return L("Chat")
            case .team: return L("Team")
            }
        }
        var symbol: String {
            switch self {
            case .board: return "square.grid.3x3"
            case .week: return "calendar"
            case .chat: return "bubble.left.and.bubble.right"
            case .team: return "person.3"
            }
        }
    }

    @EnvironmentObject var api: APIClient
    @StateObject private var boardStore = TaskBoardStore()
    @StateObject private var weekStore = TaskWeekStore()
    @StateObject private var peopleStore = TaskPeopleStore()
    @State private var segment: Segment = .board

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                SegmentedPill(selection: $segment, options: Segment.allCases, title: \.label, symbol: { $0.symbol })
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 6)

                switch segment {
                case .board: TaskBoardView(store: boardStore)
                case .week: WeekBoardView(store: weekStore)
                case .chat: ManagerTasksView()
                case .team: TaskPeopleView(store: peopleStore)
                }
            }
            .navigationTitle(L("Tasks"))
            .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountMenu() } }
            .navigationDestination(for: ChatRoute.self) { ChatRoomView(route: $0) }
            .navigationDestination(for: TaskPeopleRoute.self) { route in
                TaskPeopleDetailView(personId: route.id, store: peopleStore, board: boardStore)
            }
            .neonAmbientBackground()
        }
        .task {
            await boardStore.load(api)
            await weekStore.load(api)
        }
        .onReceive(NotificationCenter.default.publisher(for: .neonDataChanged)) { note in
            guard let name = note.object as? String, name.hasPrefix("tasks/") else { return }
            Task {
                await boardStore.load(api)
                await weekStore.load(api)
                // Read once the Team segment has been opened; until then it
                // loads itself when it first appears.
                if peopleStore.loaded { await peopleStore.load(api) }
            }
        }
    }
}
