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
            case .team: return L("What each person was given, and has done")
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
    @State private var openingTeamChat = false

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
            // A task moved — or somebody's face changed, which every chip,
            // job row and person card here draws.
            guard let name = note.object as? String, name.hasPrefix("tasks/") || isFaceChange(name) else { return }
            Task {
                await boardStore.load(api)
                await weekStore.load(api)
                // Read once the Team segment has been opened; until then it
                // loads itself when it first appears.
                if peopleStore.loaded { await peopleStore.load(api) }
                // The chat's cards draw the people on them too.
                if isFaceChange(name), chatCards.loaded { await chatCards.load(api) }
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
                    case .chat: ManagerTasksView(cards: chatCards, team: weekStore.value?.team ?? boardStore.value?.team ?? []) { openingTeamChat = true }
                    case .team: TaskPeopleView(store: peopleStore)
                    }
                }
                .id(segment)
                .transition(.opacity)
            }
            .refreshable { await reload() }
            // With no bar on the tab's own page, nothing stopped the cards
            // printing straight through the clock and the battery as they
            // scrolled: this fades them out under the status bar instead.
            .overlay(alignment: .top) {
                if !isPushed { TasksTopScrim() }
            }
            .modifier(TasksSoftTopEdge())
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
        .navigationDestination(isPresented: $openingTeamChat) { ChatRoomView(route: tasksTeamChatRoute) }
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
                    IconButtonLabel("flowchart")
                }
                .buttonStyle(PressableStyle(scale: 0.88))
                .accessibilityLabel(L("Delivery process"))

                TasksAccountMenu()
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

/// The team's group chat, where a task card is handed out from.
var tasksTeamChatRoute: ChatRoute { ChatRoute(slug: "team", title: L("Team chat"), subtitle: nil, avatar: "/admin-icon-192.png", isGroup: true) }

/// The page's own colour, solid under the status bar and fading out just
/// below it, so content scrolled up under the clock is hidden rather than
/// printed through it. It sits at the top of the safe area and reaches up
/// under the status bar from there, whatever frame it is given. Nothing
/// here takes a touch.
struct TasksTopScrim: View {
    var body: some View {
        VStack(spacing: 0) {
            Color.clear
                .frame(height: 0)
                .background(Color.neonBgSoft.opacity(0.96).ignoresSafeArea(edges: .top))
            LinearGradient(colors: [Color.neonBgSoft.opacity(0.96), Color.neonBgSoft.opacity(0)], startPoint: .top, endPoint: .bottom)
                .frame(height: NeonSpace.md)
            Spacer(minLength: 0)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// iOS 26's own soft edge at the top of the scroll, where the system has one.
struct TasksSoftTopEdge: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.scrollEdgeEffectStyle(.soft, for: .top)
        } else {
            content
        }
    }
}
