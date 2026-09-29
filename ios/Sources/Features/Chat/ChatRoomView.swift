import PhotosUI
import SwiftUI

/// One conversation, as a messaging app draws it. Its state — messages from
/// the live stream and the poll merged into one list, what this phone is still
/// sending, who is writing, how far everybody has read — is
/// ChatConversationStore's; this is the screen:
///
/// - its own header (ChatRoomHeader.swift) in place of the system bar, so
///   nothing floats over the messages: picture, name, and under it typing…,
///   online now, when they were last here, or who is in the group;
/// - my own messages carry WhatsApp's ticks (ChatReceipts.swift);
/// - photos are drawn without a bubble, four or more in a row as a grid
///   (ChatPhotos.swift, ChatMessageRow.swift);
/// - "typing…" is a bubble at the foot of the conversation and a line under
///   the name in the header (ChatTyping.swift);
/// - a new message scrolls into view only when I am already at the bottom —
///   otherwise the round button back down counts how many arrived — and my
///   own always does.
struct ChatRoomView: View {
    let route: ChatRoute

    @EnvironmentObject var api: APIClient
    @StateObject private var store: ChatConversationStore
    @StateObject private var recorder = ChatVoiceRecorder()
    @StateObject private var scroll = ChatScrollTracker()
    @Environment(\.scenePhase) private var scenePhase

    @State private var draft = ""
    @State private var sendError: String?
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showPhotos = false
    @State private var showCamera = false
    @State private var showFiles = false
    @State private var viewer: ImageViewerPayload?
    @State private var proofFor: ProofTarget?
    @State private var showTaskCompose = false
    @State private var showMeetingCompose = false
    @State private var showAssistant = false
    @State private var searching: Bool
    @State private var searchQuery = ""
    @State private var scrollTarget: String?
    /// The row a pinned message was found in, lit for a moment.
    @State private var highlighted: String?
    @State private var deleteTarget: ChatMessage?
    /// Messages from somebody else that arrived while I was scrolled up.
    @State private var unseen = 0
    @State private var arrivalsCounted = 0
    @State private var outgoingCounted = 0
    @State private var didFirstScroll = false
    /// The conversation is drawn once it has settled at its newest message,
    /// so opening it never shows a jump from the top.
    @State private var revealed = false
    /// Counts what I send, so my own bubble rises in as it is written — and
    /// only then: the server's copy replacing it later is a swap, not an arrival.
    @State private var sentCount = 0
    @FocusState private var composerFocused: Bool
    @Environment(\.dismiss) private var dismissRoom
    // A group the manager made: its info sheet, and the name and picture it
    // was just given there (the route keeps what the list said).
    @State private var showGroupInfo = false
    @State private var groupTitle: String?
    @State private var groupAvatar: String?
    private var isCustomGroup: Bool { route.slug.hasPrefix("g-") }
    private var headerTitle: String { groupTitle ?? route.title }
    private var headerAvatar: String? { groupAvatar ?? route.avatar }
    // The composer's project tag — chat-room.tsx's own <select>, on both
    // portals: what is sent next is filed under this project, shown on the
    // message beside its time (message.project). It is not cleared after a
    // send, the same as the website, so several messages in a row can be
    // tagged without reopening the menu each time.
    @State private var taggableProjects: [ChatMessage.ProjectTag] = []
    @State private var taggedProjectId: String?
    private var taggedProject: ChatMessage.ProjectTag? { taggableProjects.first { $0.id == taggedProjectId } }

