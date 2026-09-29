import PhotosUI
import SwiftUI

/// One conversation, as a messaging app draws it. Its state — messages from
/// the live stream and the poll merged into one list, what this phone is still
/// sending, who is writing, how far everybody has read — is
/// ChatConversationStore's; this is the screen:
///
/// - my own messages carry WhatsApp's ticks (ChatReceipts.swift);
/// - photos are drawn without a bubble, four or more in a row as a grid
///   (ChatPhotos.swift, ChatMessageRow.swift);
/// - "typing…" is a bubble at the foot of the conversation and a line under
///   the name in the header (ChatTyping.swift);
/// - a new message scrolls into view only when I am already at the bottom —
///   otherwise a pill says how many arrived — and my own always does.
struct ChatRoomView: View {
    let route: ChatRoute

    @EnvironmentObject var api: APIClient
    @StateObject private var store: ChatConversationStore
    @StateObject private var recorder = ChatVoiceRecorder()
    @StateObject private var scroll = ChatScrollTracker()
    @ObservedObject private var voicePlayer = ChatVoicePlayer.shared
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
    @State private var searching = false
    @State private var searchQuery = ""
    @State private var scrollTarget: String?
    @State private var deleteTarget: ChatMessage?
    /// Messages from somebody else that arrived while I was scrolled up.
    @State private var unseen = 0
    @State private var arrivalsCounted = 0
    @State private var outgoingCounted = 0
    @State private var didFirstScroll = false
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

    init(route: ChatRoute) {
        self.route = route
        _store = StateObject(wrappedValue: ChatConversationStore(slug: route.slug, isGroup: route.isGroup))
    }

