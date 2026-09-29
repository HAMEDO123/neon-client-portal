import SwiftUI

/// Every conversation the signed-in person is in — the team, their private
/// chat with the manager, one per colleague (or, for the manager, one per
/// employee), and the groups they are in — with the last message, the unread
/// count, their own pin / mute / favourite, streaks and who is online, from
/// the same `conversationsFor` the web reads. Above them, the studio's stories
/// and everybody else, as in the owner's mockup.
struct ChatListView: View {
    /// Told the total unread whenever the list is read, for the tab's badge.
    var onUnreadChange: (Int) -> Void = { _ in }

    @EnvironmentObject var api: APIClient
    @StateObject private var ticks = ChatListTicks()
    @State private var filter: ChatListFilter
    @State private var conversations: [ConversationSummary]?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var tasks: [ChatTaskListItem]?
    @State private var tasksCachedAt: Date?
    @State private var tasksError: String?
    @State private var stories: ChatStoriesResponse?
    @State private var storiesLoading = true
    @State private var path: [ChatRoute] = []
    @State private var searching: Bool
    @State private var query = ""
    @State private var showNewChat = false
    @State private var showComposer = false
    @State private var showMeetings = false
    @State private var confirmSignOut = false
    @State private var player: StoryLaunch?
    @State private var groupInfo: GroupTarget?
    @FocusState private var searchFocused: Bool

    /// Which rings the story viewer runs through, and where it starts.
    private struct StoryLaunch: Identifiable {
        let id = UUID()
        let rings: [ChatStoryRing]
        let start: Int
    }

    private struct GroupTarget: Identifiable {
        let id: String
    }

    /// `initialFilter` and `startsSearching` open the list on one of its
    /// views — the debug router's screenshots use them.
    init(onUnreadChange: @escaping (Int) -> Void = { _ in }, initialFilter: ChatListFilter = .all, startsSearching: Bool = false) {
        self.onUnreadChange = onUnreadChange
        _filter = State(initialValue: initialFilter)
        _searching = State(initialValue: startsSearching)
        ChatPresenceHeartbeat.ensureStarted()
    }

