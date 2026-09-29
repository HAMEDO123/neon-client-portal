import SwiftUI

/// Every conversation the signed-in person is in — the team, their private
/// chat with the manager, one per colleague (or, for the manager, one per
/// employee), and the groups they are in — with the last message, the unread
/// count, their own pin / mute / favourite, streaks and who is online, from
/// the same `conversationsFor` the web reads. Above them, the studio's stories.
struct ChatListView: View {
    /// Told the total unread whenever the list is read, for the tab's badge.
    var onUnreadChange: (Int) -> Void = { _ in }

    @EnvironmentObject var api: APIClient
    @State private var filter: ChatListFilter = .all
    @State private var conversations: [ConversationSummary]?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var tasks: [ChatTaskListItem]?
    @State private var tasksCachedAt: Date?
    @State private var tasksError: String?
    @State private var stories: ChatStoriesResponse?
    @State private var storiesLoading = true
    @State private var path: [ChatRoute] = []
    @State private var searching = false
    @State private var query = ""
    @State private var showNewChat = false
    @State private var showComposer = false
    @State private var showMeetings = false
    @State private var confirmSignOut = false
    @State private var player: StoryLaunch?
    @FocusState private var searchFocused: Bool

    /// Which rings the story viewer runs through, and where it starts.
    private struct StoryLaunch: Identifiable {
        let id = UUID()
        let rings: [ChatStoryRing]
        let start: Int
    }

    init(onUnreadChange: @escaping (Int) -> Void = { _ in }) {
        self.onUnreadChange = onUnreadChange
        ChatPresenceHeartbeat.ensureStarted()
    }

    private var isManager: Bool { api.identity?.side == .admin }
    /// How stories and reads name this person: "admin" or their employee id.
    private var myKey: String { isManager ? "admin" : (api.identity?.id ?? "") }
    private var isOffline: Bool { cachedAt != nil }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if !searching {
                    ChatStoriesRail(
                        stories: stories,
                        isLoading: storiesLoading,
                        myName: api.identity?.name ?? "",
                        isManager: isManager,
                        isOnline: isOnline,
                        onOpen: openStories,
                        onCompose: { showComposer = true }
                    )
                    .neonListRow(top: 0, bottom: 6, horizontal: 0)
                    .transition(.neonDrop)
                }

                ChatFilterBar(selection: $filter, unreadCount: unreadConversations)
                    .neonListRow(top: 4, bottom: 8)

                if filter == .tasks, let tasksCachedAt {
                    OfflineBanner(savedAt: tasksCachedAt).neonListRow()
                } else if filter != .tasks, let cachedAt {
                    OfflineBanner(savedAt: cachedAt).neonListRow()
                }

                if filter == .tasks {
                    tasksRows
                } else {
                    conversationRows
                }