    var body: some View {
        VStack(spacing: 0) {
            if let cachedAt = store.cachedAt { OfflineBanner(savedAt: cachedAt).padding(.horizontal, 12).padding(.top, 6) }
            if searching {
                SearchField(text: $searchQuery, prompt: L("Search this chat")).padding(.horizontal, 12).padding(.top, 8)
            }
            ChatPinnedStrip(
                pinned: store.reactions.pinned,
                onOpen: { scrollTarget = $0 },
                onUnpin: { id in Task { try? await api.setChatPinned(messageId: id, pin: false) } }
            )

            conversation

            composer
        }
        .background(Color.neonBg.ignoresSafeArea())
        .toolbar(.hidden, for: .tabBar)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if route.slug == "team", api.identity?.side == .admin {
                    Button { showAssistant = true } label: { Image(systemName: "sparkles") }
                        .accessibilityLabel(L("Ask the assistant"))
                }
                Button { withAnimation { searching.toggle() }; if !searching { searchQuery = "" } } label: {
                    Image(systemName: searching ? "xmark.circle" : "magnifyingglass")
                }
                .accessibilityLabel(L("Search"))
                CallButtons(slug: route.slug, title: route.title)
            }
            ToolbarItem(placement: .principal) {
                if isCustomGroup {
                    Button {
                        Haptic.tap()
                        showGroupInfo = true
                    } label: {
                        roomTitle(hint: L("Group info"))
                    }
                    .buttonStyle(PressableStyle(scale: 0.96))
                    .accessibilityHint(L("Group info"))
                } else {
                    roomTitle(hint: nil)
                }
            }
        }
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

    // MARK: The conversation

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    LazyVStack(spacing: 5) {
                        if let messages = store.messages {
                            let shown = displayed(messages)
                            if shown.isEmpty && store.pending.isEmpty {
                                EmptyState(
                                    symbol: searching ? "magnifyingglass" : "bubble.left",
                                    title: searching ? L("No matches") : L("No messages yet"),
                                    detail: searching ? nil : L("Say hello.")
                                )
                            }
                            ForEach(rows(shown)) { row in
                                rowView(row, proxy: proxy)
                                    .id(row.id)
                            }
                            if !searching, !store.typing.isEmpty {
                                ChatTypingBubble(typers: store.typing, isGroup: route.isGroup)
                                    .padding(.top, 4)
                                    .padding(.trailing, 44)
                                    .transition(.neonRise)
                            }
                        } else if let errorMessage = store.errorMessage {
                            ErrorState(message: errorMessage) { await store.load() }
                        } else {
                            ProgressView().padding(.top, 60)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 10)
                    Color.clear.frame(height: 10).id("bottom")
                }
                .animation(NeonMotion.resolved(NeonMotion.quick), value: store.typing.isEmpty)
                .background(
                    GeometryReader { geo in
                        Color.clear.preference(key: ChatScrollBottomKey.self, value: geo.frame(in: .named("chatScroll")).maxY)
                    }
                )
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
            .overlay(alignment: .bottom) { jumpControl(proxy) }
            .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
            .onChange(of: store.messages?.last?.id) { _ in
                guard !searching else { return }
                if !didFirstScroll {
                    didFirstScroll = true
                    pinToBottom(proxy, animated: false)
                    return
                }
                // Somebody else's comes into view only when I was already
                // reading the newest; otherwise the pill counts it. (What I
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
                    withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                }
            }
            .onChange(of: scrollTarget) { target in
                guard let target else { return }
                let rowId = rows(displayed(store.messages ?? [])).first { $0.messageIds.contains(target) }?.id ?? target
                withAnimation { proxy.scrollTo(rowId, anchor: .center) }
                scrollTarget = nil
            }
        }
    }

    /// Scrolls to the newest, and once more a moment later: a lazy list
    /// guesses the height of rows it has not drawn yet, so the first jump can
    /// land a little short.
    private func pinToBottom(_ proxy: ScrollViewProxy, animated: Bool) {
        let go = {
            if animated {
                withAnimation(NeonMotion.resolved(.easeOut(duration: 0.22))) { proxy.scrollTo("bottom", anchor: .bottom) }
            } else {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
        DispatchQueue.main.async(execute: go)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { proxy.scrollTo("bottom", anchor: .bottom) }
        unseen = 0
    }

    /// Scrolled up: a round button back to the newest — or, when something
    /// arrived meanwhile, a pill saying how much.
    @ViewBuilder
    private func jumpControl(_ proxy: ScrollViewProxy) -> some View {
        if !scroll.nearBottom, store.messages != nil {
            Group {
                if unseen > 0 {
                    Button {
                        Haptic.tap()
                        pinToBottom(proxy, animated: true)
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "arrow.down").font(.system(size: 12, weight: .bold))
                            Text(unseen == 1 ? L("1 new message") : L("%d new messages", unseen))
                                .font(.system(size: 13, weight: .semibold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Color.neonPurpleStrong, in: Capsule())
                        .neonShadow(.floating)
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    Button {
                        Haptic.tap()
                        pinToBottom(proxy, animated: true)
                    } label: {
                        Image(systemName: "chevron.down")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.neonInk.opacity(0.7))
                            .frame(width: 38, height: 38)
                            .background(Color.white, in: Circle())
                            .overlay(Circle().strokeBorder(Color.neonInk.opacity(0.08)))
                            .neonShadow(.low)
                    }
                    .accessibilityLabel(L("Newest messages"))
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.horizontal, 14)
                }
            }
            .buttonStyle(PressableStyle(scale: 0.94))
            .padding(.bottom, 10)
            .transition(.neonPop)
        }
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
        case .album(let photos, let showAuthor):
            let mine = photos.first?.isMine(api.identity) == true
            ChatAlbumRow(
                photos: photos,
                mine: mine,
                showAuthor: showAuthor,
                delivery: mine ? photos.last.map { delivery(of: $0) } : nil,
                open: { openPhoto($0) },
                onReact: { message, emoji in react(message, emoji) },
                onPin: { message in Task { try? await api.setChatPinned(messageId: message.id, pin: true) } },
                canDelete: { canDelete($0) },
                onDelete: { deleteTarget = $0 }
            )
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

    // MARK: Composer

    private var composer: some View {
        VStack(spacing: 6) {
            if let sendError {
                HStack {
                    Text(sendError).font(.footnote).foregroundStyle(.red)
                    Spacer()
                    Button { self.sendError = nil } label: { Image(systemName: "xmark.circle.fill") }
                        .foregroundStyle(Color.neonInk.opacity(0.3))
                }
                .padding(.horizontal, 14)
            }

            if let taggedProject, !recorder.isRecording {
                HStack(spacing: 6) {
                    Image(systemName: "folder.fill").font(.system(size: 11))
                    Text(taggedProject.name).font(.system(size: 12, weight: .medium)).lineLimit(1)
                    Button { taggedProjectId = nil } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 13)) }
                        .accessibilityLabel(L("No project"))
                }
                .foregroundStyle(Color.neonPurpleStrong)
                .padding(.horizontal, 14)
            }

            if recorder.isRecording {
                recordingRow
            } else {
                if draftIsEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(chatQuickReplies, id: \.text) { reply in
                                Button { sendQuick(reply.text) } label: {
                                    // The text carries its own emoji, as the website sends it.
                                    Text(verbatim: reply.text)
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(Color.neonInk)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .background(Color.white.opacity(0.8), in: Capsule())
                                        .overlay(Capsule().strokeBorder(Color.neonInk.opacity(0.08)))
                                }
                                .buttonStyle(.plain)
                                .disabled(isOffline)
                            }
                        }
                        .padding(.horizontal, 12)
                    }
                }

                HStack(alignment: .bottom, spacing: 8) {
                    Menu {
                        if CameraPicker.isAvailable {
                            Button { showCamera = true } label: { Label(L("Camera"), systemImage: "camera") }
                        }
                        Button { showPhotos = true } label: { Label(L("Photo"), systemImage: "photo") }
                        Button { showFiles = true } label: { Label(L("File"), systemImage: "doc") }
                        if !taggableProjects.isEmpty {
                            Menu {
                                if taggedProjectId != nil {
                                    Button { taggedProjectId = nil } label: { Label(L("No project"), systemImage: "xmark") }
                                    Divider()
                                }
                                ForEach(taggableProjects) { project in
                                    Button { taggedProjectId = project.id } label: {
                                        if project.id == taggedProjectId {
                                            Label(project.name, systemImage: "checkmark")
                                        } else {
                                            Text(project.name)
                                        }
                                    }
                                }
                            } label: {
                                Label(taggedProject?.name ?? L("Project this is about"), systemImage: "folder")
                            }
                        }
                        if api.identity?.side == .admin && route.slug != "manager" {
                            Divider()
                            Button { showTaskCompose = true } label: { Label(L("Task"), systemImage: "checklist") }
                            Button { showMeetingCompose = true } label: { Label(L("Meeting"), systemImage: "calendar.badge.plus") }
                        }
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(Color.neonInk.opacity(0.55))
                            .frame(height: 38)
                    }
                    .disabled(isOffline)

                    TextField(L("Message"), text: $draft, axis: .vertical)
                        .lineLimit(1...5)
                        .focused($composerFocused)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.neonInk.opacity(0.1)))
                        .environment(\.layoutDirection, naturalDirection(draft) ?? AppLanguage.current.layoutDirection)

                    Button {
                        if draftIsEmpty {
                            Haptic.tap()
                            recorder.start()
                        } else {
                            sendText()
                        }
                    } label: {
                        Image(systemName: draftIsEmpty ? "mic.fill" : "arrow.up")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 38, height: 38)
                            .background(Color.neonPurpleStrong, in: Circle())
                            .contentTransition(.opacity)
                    }
                    .accessibilityLabel(draftIsEmpty ? L("Voice message") : L("Send"))
                    .disabled(isOffline)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
            }
        }
        .background(.ultraThinMaterial)
    }

    private var draftIsEmpty: Bool { draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var isOffline: Bool { store.cachedAt != nil }

    private var recordingRow: some View {
        HStack(spacing: 12) {
            Circle().fill(Color.red).frame(width: 9, height: 9).neonPulse(true)
            Text(formatDuration(recorder.elapsed)).font(.system(size: 15, weight: .semibold).monospacedDigit())
            Spacer()
            Button {
                Haptic.tap()
                recorder.cancel()
            } label: { Image(systemName: "trash").foregroundStyle(.red) }
            Button {
                guard let taken = recorder.stopAndTake() else { Haptic.warning(); return }
                sendVoice(url: taken.url, seconds: taken.seconds)
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(Color.neonPurpleStrong, in: Circle())
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private func formatDuration(_ seconds: TimeInterval) -> String {
        let whole = max(0, Int(seconds))
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }

    private func canDelete(_ message: ChatMessage) -> Bool {
        guard let identity = api.identity else { return false }
        if identity.side == .admin { return true }
        return message.authorType == "EMPLOYEE" && message.authorId == identity.id
    }

    private func displayed(_ list: [ChatMessage]) -> [ChatMessage] {
        guard searching, !searchQuery.trimmingCharacters(in: .whitespaces).isEmpty else { return list }
        return list.filter { matchesSearch(searchQuery, $0.body, $0.authorName) }
    }

    // MARK: Header

    /// The header's middle: the conversation's picture and name, and under
    /// it who is typing, or that the other person is here — for a group, a
    /// way into its info.
    private func roomTitle(hint: String?) -> some View {
        HStack(spacing: 8) {
            if route.isGroup && headerAvatar == nil {
                ChatStudioMark(size: 30)
            } else {
                AvatarView(url: resolvedMediaURL(headerAvatar), name: headerTitle, size: 30, online: otherIsHere)
            }
            VStack(alignment: .leading, spacing: 0) {
                DirText(headerTitle, font: .system(size: 15, weight: .semibold), color: .neonInk, fill: false, lineLimit: 1)
                Group {
                    if let typing = chatTypingLine(store.typing, isGroup: route.isGroup) {
                        Text(verbatim: typing)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Color.neonSuccessStrong)
                    } else if let hint {
                        Text(hint).font(.system(size: 11)).foregroundStyle(Color.neonPurpleStrong)
                    } else if otherIsHere {
                        Text(L("online now")).font(.system(size: 11)).foregroundStyle(Color.neonSuccessStrong)
                    } else if let subtitle = route.subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.system(size: 11)).foregroundStyle(Color.neonInk.opacity(0.5))
                    }
                }
                .lineLimit(1)
                .transition(.opacity)
            }
            .animation(NeonMotion.resolved(NeonMotion.quick), value: store.typing)
        }
    }

    /// In a private chat, whether the other person has the app or the website
    /// open right now — the same 75-second window lib/presence.ts uses.
    private var otherIsHere: Bool {
        guard !route.isGroup, let other = store.people.members.first else { return false }
        if let online = other.online { return online }
        guard let seen = parseISODate(other.seenAt) else { return false }
        return Date().timeIntervalSince(seen) < ChatReceiptBoard.onlineWindow
    }

    // MARK: Sending

    private func sendText() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        sendError = nil
        draft = ""
        store.sendText(text, project: taggedProject)
        Haptic.tap()
    }

    private func sendQuick(_ text: String) {
        Haptic.tap()
        store.sendText(text, project: nil)
    }

    /// A photo or a file, with what is in the box as its caption.
    private func send(file: UploadFile) {
        let caption = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        sendError = nil
        draft = ""
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
        store.sendVoice(file, seconds: seconds, project: taggedProject)
        Haptic.success()
    }
}