    private var isManager: Bool { api.identity?.side == .admin }
    /// How stories and reads name this person: "admin" or their employee id.
    private var myKey: String { isManager ? "admin" : (api.identity?.id ?? "") }
    private var isOffline: Bool { cachedAt != nil }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollViewReader { proxy in
                List {
                    header
                        .neonListRow(top: 6, bottom: 2)

                    if searching {
                        ChatListSearchField(text: $query, prompt: L("Search chats"), focus: $searchFocused)
                            .neonListRow(top: 6, bottom: 4)
                            .transition(.neonDrop)
                    } else {
                        rail
                            .neonListRow(top: 4, bottom: 4, horizontal: 0)
                            .transition(.neonDrop)
                            .id("stories")
                    }

                    ChatListFilterBar(selection: $filter, unreadCount: unreadConversations)
                        .neonListRow(top: 6, bottom: 6)
                    .id("filters")

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
                    Color.clear
                        .frame(height: 84)
                        .neonListRow(top: 0, bottom: 0)
                        .id("end")
                }
                .neonListStyle()
                .environment(\.defaultMinListRowHeight, 0)
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
                #if DEBUG
                .debugScroll(proxy)
                #endif
            }
            .toolbar(.hidden, for: .navigationBar)
            .floatingActionButton("square.and.pencil", label: isManager ? L("New group or chat") : L("New chat"), isVisible: !searching) {
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
            var round = 0
            while !Task.isCancelled {
                await load()
                if let conversations, cachedAt == nil { await ticks.refresh(conversations, api: api) }
                // Stories change far less often than messages: every fourth round.
                if round > 0, round.isMultiple(of: 4) { await loadStories() }
                round += 1
                try? await Task.sleep(nanoseconds: 15 * 1_000_000_000)
            }
        }
        .task(id: "\(filter)\(path.isEmpty)") {
            guard path.isEmpty, filter == .tasks else { return }
            await loadTasks()
        }
        .task {
            // Opened straight into search: the cursor goes in.
            if searching { searchFocused = true }
        }
        .onReceive(PushCenter.shared.$pendingPath) { webPath in
            Task { await openFromNotification(webPath) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .neonDataChanged)) { note in
            guard let name = note.object as? String, name.hasPrefix("chat/groups/") else { return }
            Task { await load() }
        }
        .sheet(isPresented: $showNewChat) {
            ChatNewConversationSheet(isManager: isManager, onlineIds: onlineIds) { route in
                path = [route]
                Task { await load() }
            }
        }
        .sheet(isPresented: $showComposer) {
            ChatStoryComposer { Task { await loadStories() } }
        }
        .sheet(item: $groupInfo) { target in
            ChatGroupInfoSheet(slug: target.id, onChanged: { _, _ in Task { await load() } }, onDeleted: { Task { await load() } })
        }
        .fullScreenCover(item: $player) { launch in
            ChatStoryPlayer(
                rings: launch.rings,
                startRing: launch.start,
                myKey: myKey,
                onMessage: { ring in openChat(withAuthor: ring.authorKey) },
                onClose: { Task { await loadStories() } }
            )
            .neonLanguage()
        }
        .confirmationDialog(L("Sign out of NEON?"), isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button(L("Sign Out"), role: .destructive) { api.logout() }
            Button(L("Cancel"), role: .cancel) {}
        }
    }

    // MARK: - Header

    private var header: some View {
        ScreenHeader(L("Chat"), leading: { ChatStudioMark(size: NeonSize.circleButton + 4) }) {
            IconButton(
                searching ? "xmark" : "magnifyingglass",
                label: searching ? L("Close search") : L("Search"),
                look: searching ? .filled : .glass,
                tint: searching ? .neonIndigo : .neonInk,
                size: NeonSize.circleButton
            ) {
                withNeonAnimation(NeonMotion.snappy) {
                    searching.toggle()
                    if !searching { query = "" }
                }
                searchFocused = searching
            }
            IconButton("person.badge.plus", label: isManager ? L("New group or chat") : L("New chat"), size: NeonSize.circleButton) {
                showNewChat = true
            }
            moreMenu
        }
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
                showNewChat = true
            } label: {
                Label(isManager ? L("New group or chat") : L("New chat"), systemImage: "square.and.pencil")
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
            IconButtonLabel("ellipsis", size: NeonSize.circleButton)
        }
        .accessibilityLabel(L("More"))
    }

    // MARK: - Stories and people

    private var rail: some View {
        ChatStoriesRail(
            stories: stories,
            isLoading: storiesLoading,
            myName: api.identity?.name ?? "",
            isManager: isManager,
            people: railPeople,
            isOnline: isOnline,
            onOpen: openStories,
            onCompose: { showComposer = true },
            onOpenChat: { conversation in
                path.append(ChatRoute(conversation))
            }
        )
    }

    /// Everybody whose person or group has no live story, in the list's own
    /// order — the rail's plain faces after the rings.
    private var railPeople: [ConversationSummary] {
        let authors = Set((stories?.others ?? []).map { slug(forAuthor: $0.authorKey) })
        return (conversations ?? []).filter { !authors.contains($0.slug) }
    }

    /// The conversation a story's author is at the other end of: the manager
    /// is "manager" from an employee's side, an employee is their own id from
    /// anybody's.
    private func slug(forAuthor authorKey: String) -> String {
        authorKey == "admin" ? "manager" : authorKey
    }

    /// Whether a story's author is here now, read from their conversation's green dot.
    private func isOnline(_ authorKey: String) -> Bool {
        conversations?.first { $0.slug == slug(forAuthor: authorKey) }?.online == true
    }

    /// Who is here right now, by conversation slug, for the new chat sheet's dots.
    private var onlineIds: Set<String> {
        Set((conversations ?? []).filter { $0.online == true }.map(\.slug))
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

    /// From a story: close the viewer and open the chat with its author.
    private func openChat(withAuthor authorKey: String) {
        player = nil
        guard let conversation = conversations?.first(where: { $0.slug == slug(forAuthor: authorKey) }) else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { path = [ChatRoute(conversation)] }
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
        return filtered.filter { matchesSearch(query, $0.title, ChatListPreview($0).full, $0.subtitle) }
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
                        ChatConversationCard(conversation: conversation, delivery: ticks.delivery[conversation.slug])
                    }
                    .buttonStyle(.pressableCard)
                    .staggered(index)
                    .neonListRow(top: 4, bottom: 4)
                    .swipeActions(edge: .leading, allowsFullSwipe: true) {
                        Button {
                            Haptic.tap()
                            Task { await setPrefs(conversation, pinned: !conversation.pinned) }
                        } label: {
                            Label(conversation.pinned ? L("Unpin") : L("Pin"), systemImage: conversation.pinned ? "pin.slash.fill" : "pin.fill")
                        }
                        .tint(.neonIndigo)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button {
                            Haptic.tap()
                            Task { await setPrefs(conversation, favorite: !conversation.favorite) }
                        } label: {
                            Label(conversation.favorite ? L("Unfavorite") : L("Favorite"), systemImage: conversation.favorite ? "star.slash.fill" : "star.fill")
                        }
                        .tint(.neonAmber)
                        Button {
                            Haptic.tap()
                            Task { await setPrefs(conversation, muted: !conversation.muted) }
                        } label: {
                            Label(conversation.muted ? L("Unmute") : L("Mute"), systemImage: conversation.muted ? "bell.fill" : "bell.slash.fill")
                        }
                        .tint(.neonPurple)
                    }
                    .contextMenu { prefsMenu(conversation) }
                }
            }
        } else if let errorMessage {
            ErrorState(message: errorMessage) { await load() }
                .neonListRow()
        } else {
            SkeletonRows(count: 6)
                .neonListRow()
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
        if conversation.isCustomGroup {
            Divider()
            Button {
                groupInfo = GroupTarget(id: conversation.slug)
            } label: {
                Label(L("Group info"), systemImage: "info.circle")
            }
        }
    }

    @ViewBuilder
    private func emptyState(hasAny: Bool) -> some View {
        if !query.isEmpty {
            EmptyState(symbol: "magnifyingglass", title: L("No matches"), detail: L("Nothing in your chats matches “%@”.", query), card: true)
        } else {
            switch filter {
            case .unread:
                EmptyState(symbol: "checkmark.bubble", title: L("You're all caught up"), detail: L("Nothing unread."), hue: .green, card: true)
            case .groups:
                if isManager {
                    EmptyState(symbol: "person.3", title: L("No groups yet"), detail: L("Make one for a project or a team."),
                               actionTitle: L("New group"), action: { showNewChat = true }, hue: .purple, card: true)
                } else {
                    EmptyState(symbol: "person.3", title: L("No groups yet"), detail: L("Groups the manager adds you to appear here."),
                               hue: .purple, card: true)
                }
            case .favorites:
                EmptyState(symbol: "star", title: L("No favorites yet"), detail: L("Swipe a chat, or hold it, to add it to Favorites."),
                           hue: .amber, card: true)
            default:
                EmptyState(symbol: "bubble.left.and.bubble.right", title: L("No conversations yet"),
                           actionTitle: L("Start a chat"), action: { showNewChat = true }, card: true)
            }
        }
    }

    @ViewBuilder
    private var tasksRows: some View {
        if let tasks {
            let shown = query.isEmpty ? tasks : tasks.filter { matchesSearch(query, $0.title, $0.conversationTitle) }
            if shown.isEmpty {
                EmptyState(
                    symbol: query.isEmpty ? "checklist" : "magnifyingglass",
                    title: query.isEmpty ? L("No tasks yet") : L("No matches"),
                    detail: query.isEmpty ? L("Tasks handed out in a chat appear here, with where each one stands.") : nil,
                    hue: .cyan,
                    card: true
                )
                .neonListRow()
            } else {
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, item in
                    Button {
                        Haptic.tap()
                        path.append(ChatRoute(slug: item.conversationSlug, title: item.conversationTitle, subtitle: nil, avatar: nil, isGroup: item.isGroup))
                    } label: {
                        ChatListTaskCard(item: item)
                    }
                    .buttonStyle(.pressableCard)
                    .staggered(index)
                    .neonListRow(top: 4, bottom: 4)
                }
            }
        } else if let tasksError {
            ErrorState(message: tasksError) { await loadTasks() }
                .neonListRow()
        } else {
            SkeletonRows(count: 4)
                .neonListRow()
        }
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
            withNeonAnimation(NeonMotion.smooth) { tasks = loaded.value }
            tasksCachedAt = loaded.cachedAt
            tasksError = nil
        } catch {
            if tasks == nil { tasksError = error.localizedDescription }
        }
    }

    /// Stories are extra: if they cannot be read, the rail keeps "My Story"
    /// and everybody's faces, and the conversations are unaffected.
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

struct ChatRoute: Hashable {
    let slug: String
    let title: String
    let subtitle: String?
    let avatar: String?
    let isGroup: Bool
}