    /// `startsSearching` opens with the search box already out (the debug router).
    init(route: ChatRoute, startsSearching: Bool = false) {
        self.route = route
        _store = StateObject(wrappedValue: ChatConversationStore(slug: route.slug, isGroup: route.isGroup))
        _searching = State(initialValue: startsSearching)
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            if let cachedAt = store.cachedAt {
                OfflineBanner(savedAt: cachedAt)
                    .padding(.horizontal, NeonSpace.gutter)
                    .padding(.bottom, 4)
            }
            ChatPinnedStrip(
                pinned: store.reactions.pinned,
                onOpen: { scrollTarget = $0 },
                onUnpin: { id in Task { try? await api.setChatPinned(messageId: id, pin: false) } }
            )

            conversation

            ChatRoomComposer(
                draft: $draft,
                focused: $composerFocused,
                recorder: recorder,
                isOffline: isOffline,
                sendError: sendError,
                onDismissError: { sendError = nil },
                taggedProject: taggedProject,
                taggableProjects: taggableProjects,
                onTag: { taggedProjectId = $0 },
                canHandOut: api.identity?.side == .admin && route.slug != "manager",
                onCamera: { showCamera = true },
                onPhotos: { showPhotos = true },
                onFiles: { showFiles = true },
                onTask: { showTaskCompose = true },
                onMeeting: { showMeetingCompose = true },
                onSend: sendText,
                onQuickReply: sendQuick,
                onVoice: sendVoice
            )
        }
        .animation(NeonMotion.resolved(NeonMotion.smooth), value: store.reactions.pinned.isEmpty)
        .animation(NeonMotion.resolved(NeonMotion.smooth), value: store.cachedAt == nil)
        .background { ChatRoomWallpaper().ignoresSafeArea() }
        .background(ChatRoomSwipeBack().frame(width: 0, height: 0))
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .sheet(isPresented: $showGroupInfo) {
            ChatGroupInfoSheet(slug: route.slug) { name, avatar in
                groupTitle = name
                groupAvatar = avatar
            } onDeleted: {
                dismissRoom()
            }
        }
        .task { await store.run(api: api) }
        .task { taggableProjects = (try? await api.fetchChatProjects()) ?? [] }
        .onChange(of: scenePhase) { phase in
            store.isActive = phase == .active
            if phase == .active { Task { await store.load() } }
        }
        .onChange(of: draft) { value in store.draftChanged(value) }
        .fullScreenCover(item: $viewer) { ImageViewerView(payload: $0).neonLanguage() }
        .sheet(item: $proofFor) { target in
            ProofSheet(targetId: target.id, title: target.title, subtitle: target.detail) {
                Task { await store.load() }
            }
        }
        .sheet(isPresented: $showTaskCompose) {
            ChatTaskComposeSheet(conversationSlug: route.slug) { Task { await store.load() } }
        }
        .sheet(isPresented: $showMeetingCompose) {
            ChatMeetingComposeSheet(conversationSlug: route.slug) { Task { await store.load() } }
        }
        .sheet(isPresented: $showAssistant) { ChatAssistantSheet() }
        .confirmationDialog(L("Delete this message?"), isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } }), titleVisibility: .visible) {
            Button(L("Delete"), role: .destructive) {
                if let target = deleteTarget { Task { await store.delete(target) } }
                deleteTarget = nil
            }
            Button(L("Cancel"), role: .cancel) { deleteTarget = nil }
        }
        .photosPicker(isPresented: $showPhotos, selection: $photoItems, maxSelectionCount: 10, matching: .images)
        .onChange(of: photoItems) { items in
            guard !items.isEmpty else { return }
            photoItems = []
            Task { await sendPhotos(items) }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                guard let file = UploadMaker.photo(image) else { return }
                send(file: file)
            }
            .ignoresSafeArea()
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: UploadMaker.documentTypes) { result in
            guard case .success(let url) = result else { return }
            guard let file = UploadMaker.file(url, field: "document") else {
                sendError = L("That file could not be read.")
                return
            }
            send(file: file)
        }
        .alert(L("Microphone access is off"), isPresented: $recorder.permissionDenied) {
            Button(L("OK"), role: .cancel) {}
        } message: {
            Text(L("Turn it on in Settings to send a voice message."))
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(spacing: 8) {
            // Re-read every half minute, so "Last seen 4 min ago" keeps up.
            TimelineView(.periodic(from: .now, by: 30)) { context in
                ChatRoomHeader(
                    title: headerTitle,
                    avatarURL: resolvedMediaURL(headerAvatar),
                    studioMark: route.isGroup && headerAvatar == nil,
                    online: otherIsHere,
                    status: status(now: context.date),
                    onOpenInfo: isCustomGroup ? { showGroupInfo = true } : nil,
                    onBack: { dismissRoom() }
                ) {
                    headerButtons
                }
            }

            if searching {
                HStack(spacing: 10) {
                    SearchField(text: $searchQuery, prompt: L("Search this chat"))
                    if let count = matchCount {
                        Text(count == 1 ? L("1 match") : L("%d matches", count))
                            .font(.system(.caption, weight: .semibold))
                            .foregroundStyle(count == 0 ? Color.neonTextTertiary : Color.neonAccent)
                            .fixedSize()
                            .transition(.neonPop)
                    }
                }
                .padding(.horizontal, NeonSpace.gutter)
                .transition(.neonRise)
            }
        }
        .padding(.bottom, 6)
        .animation(NeonMotion.resolved(NeonMotion.snappy), value: searching)
        .animation(NeonMotion.resolved(NeonMotion.snappy), value: matchCount)
    }

    @ViewBuilder
    private var headerButtons: some View {
        if route.slug == "team", api.identity?.side == .admin {
            IconButton("sparkles", label: L("Ask the assistant"), tint: .neonPurpleStrong, size: 38) {
                showAssistant = true
            }
        }
        IconButton(searching ? "xmark" : "magnifyingglass", label: searching ? L("Close search") : L("Search"), size: 38) {
            withNeonAnimation {
                searching.toggle()
                if !searching { searchQuery = "" }
            }
        }
        CallButtons(slug: route.slug, title: route.title)
            .padding(.horizontal, 2)
            .frame(minHeight: 38)
            .background(Capsule().fill(Color.white.opacity(0.96)))
            .overlay(Capsule().strokeBorder(Color.white, lineWidth: 1))
            .neonShadow(.low)
    }

    /// The line under the name: who is writing, then — in a private chat —
    /// whether they are here or when they last were; in a group, who is in it.
    private func status(now: Date) -> ChatRoomStatus? {
        if let typing = chatTypingLine(store.typing, isGroup: route.isGroup) { return .typing(typing) }
        if route.isGroup {
            // Who is here right now first, then everybody else, then me.
            let members = store.people.members.enumerated().sorted { a, b in
                let hereA = a.element.online == true, hereB = b.element.online == true
                return hereA != hereB ? hereA : a.offset < b.offset
            }
            let names = members.map { chatMemberName(key: $0.element.key, name: $0.element.name) }
            if !names.isEmpty {
                return .line((names + [L("You")]).joined(separator: AppLanguage.current == .arabic ? "، " : ", "))
            }
            if isCustomGroup { return .hint(L("Group info")) }
        } else {
            if otherIsHere { return .online }
            if let seen = chatLastSeen(store.people.members.first?.seenAt, now: now) { return .line(seen) }
        }
        if let subtitle = route.subtitle, !subtitle.isEmpty { return .line(subtitle) }
        return nil
    }

    /// In a private chat, whether the other person has the app or the website
    /// open right now — the same 75-second window lib/presence.ts uses.
    private var otherIsHere: Bool {
        guard !route.isGroup, let other = store.people.members.first else { return false }
        if let online = other.online { return online }
        guard let seen = parseISODate(other.seenAt) else { return false }
        return Date().timeIntervalSince(seen) < ChatReceiptBoard.onlineWindow
    }

    private var matchCount: Int? {
        guard searching, !searchQuery.trimmingCharacters(in: .whitespaces).isEmpty, let messages = store.messages else { return nil }
        return displayed(messages).count
    }

    // MARK: The conversation

    private var conversation: some View {
        ScrollViewReader { proxy in
            ZStack(alignment: .bottom) {
                ScrollView {
                    VStack(spacing: 0) {
                        Color.clear.frame(height: 1).id("top")
                        LazyVStack(spacing: 2) {
                            if let messages = store.messages {
                                let shown = displayed(messages)
                                if shown.isEmpty && store.pending.isEmpty {
                                    emptyState
                                }
                                ForEach(rows(shown)) { row in
                                    rowView(row, proxy: proxy)
                                        .background {
                                            if highlighted == row.id {
                                                RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
                                                    .fill(NeonHue.indigo.pastel.opacity(0.75))
                                                    .padding(.horizontal, -8)
                                                    .padding(.vertical, -3)
                                                    .transition(.opacity)
                                            }
                                        }
                                        .id(row.id)
                                }
                                if !searching, !store.typing.isEmpty {
                                    ChatTypingBubble(typers: store.typing, isGroup: route.isGroup)
                                        .padding(.top, 6)
                                        .padding(.trailing, 44)
                                        .transition(.neonRise)
                                }
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 12)
                        Color.clear.frame(height: 14).id("bottom")
                    }
                    .animation(NeonMotion.resolved(NeonMotion.quick), value: store.typing.isEmpty)
                    .animation(NeonMotion.resolved(NeonMotion.snappy), value: store.arrivedFromOthers)
                    .animation(NeonMotion.resolved(NeonMotion.snappy), value: sentCount)
                    .background(
                        GeometryReader { geo in
                            Color.clear.preference(key: ChatScrollBottomKey.self, value: geo.frame(in: .named("chatScroll")).maxY)
                        }
                    )
                    .debugScroll(proxy)
                }
                .coordinateSpace(name: "chatScroll")
                .background(
                    GeometryReader { geo in
                        Color.clear.preference(key: ChatViewportKey.self, value: geo.size.height)
                    }
                )
                .onPreferenceChange(ChatViewportKey.self) { scroll.setViewport($0) }
                .onPreferenceChange(ChatScrollBottomKey.self) { scroll.setContentBottom($0) }
                .scrollDismissesKeyboard(.interactively)
                // Messages melt away at the edges instead of being cut off.
                .mask {
                    VStack(spacing: 0) {
                        LinearGradient(colors: [.black.opacity(0), .black], startPoint: .top, endPoint: .bottom).frame(height: 14)
                        Color.black
                        LinearGradient(colors: [.black, .black.opacity(0)], startPoint: .top, endPoint: .bottom).frame(height: 8)
                    }
                }
                .opacity(revealed ? 1 : 0)

                if !revealed {
                    if store.messages == nil, let errorMessage = store.errorMessage {
                        ScrollView {
                            ErrorState(message: errorMessage) { await store.load() }
                                .padding(.top, 40)
                        }
                        .transition(.opacity)
                    } else {
                        ChatRoomSkeleton()
                            .transition(.opacity)
                    }
                }

                if revealed, !scroll.nearBottom, store.messages != nil {
                    ChatRoomJumpButton(unseen: unseen) { pinToBottom(proxy, animated: true) }
                        .padding(.trailing, NeonSpace.gutter)
                        .padding(.bottom, 10)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .transition(.neonPop)
                }
            }
            .animation(NeonMotion.resolved(NeonMotion.snappy), value: scroll.nearBottom)
            .animation(NeonMotion.resolved(NeonMotion.gentle), value: revealed)
            .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
            .onChange(of: store.messages != nil) { loaded in
                guard loaded else { return }
                // A moment for the first jump to the newest to land.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { revealed = true }
            }
            .onChange(of: store.messages?.last?.id) { _ in
                guard !searching else { return }
                if !didFirstScroll {
                    didFirstScroll = true
                    pinToBottom(proxy, animated: false)
                    return
                }
                // Somebody else's comes into view only when I was already
                // reading the newest; otherwise the button counts it. (What I
                // send scrolls into view the moment I send it, below.)
                if scroll.nearBottom { pinToBottom(proxy, animated: true) }
            }
            .onChange(of: store.arrivedFromOthers) { count in
                let arrived = count - arrivalsCounted
                arrivalsCounted = count
                if arrived > 0, !scroll.nearBottom { unseen += arrived }
            }
            .onChange(of: store.outgoing.count) { count in
                // Something of mine was just written: always into view. A send
                // finishing (the count going down) leaves the reader where they are.
                if count > outgoingCounted, !searching { pinToBottom(proxy, animated: true) }
                outgoingCounted = count
            }
            .onChange(of: store.typing.isEmpty) { empty in
                if !empty, scroll.nearBottom, !searching { pinToBottom(proxy, animated: true) }
            }
            .onChange(of: scroll.nearBottom) { near in
                if near { unseen = 0 }
            }
            .onChange(of: composerFocused) { focused in
                guard focused, scroll.nearBottom else { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    withNeonAnimation(NeonMotion.smooth) { proxy.scrollTo("bottom", anchor: .bottom) }
                }
            }
            .onChange(of: scrollTarget) { target in
                guard let target else { return }
                let rowId = rows(displayed(store.messages ?? [])).first { $0.messageIds.contains(target) }?.id ?? target
                withNeonAnimation(NeonMotion.smooth) { proxy.scrollTo(rowId, anchor: .center) }
                scrollTarget = nil
                flash(rowId)
            }
        }
    }

    private var emptyState: some View {
        EmptyState(
            symbol: searching ? "magnifyingglass" : "bubble.left.and.bubble.right.fill",
            title: searching ? L("No matches") : L("No messages yet"),
            detail: searching ? nil : L("Say hello."),
            hue: searching ? .grey : .indigo,
            card: true
        )
        .padding(.top, 40)
        .padding(.horizontal, 20)
        .transition(.neonRise)
    }

    /// Lights the row a pinned message was found in, then lets it fade.
    private func flash(_ rowId: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            withNeonAnimation(NeonMotion.gentle) { highlighted = rowId }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.3) {
                withNeonAnimation(NeonMotion.gentle) { if highlighted == rowId { highlighted = nil } }
            }
        }
    }

    /// Scrolls to the newest, and once more a moment later: a lazy list
    /// guesses the height of rows it has not drawn yet, so the first jump can
    /// land a little short.
    private func pinToBottom(_ proxy: ScrollViewProxy, animated: Bool) {
        let go = {
            if animated {
                withNeonAnimation(NeonMotion.smooth) { proxy.scrollTo("bottom", anchor: .bottom) }
            } else {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
        DispatchQueue.main.async(execute: go)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { proxy.scrollTo("bottom", anchor: .bottom) }
        unseen = 0
    }

    private func rows(_ shown: [ChatMessage]) -> [ChatRowItem] {
        let pinned = Set(store.reactions.pinned.map(\.id))
        let reacted = Set(store.reactions.reactions.map(\.messageId))
        return chatRows(
            messages: shown,
            pending: searching ? [] : store.pending,
            searching: searching,
            isGroup: route.isGroup,
            identity: api.identity
        ) { message in
            message.isPicture && message.attachmentURL != nil && (message.body ?? "").isEmpty && message.project == nil
                && message.managerOnly != true && !pinned.contains(message.id) && !reacted.contains(message.id)
        }
    }

    @ViewBuilder
    private func rowView(_ row: ChatRowItem, proxy: ScrollViewProxy) -> some View {
        switch row {
        case .day(_, let iso):
            ChatDaySeparator(iso: iso)
        case .message(let message, let showAuthor, let firstInRun):
            let mine = message.isMine(api.identity)
            ChatMessageRow(
                message: message,
                mine: mine,
                showAuthor: showAuthor,
                tail: firstInRun,
                delivery: mine ? delivery(of: message) : nil,
                viewerIdentity: api.identity,
                tallies: chatTally(store.reactions.reactions, messageId: message.id, myKey: store.myKey),
                isPinned: store.reactions.pinned.contains { $0.id == message.id },
                callSlug: route.slug,
                inGroup: route.isGroup,
                openImage: { openPhoto(message) },
                sendProof: { assignment, card in
                    proofFor = ProofTarget(id: assignment.id, title: card.title, detail: card.description)
                },
                onReact: { emoji in react(message, emoji) },
                onPin: { pin in Task { try? await api.setChatPinned(messageId: message.id, pin: pin) } },
                onDelete: canDelete(message) ? { deleteTarget = message } : nil,
                onCardChanged: { Task { await store.load() } },
                onMediaResize: { keepBottom(proxy) }
            )
            .transition(.neonRise)
        case .album(let photos, let showAuthor):
            let mine = photos.first?.isMine(api.identity) == true
            ChatAlbumRow(
                photos: photos,
                mine: mine,
                showAuthor: showAuthor,
                inGroup: route.isGroup,
                delivery: mine ? photos.last.map { delivery(of: $0) } : nil,
                open: { openPhoto($0) },
                onReact: { message, emoji in react(message, emoji) },
                onPin: { message in Task { try? await api.setChatPinned(messageId: message.id, pin: true) } },
                canDelete: { canDelete($0) },
                onDelete: { deleteTarget = $0 }
            )
            .transition(.neonRise)
        case .outgoing(let item, let firstInRun):
            ChatMessageRow(
                message: item.message,
                mine: true,
                showAuthor: false,
                tail: firstInRun,
                delivery: item.delivery,
                viewerIdentity: api.identity,
                tallies: [],
                isPinned: false,
                callSlug: route.slug,
                inGroup: route.isGroup,
                outgoing: item,
                openImage: {},
                sendProof: { _, _ in },
                onReact: { _ in },
                onPin: { _ in },
                onDelete: nil,
                onCardChanged: {},
                onRetry: {
                    Haptic.tap()
                    store.retry(item.id)
                },
                onDiscard: { withNeonAnimation(NeonMotion.quick) { store.discard(item.id) } },
                onMediaResize: { keepBottom(proxy) }
            )
            .transition(.neonRise)
        }
    }

    /// A photo is about to change height as it arrives: stay at the bottom if
    /// that is where the reader was.
    private func keepBottom(_ proxy: ScrollViewProxy) {
        guard scroll.nearBottom, !searching else { return }
        DispatchQueue.main.async { proxy.scrollTo("bottom", anchor: .bottom) }
    }

    /// The ticks on one of my messages. The manager's exchanges with the
    /// assistant are theirs alone, so nobody else is there to reach.
    private func delivery(of message: ChatMessage) -> ChatDelivery {
        if message.managerOnly == true { return .sent }
        return store.receipts.delivery(of: parseISODate(message.createdAt))
    }

    private func react(_ message: ChatMessage, _ emoji: String) {
        Task { try? await api.toggleChatReaction(messageId: message.id, emoji: emoji) }
    }

    /// The full-screen viewer, able to swipe through every photo in the
    /// conversation, opened on this one.
    private func openPhoto(_ message: ChatMessage) {
        let photos = (store.messages ?? []).filter { $0.isPicture && $0.attachmentURL != nil }
        guard !photos.isEmpty else { return }
        Haptic.tap()
        viewer = ImageViewerPayload(
            items: photos.map { ImageViewerItem(id: $0.id, url: $0.attachmentURL, caption: $0.body) },
            startIndex: photos.firstIndex { $0.id == message.id } ?? 0
        )
    }

    // MARK: Rules

    private var isOffline: Bool { store.cachedAt != nil }

    private func canDelete(_ message: ChatMessage) -> Bool {
        guard let identity = api.identity else { return false }
        if identity.side == .admin { return true }
        return message.authorType == "EMPLOYEE" && message.authorId == identity.id
    }

    private func displayed(_ list: [ChatMessage]) -> [ChatMessage] {
        guard searching, !searchQuery.trimmingCharacters(in: .whitespaces).isEmpty else { return list }
        return list.filter { matchesSearch(searchQuery, $0.body, $0.authorName) }
    }

    // MARK: Sending

    private func sendText() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        sendError = nil
        draft = ""
        sentCount += 1
        store.sendText(text, project: taggedProject)
        Haptic.tap()
    }

    private func sendQuick(_ text: String) {
        Haptic.tap()
        sentCount += 1
        store.sendText(text, project: nil)
    }

    /// A photo or a file, with what is in the box as its caption.
    private func send(file: UploadFile) {
        let caption = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        sendError = nil
        draft = ""
        sentCount += 1
        store.sendFile(file, caption: caption, project: taggedProject)
    }

    /// Several photos at once go up one after another, in the order they were
    /// picked; a caption in the box goes with the last of them.
    private func sendPhotos(_ items: [PhotosPickerItem]) async {
        var files: [UploadFile] = []
        for item in items {
            if let file = await UploadMaker.photo(item) { files.append(file) }
        }
        guard !files.isEmpty else {
            sendError = L("That photo could not be read.")
            return
        }
        if files.count < items.count { sendError = L("That photo could not be read.") }
        let caption = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = ""
        sentCount += 1
        for (index, file) in files.enumerated() {
            store.sendFile(file, caption: index == files.count - 1 ? caption : "", project: taggedProject)
        }
    }

    private func sendVoice(url: URL, seconds: Int) {
        defer { try? FileManager.default.removeItem(at: url) }
        guard let data = try? Data(contentsOf: url) else {
            sendError = L("That recording could not be read.")
            Haptic.error()
            return
        }
        let file = UploadFile(field: "voice", filename: "voice.m4a", mimeType: "audio/mp4", data: data)
        sentCount += 1
        store.sendVoice(file, seconds: seconds, project: taggedProject)
        Haptic.success()
    }
}

// MARK: - Where the reader is

/// Whether the conversation is scrolled to (or near) its newest message —
/// which decides whether a new one scrolls into view or waits behind the
/// button. Published only when it flips, so scrolling does not redraw the
/// screen on every frame.
@MainActor
final class ChatScrollTracker: ObservableObject {
    @Published private(set) var nearBottom = true
    private var viewport: CGFloat = 0
    private var contentBottom: CGFloat = 0

    /// How far above the bottom still counts as reading the newest.
    private let slack: CGFloat = 140

    func setViewport(_ height: CGFloat) {
        viewport = height
        update()
    }

    func setContentBottom(_ maxY: CGFloat) {
        contentBottom = maxY
        update()
    }

    private func update() {
        guard viewport > 0 else { return }
        let near = contentBottom - viewport < slack
        if near != nearBottom { nearBottom = near }
    }
}

private struct ChatScrollBottomKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private struct ChatViewportKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