// MARK: - Where the reader is

/// Whether the conversation is scrolled to (or near) its newest message —
/// which decides whether a new one scrolls into view or waits behind a pill.
/// Published only when it flips, so scrolling does not redraw the screen on
/// every frame.
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

// MARK: - Cards

/// A job handed out from the chat. Each person on it has their own part; the
/// person looking at their own part, while it is still theirs to do, gets the
/// one action that moves it on — sending proof. The manager approves or sends
/// it back right here, exactly where the web review queue's buttons lead —
/// "Done" stays the manager's word either way — and everybody on the card can
/// talk about it in the thread underneath.
struct ChatTaskCardView: View {
    let card: TaskCard
    let message: ChatMessage
    let viewer: Identity?
    let sendProof: (TaskCard.Assignment, TaskCard) -> Void
    let onChanged: () -> Void

    @EnvironmentObject private var api: APIClient
    @State private var commentDraft = ""
    @State private var busy = false
    @State private var reviewNote = ""
    @State private var reviewingSubmissionId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "checklist")
                Text(L("TASK"))
                    .tracking(0.5)
                if let priority = priorityLabel(card.priority) {
                    Spacer()
                    Text(priority)
                }
            }
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color.neonPurpleStrong)

            DirText(card.title, font: .system(size: 16, weight: .semibold))
            if let description = card.description, !description.isEmpty {
                DirText(description, font: .system(size: 14), color: .neonInk.opacity(0.75))
            }
            if let due = formattedISODate(card.dueAt) {
                Label(L("Due %@", due), systemImage: "clock")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.neonInk.opacity(0.55))
            }

            Divider()

            ForEach(card.assignments) { part in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(part.employee?.name ?? "—")
                            .font(.system(size: 13, weight: .medium))
                        Spacer()
                        BadgeView(text: cardStateLabel(part.state), tone: taskStateTone(part.state))
                    }
                    if let pending = part.submissions?.first, part.state == "SUBMITTED" {
                        HStack(spacing: 6) {
                            Image(systemName: "photo")
                            Text(viewer?.side == .admin ? L("Proof waiting for your review") : L("Proof sent — waiting for review"))
                        }
                        .font(.system(size: 11))
                        .foregroundStyle(Color.neonInk.opacity(0.5))
                        if let note = pending.note, !note.isEmpty {
                            DirText(note, font: .system(size: 12), color: .neonInk.opacity(0.6))
                        }
                        if viewer?.side == .admin {
                            if reviewingSubmissionId == pending.id {
                                VStack(alignment: .leading, spacing: 6) {
                                    TextField(L("Note (optional)"), text: $reviewNote, axis: .vertical)
                                        .textFieldStyle(.roundedBorder)
                                        .font(.system(size: 13))
                                    HStack(spacing: 8) {
                                        Button {
                                            respond(to: pending.id, approve: true)
                                        } label: {
                                            Label(L("Approve"), systemImage: "checkmark")
                                                .font(.system(size: 13, weight: .semibold))
                                                .frame(maxWidth: .infinity, minHeight: 32)
                                        }
                                        .buttonStyle(.pressable)
                                        .tint(.green)
                                        .disabled(busy)

                                        Button(role: .destructive) {
                                            respond(to: pending.id, approve: false)
                                        } label: {
                                            Label(L("Send back"), systemImage: "arrow.uturn.backward")
                                                .font(.system(size: 13, weight: .semibold))
                                                .frame(maxWidth: .infinity, minHeight: 32)
                                        }
                                        .buttonStyle(.pressable)
                                        .disabled(busy)
                                    }
                                }
                            } else {
                                Button {
                                    Haptic.tap()
                                    reviewNote = ""
                                    reviewingSubmissionId = pending.id
                                } label: {
                                    Label(L("Review"), systemImage: "checkmark.seal")
                                        .font(.system(size: 13, weight: .semibold))
                                        .frame(maxWidth: .infinity)
                                        .frame(height: 34)
                                        .foregroundStyle(.white)
                                        .background(Color.neonPurpleStrong, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                }
                                .buttonStyle(.pressable)
                            }
                        }
                    }
                    if isMine(part), part.state != "SUBMITTED", part.state != "DONE" {
                        Button {
                            Haptic.tap()
                            sendProof(part, card)
                        } label: {
                            Label(L("Send proof"), systemImage: "camera.fill")
                                .font(.system(size: 13, weight: .semibold))
                                .frame(maxWidth: .infinity)
                                .frame(height: 36)
                                .foregroundStyle(.white)
                                .background(Color.neonInk, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        .buttonStyle(.pressable)
                    }
                }
            }

            if viewer != nil {
                Divider()
                commentsSection
            }
        }
        .padding(14)
        .frame(width: 290, alignment: .leading)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.neonPurple.opacity(0.25)))
    }

    private var commentsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(card.comments) { comment in
                VStack(alignment: .leading, spacing: 1) {
                    Text(comment.authorName).font(.system(size: 11, weight: .semibold))
                    DirText(comment.body, font: .system(size: 12.5), color: .neonInk.opacity(0.8))
                }
            }
            HStack(spacing: 8) {
                TextField(L("Write a comment…"), text: $commentDraft)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 13))
                Button {
                    send()
                } label: {
                    Image(systemName: "paperplane.fill")
                }
                .disabled(commentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
            }
        }
    }

    private func isMine(_ part: TaskCard.Assignment) -> Bool {
        viewer?.side == .employee && viewer?.id == part.employeeId
    }

    private func send() {
        let body = commentDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        commentDraft = ""
        Haptic.tap()
        busy = true
        Task {
            defer { busy = false }
            try? await api.addChatTaskComment(taskId: card.id, body: body)
            onChanged()
        }
    }

    private func respond(to submissionId: String, approve: Bool) {
        Haptic.tap()
        busy = true
        let note = reviewNote
        Task {
            defer { busy = false }
            if approve {
                try? await api.approveChatSubmission(id: submissionId, note: note)
            } else {
                try? await api.rejectChatSubmission(id: submissionId, note: note)
            }
            reviewingSubmissionId = nil
            onChanged()
        }
    }
}