                // Room under the last card for the floating button.
                Color.clear.frame(height: 76).neonListRow()
            }
            .neonListStyle()
            .animation(NeonMotion.smooth, value: filter)
            .animation(NeonMotion.smooth, value: searching)
            .refreshable {
                Haptic.tap()
                async let stories: Void = loadStories()
                switch filter {
                case .tasks: await loadTasks()
                default: await load()
                }
                await stories
            }
            .safeAreaInset(edge: .top, spacing: 0) { header }
            .toolbar(.hidden, for: .navigationBar)
            .floatingActionButton("square.and.pencil", label: L("New chat"), isVisible: !searching) {
                Haptic.impact(.medium)
                showNewChat = true
            }
            .navigationDestination(for: ChatRoute.self) { route in
                ChatRoomView(route: route)
            }
            .navigationDestination(isPresented: $showMeetings) { MeetingsView() }
        }
        .task(id: path.isEmpty) {
            // Re-read whenever the list is what is on screen, so the counts a
            // conversation just cleared are gone when coming back to it.
            guard path.isEmpty else { return }
            await loadStories()
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 15 * 1_000_000_000)
            }
        }
        .task(id: "\(filter)\(path.isEmpty)") {
            guard path.isEmpty, filter == .tasks else { return }
            await loadTasks()
        }
        .onReceive(PushCenter.shared.$pendingPath) { webPath in
            Task { await openFromNotification(webPath) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .neonDataChanged)) { note in
            guard let name = note.object as? String, name.hasPrefix("chat/groups/") else { return }
            Task { await load() }
        }
        .sheet(isPresented: $showNewChat) {
            ChatNewConversationSheet(isManager: isManager) { route in
                path = [route]
                Task { await load() }
            }
        }
        .sheet(isPresented: $showComposer) {
            ChatStoryComposer { Task { await loadStories() } }
        }
        .fullScreenCover(item: $player) { launch in
            ChatStoryPlayer(rings: launch.rings, startRing: launch.start, myKey: myKey) {
                Task { await loadStories() }
            }
            .neonLanguage()
        }
        .confirmationDialog(L("Sign out of NEON?"), isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button(L("Sign Out"), role: .destructive) { api.logout() }
            Button(L("Cancel"), role: .cancel) {}
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                ChatStudioMark(size: 50)
                Text(L("Chat"))
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.neonInk)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Spacer(minLength: 8)
                Button {
                    Haptic.tap()
                    withNeonAnimation(NeonMotion.snappy) {
                        searching.toggle()
                        if !searching { query = "" }
                    }
                    searchFocused = searching
                } label: {
                    ChatHeaderButtonLabel(symbol: searching ? "xmark" : "magnifyingglass", isActive: searching)
                }
                .buttonStyle(PressableStyle(scale: 0.9))
                .accessibilityLabel(searching ? L("Close search") : L("Search"))

                Button {
                    Haptic.tap()
                    showNewChat = true
                } label: {
                    ChatHeaderButtonLabel(symbol: "person.badge.plus")
                }
                .buttonStyle(PressableStyle(scale: 0.9))
                .accessibilityLabel(isManager ? L("New group or chat") : L("New chat"))

                moreMenu
            }

            if searching {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.neonPurple)
                    TextField("", text: $query, prompt: Text(L("Search chats")).foregroundColor(Color.neonTextTertiary))
                        .font(.system(size: 16))
                        .focused($searchFocused)
                        .submitLabel(.search)
                        .autocorrectionDisabled()
                    if !query.isEmpty {
                        Button { query = "" } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(Color.neonTextFaint)
                        }
                        .accessibilityLabel(L("Clear"))
                    }
                }
                .padding(.horizontal, 16)
                .frame(height: 46)
                .background(Capsule().fill(Color.white.opacity(0.95)))
                .overlay(Capsule().strokeBorder(searchFocused ? AnyShapeStyle(ChatTint.accent) : AnyShapeStyle(Color.white), lineWidth: searchFocused ? 1.5 : 1))
                .neonShadow(.low)
                .transition(.neonDrop)
            }
        }
        .padding(.horizontal, NeonSpace.gutter)
        .padding(.top, 6)
        .padding(.bottom, 8)
        .background(
            LinearGradient(colors: [Color.neonBg, Color.neonBg.opacity(0.92), Color.neonBg.opacity(0)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea(edges: .top)
        )
    }

    private var moreMenu: some View {
        Menu {
            if let identity = api.identity {
                Section(identity.side == .admin ? L("Manager") : identity.name) {}
            }
            Button {
                showComposer = true
            } label: {
                Label(L("Add to your story"), systemImage: "plus.circle")
            }
            Button {
                showMeetings = true
            } label: {
                Label(L("Meetings"), systemImage: "calendar")
            }
            Button {
                Haptic.tap()
                AppLanguage.toggle()
            } label: {
                Label(AppLanguage.current == .arabic ? "English" : "العربية", systemImage: "globe")
            }
            Button(role: .destructive) {
                confirmSignOut = true
            } label: {
                Label(L("Sign Out"), systemImage: "rectangle.portrait.and.arrow.right")
            }
        } label: {
            ChatHeaderButtonLabel(symbol: "ellipsis")
        }
        .accessibilityLabel(L("More"))
    }

    // MARK: - Rows

    private var unreadConversations: Int {
        (conversations ?? []).filter { $0.unread > 0 }.count
    }

    private var shownConversations: [ConversationSummary] {
        let all = conversations ?? []
        let filtered: [ConversationSummary]
        switch filter {
        case .all, .tasks: filtered = all
        case .unread: filtered = all.filter { $0.unread > 0 }
        case .groups: filtered = all.filter(\.isGroup)
        case .favorites: filtered = all.filter(\.favorite)
        }
        guard !query.isEmpty else { return filtered }
        return filtered.filter { matchesSearch(query, $0.title, $0.last?.preview(isGroup: $0.isGroup), $0.subtitle) }
    }

    @ViewBuilder
    private var conversationRows: some View {
        if let conversations {
            let shown = shownConversations
            if shown.isEmpty {
                emptyState(hasAny: !conversations.isEmpty)
                    .neonListRow()
            } else {
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, conversation in
                    Button {
                        Haptic.tap()
                        path.append(ChatRoute(conversation))
                    } label: {
                        ChatConversationCard(conversation: conversation)
                    }
                    .buttonStyle(.pressableCard)
                    .staggered(index)
                    .neonListRow(top: 5, bottom: 5)
                    .swipeActions(edge: .leading, allowsFullSwipe: true) {
                        Button {
                            Haptic.tap()
                            Task { await setPrefs(conversation, pinned: !conversation.pinned) }
                        } label: {
                            Label(conversation.pinned ? L("Unpin") : L("Pin"), systemImage: conversation.pinned ? "pin.slash.fill" : "pin.fill")
                        }
                        .tint(Color(hex: 0x6366F1))
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button {
                            Haptic.tap()
                            Task { await setPrefs(conversation, favorite: !conversation.favorite) }
                        } label: {
                            Label(conversation.favorite ? L("Unfavorite") : L("Favorite"), systemImage: conversation.favorite ? "star.slash.fill" : "star.fill")
                        }
                        .tint(.neonOrange)
                        Button {
                            Haptic.tap()
                            Task { await setPrefs(conversation, muted: !conversation.muted) }
                        } label: {
                            Label(conversation.muted ? L("Unmute") : L("Mute"), systemImage: conversation.muted ? "bell.fill" : "bell.slash.fill")
                        }
                        .tint(.neonPink)
                    }
                    .contextMenu { prefsMenu(conversation) }
                }
            }
        } else if let errorMessage {
            ErrorState(message: errorMessage) { await load() }
                .neonListRow()
        } else {
            ForEach(0..<6, id: \.self) { index in
                ChatCardSkeleton(index: index).neonListRow()
            }
        }
    }

    @ViewBuilder
    private func prefsMenu(_ conversation: ConversationSummary) -> some View {
        Button {
            Task { await setPrefs(conversation, pinned: !conversation.pinned) }
        } label: {
            Label(conversation.pinned ? L("Unpin") : L("Pin"), systemImage: conversation.pinned ? "pin.slash" : "pin")
        }
        Button {
            Task { await setPrefs(conversation, muted: !conversation.muted) }
        } label: {
            Label(conversation.muted ? L("Unmute") : L("Mute"), systemImage: conversation.muted ? "bell" : "bell.slash")
        }
        Button {
            Task { await setPrefs(conversation, favorite: !conversation.favorite) }
        } label: {
            Label(conversation.favorite ? L("Remove from Favorites") : L("Add to Favorites"), systemImage: conversation.favorite ? "star.slash" : "star")
        }
    }

    @ViewBuilder
    private func emptyState(hasAny: Bool) -> some View {
        if !query.isEmpty {
            EmptyState(symbol: "magnifyingglass", title: L("No matches"), detail: L("Nothing in your chats matches “%@”.", query))
        } else {
            switch filter {
            case .unread:
                EmptyState(symbol: "checkmark.bubble", title: L("You're all caught up"), detail: L("Nothing unread."))
            case .groups:
                if isManager {
                    EmptyState(symbol: "person.3", title: L("No groups yet"), detail: L("Make one for a project or a team."),
                               actionTitle: L("New group"), action: { showNewChat = true })
                } else {
                    EmptyState(symbol: "person.3", title: L("No groups yet"), detail: L("Groups the manager adds you to appear here."))
                }
            case .favorites:
                EmptyState(symbol: "star", title: L("No favorites yet"), detail: L("Swipe a chat, or hold it, to add it to Favorites."))
            default:
                EmptyState(symbol: "bubble.left.and.bubble.right", title: L("No conversations yet"),
                           actionTitle: L("Start a chat"), action: { showNewChat = true })
            }
        }
    }

    @ViewBuilder
    private var tasksRows: some View {
        if let tasks {
            let shown = query.isEmpty ? tasks : tasks.filter { matchesSearch(query, $0.title, $0.conversationTitle) }
            if shown.isEmpty {
                EmptyState(symbol: query.isEmpty ? "checklist" : "magnifyingglass", title: query.isEmpty ? L("No tasks yet") : L("No matches"))
                    .neonListRow()
            } else {
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, item in
                    Button {
                        Haptic.tap()
                        path.append(ChatRoute(slug: item.conversationSlug, title: item.conversationTitle, subtitle: nil, avatar: nil, isGroup: item.isGroup))
                    } label: {
                        ChatTaskListRow(item: item)
                    }
                    .buttonStyle(.pressableCard)
                    .staggered(index)
                    .neonListRow()
                }
            }
        } else if let tasksError {
            ErrorState(message: tasksError) { await loadTasks() }
                .neonListRow()
        } else {
            ForEach(0..<4, id: \.self) { index in
                ChatCardSkeleton(index: index).neonListRow()
            }
        }
    }

    // MARK: - Stories

    /// Whether a story's author is here now, read from their conversation's
    /// green dot: the manager is "manager" from an employee's side, and an
    /// employee is their own id from anybody's.
    private func isOnline(_ authorKey: String) -> Bool {
        let slug = authorKey == "admin" ? "manager" : authorKey
        return conversations?.first { $0.slug == slug }?.online == true
    }

    private func openStories(_ ring: ChatStoryRing) {
        if ring.authorKey == myKey {
            player = StoryLaunch(rings: [ring], start: 0)
            return
        }
        let others = stories?.others ?? []
        let start = others.firstIndex { $0.authorKey == ring.authorKey } ?? 0
        player = StoryLaunch(rings: others, start: start)
    }

    // MARK: - Loading

    /// A tapped notification pointing at a conversation ("/admin/chat/<slug>",
    /// "/employee/chat/<slug>?task=…"): open it once the list knows it.
    private func openFromNotification(_ webPath: String?) async {
        guard let webPath, let range = webPath.range(of: "/chat/") else { return }
        let slug = String(webPath[range.upperBound...].prefix { $0 != "?" && $0 != "/" })
        guard !slug.isEmpty else { return }
        if conversations == nil { await load() }
        guard let summary = conversations?.first(where: { $0.slug == slug }) else { return }
        PushCenter.shared.pendingPath = nil
        path = [ChatRoute(summary)]
    }

    private func load() async {
        do {
            let loaded = try await api.fetchConversations()
            withNeonAnimation(NeonMotion.smooth) {
                conversations = loaded.value.conversations
            }
            cachedAt = loaded.cachedAt
            errorMessage = nil
            if loaded.cachedAt == nil {
                onUnreadChange(loaded.value.conversations.reduce(0) { $0 + $1.unread })
            }
        } catch {
            if conversations == nil { errorMessage = error.localizedDescription }
        }
    }

    private func loadTasks() async {
        do {
            let loaded = try await api.fetchChatTasks()
            tasks = loaded.value
            tasksCachedAt = loaded.cachedAt
            tasksError = nil
        } catch {
            if tasks == nil { tasksError = error.localizedDescription }
        }
    }

    /// Stories are extra: if they cannot be read, the rail keeps only
    /// "My Story" and the conversations are unaffected.
    private func loadStories() async {
        defer { storiesLoading = false }
        guard let loaded = try? await api.fetchChatStories() else { return }
        withNeonAnimation(NeonMotion.smooth) { stories = loaded.value }
    }

    // MARK: - Pin, mute, favourite

    /// Shown at once, then made so on the server; put back if it refuses.
    private func setPrefs(_ conversation: ConversationSummary, pinned: Bool? = nil, muted: Bool? = nil, favorite: Bool? = nil) async {
        guard !isOffline else {
            Toast.warning(L("You're offline. Try again when connected."))
            return
        }
        let before = conversations
        apply(slug: conversation.slug) { item in
            if let pinned { item.pinned = pinned }
            if let muted { item.muted = muted }
            if let favorite { item.favorite = favorite }
        }
        do {
            if let saved = try await api.setChatPrefs(slug: conversation.slug, pinned: pinned, muted: muted, favorite: favorite) {
                apply(slug: conversation.slug) { item in
                    item.pinned = saved.pinned
                    item.muted = saved.muted
                    item.favorite = saved.favorite
                }
            }
            Haptic.success()
            if let muted { Toast.info(muted ? L("Muted") : L("Unmuted"), detail: conversation.title) }
        } catch {
            Haptic.error()
            withNeonAnimation(NeonMotion.smooth) { conversations = before }
            Toast.error(error)
        }
    }

    /// Changes one conversation and puts the list back in the server's order:
    /// pinned first, then the rest, each by the last message.
    private func apply(slug: String, _ change: (inout ConversationSummary) -> Void) {
        guard var list = conversations, let index = list.firstIndex(where: { $0.slug == slug }) else { return }
        change(&list[index])
        let order = Dictionary(uniqueKeysWithValues: list.enumerated().map { ($1.slug, $0) })
        list.sort { a, b in
            if a.pinned != b.pinned { return a.pinned }
            let at = a.last?.createdAt ?? ""
            let bt = b.last?.createdAt ?? ""
            if at != bt { return at > bt }
            return (order[a.slug] ?? 0) < (order[b.slug] ?? 0)
        }
        withNeonAnimation(NeonMotion.smooth) { conversations = list }
    }
}

private struct ChatTaskListRow: View {
    let item: ChatTaskListItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                DirText(item.title, font: .system(size: 16, weight: .semibold))
                Spacer()
                BadgeView(text: cardStateLabel(item.overall), tone: taskStateTone(item.overall))
            }
            HStack(spacing: 6) {
                Image(systemName: item.isGroup ? "person.3" : "bubble.left")
                Text(item.conversationTitle)
                if let due = formattedISODate(item.dueAt) {
                    Text("·")
                    Text(L("Due %@", due))
                }
            }
            .font(.system(size: 12))
            .foregroundStyle(Color.neonInk.opacity(0.5))

            FlowRow {
                ForEach(item.assignments) { part in
                    HStack(spacing: 4) {
                        Circle().fill(taskStateTone(part.state).foreground).frame(width: 7, height: 7)
                        Text(part.employee?.name ?? "—")
                    }
                    .font(.system(size: 12, weight: .medium))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.neonInk.opacity(0.05), in: Capsule())
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(radius: 16)
    }
}

struct ChatRoute: Hashable {
    let slug: String
    let title: String
    let subtitle: String?
    let avatar: String?
    let isGroup: Bool
}
