import SwiftUI

// MARK: - The manager's Tasks tab

/// The one `NavigationStack` for the whole area: Board (the project × step
/// matrix, as cards on a phone), Week (jobs handed out by hand), Chat (task
/// cards from conversations — `ManagerTasksView`, kept as this segment) and
/// Team (each person's share of the work they were given, done).
///
/// One scrolling page: the header and the segment switch first, as on the
/// other tabs, then the chosen segment's cards. Home also pushes this view
/// (an alert's "/admin/tasks"); pushed, it rides on Home's stack and keeps
/// the system bar and its back button instead of opening a second stack.
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
            case .board: return "square.grid.3x3.fill"
            case .week: return "calendar"
            case .chat: return "bubble.left.and.bubble.right.fill"
            case .team: return "person.3.fill"
            }
        }
        /// The grey line under the page's title.
        var subtitle: String {
            switch self {
            case .board: return L("Every project, step by step")
            case .week: return L("Jobs handed out by hand")
            case .chat: return L("Task cards handed out in chat")
            case .team: return L("What each person has done")
            }
        }
    }

    @EnvironmentObject var api: APIClient
    @Environment(\.isPresented) private var isPushed
    @StateObject private var boardStore = TaskBoardStore()
    @StateObject private var weekStore = TaskWeekStore()
    @StateObject private var peopleStore = TaskPeopleStore()
    @StateObject private var chatCards = ChatCardsLoader()
    @State private var segment: Segment
    @State private var jobSheet: WeekBoardView.JobSheetTarget?

    init(initialSegment: Segment = .board) {
        _segment = State(initialValue: initialSegment)
    }

    var body: some View {
        Group {
            if isPushed {
                page
            } else {
                NavigationStack { page }
            }
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

    private var page: some View {
        ScrollViewReader { proxy in
            NeonScroll(spacing: NeonSpace.stack) {
                header
                    .padding(.bottom, NeonSpace.xs)

                Group {
                    switch segment {
                    case .board: TaskBoardView(store: boardStore)
                    case .week: WeekBoardView(store: weekStore, editing: $jobSheet, proxy: proxy)
                    case .chat: ManagerTasksView(cards: chatCards)
                    case .team: TaskPeopleView(store: peopleStore)
                    }
                }
                .id(segment)
                .transition(.opacity)
            }
            .refreshable { await reload() }
            .floatingActionButton(label: L("New job"), isVisible: segment == .week && weekStore.value != nil) {
                jobSheet = .new(day: weekStore.value?.todayKey ?? NeonFormat.dayKey(Date()))
            }
            #if DEBUG
            .debugScroll(proxy)
            #endif
        }
        .toolbar(isPushed ? .visible : .hidden, for: .navigationBar)
        .navigationTitle(L("Tasks"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: ChatRoute.self) { ChatRoomView(route: $0) }
        .navigationDestination(for: TaskPeopleRoute.self) { route in
            TaskPeopleDetailView(personId: route.id, store: peopleStore, board: boardStore)
        }
        .sheet(item: $jobSheet) { target in
            JobEditorSheet(target: target, team: weekStore.value?.team ?? [])
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: NeonSpace.md) {
            // Pushed, the system bar already says "Tasks"; the buttons stay.
            ScreenHeader(isPushed ? nil : L("Tasks"), subtitle: isPushed ? nil : segment.subtitle, leading: { EmptyView() }) {
                NavigationLink { ReviewsRootView() } label: {
                    IconButtonLabel("checkmark.seal", badge: boardStore.value?.awaitingReview)
                }
                .buttonStyle(PressableStyle(scale: 0.88))
                .accessibilityLabel(L("Reviews"))

                NavigationLink { ProcessSettingsView() } label: {
                    IconButtonLabel("slider.horizontal.3")
                }
                .buttonStyle(PressableStyle(scale: 0.88))
                .accessibilityLabel(L("Delivery process"))

                AccountMenu()
            }
            .animation(NeonMotion.gentle, value: segment)

            SegmentedPill(selection: $segment, options: Segment.allCases, title: \.label, symbol: { $0.symbol })
        }
    }

    private func reload() async {
        Haptic.soft()
        switch segment {
        case .board: await boardStore.load(api)
        case .week: await weekStore.load(api)
        case .chat: await chatCards.load(api)
        case .team:
            await peopleStore.load(api)
            await boardStore.load(api)
        }
    }
}