/// A meeting set from the chat: the manager's ONLINE or IN_PERSON card with
/// its attendees. Whoever was asked answers ACCEPTED or DECLINED right here;
/// the manager can call it off; Join opens ten minutes before the start,
/// through the same call buttons the conversation's header carries.
struct ChatMeetingCardView: View {
    let meeting: MeetingCard
    let callSlug: String
    let callTitle: String
    let viewer: Identity?
    let onChanged: () -> Void

    @EnvironmentObject private var api: APIClient
    @State private var busy = false
    @State private var confirmCancel = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(L("MEETING"), systemImage: "calendar")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.neonCyanStrong)
                Spacer()
                if viewer?.side == .admin {
                    Button(role: .destructive) {
                        confirmCancel = true
                    } label: {
                        Image(systemName: "xmark.circle").font(.system(size: 14))
                    }
                    .disabled(busy)
                }
            }
            DirText(meeting.title, font: .system(size: 16, weight: .semibold))
            if let agenda = meeting.agenda, !agenda.isEmpty {
                DirText(agenda, font: .system(size: 13), color: .neonInk.opacity(0.7))
            }
            if let starts = formattedISODate(meeting.startsAt) {
                Label(
                    meeting.durationMinutes.map { L("%@ · %d min", starts, $0) } ?? starts,
                    systemImage: "clock"
                )
                .font(.system(size: 12))
                .foregroundStyle(Color.neonInk.opacity(0.6))
            }
            Label(
                meeting.mode == "IN_PERSON" ? (meeting.place?.isEmpty == false ? meeting.place! : L("In person")) : L("Online"),
                systemImage: meeting.mode == "IN_PERSON" ? "mappin.and.ellipse" : "video"
            )
            .font(.system(size: 12))
            .foregroundStyle(Color.neonInk.opacity(0.6))

            if meeting.mode != "IN_PERSON", isUpcoming {
                CallButtons(slug: callSlug, title: callTitle)
            }

            if !meeting.attendees.isEmpty {
                Divider()
                ForEach(meeting.attendees) { person in
                    HStack {
                        Text(person.name).font(.system(size: 13))
                        Spacer()
                        Text(rsvpLabel(person.rsvp))
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(person.rsvp == "ACCEPTED" ? Color.green : (person.rsvp == "DECLINED" ? Color.red.opacity(0.7) : Color.neonInk.opacity(0.5)))
                    }
                }
            }

            if let mine = myAttendee {
                HStack(spacing: 8) {
                    Button {
                        rsvp("ACCEPTED")
                    } label: {
                        Label(L("Coming"), systemImage: "checkmark")
                            .font(.system(size: 13, weight: .semibold))
                            .frame(maxWidth: .infinity, minHeight: 32)
                    }
                    .buttonStyle(.pressable)
                    .tint(mine.rsvp == "ACCEPTED" ? .green : .gray)
                    .disabled(busy)

                    Button {
                        rsvp("DECLINED")
                    } label: {
                        Label(L("Not coming"), systemImage: "xmark")
                            .font(.system(size: 13, weight: .semibold))
                            .frame(maxWidth: .infinity, minHeight: 32)
                    }
                    .buttonStyle(.pressable)
                    .disabled(busy)
                }
            }
        }
        .padding(14)
        .frame(width: 290, alignment: .leading)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.neonCyan.opacity(0.3)))
        .confirmationDialog(L("Cancel this meeting?"), isPresented: $confirmCancel, titleVisibility: .visible) {
            Button(L("Cancel meeting"), role: .destructive) { cancel() }
            Button(L("Keep it"), role: .cancel) {}
        }
    }

    private var myKey: String? {
        guard let viewer else { return nil }
        return viewer.side == .admin ? "admin" : viewer.id
    }

    private var myAttendee: MeetingCard.Attendee? {
        guard let myKey else { return nil }
        return meeting.attendees.first { $0.memberKey == myKey }
    }

    /// Ten minutes before the start and while it is plausibly still running —
    /// the same window the card's own Join button opens in on the web.
    private var isUpcoming: Bool {
        guard let starts = parseISODate(meeting.startsAt) else { return true }
        let duration = TimeInterval((meeting.durationMinutes ?? 60) * 60)
        return Date() > starts.addingTimeInterval(-600) && Date() < starts.addingTimeInterval(duration + 1800)
    }

    private func rsvp(_ answer: String) {
        Haptic.tap()
        busy = true
        Task {
            defer { busy = false }
            try? await api.setChatMeetingRsvp(meetingId: meeting.id, rsvp: answer)
            onChanged()
        }
    }

    private func cancel() {
        Haptic.tap()
        busy = true
        Task {
            defer { busy = false }
            try? await api.cancelChatMeeting(id: meeting.id)
            onChanged()
        }
    }
}
