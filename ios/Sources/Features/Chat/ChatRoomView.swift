import PhotosUI
import SwiftUI

/// One conversation. Live updates come from the stream (ChatStream.listen) —
/// a new message the instant somebody sends one, who is typing, and who has
/// read how far — with a background poll of `/chat/messages` underneath as
/// the fallback and the source every task and meeting card's own state
/// refreshes from, since that read already re-draws each card fresh every
/// time.
struct ChatRoomView: View {
    let route: ChatRoute

    @EnvironmentObject var api: APIClient
    @StateObject private var recorder = ChatVoiceRecorder()
    @ObservedObject private var voicePlayer = ChatVoicePlayer.shared

    @State private var messages: [ChatMessage]?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var draft = ""
    @State private var sending = false
    @State private var sendError: String?
    @State private var photoItem: PhotosPickerItem?
    @State private var showPhotos = false
    @State private var showCamera = false
    @State private var showFiles = false
    @State private var viewer: ImageViewerPayload?
    @State private var proofFor: ProofTarget?
    @State private var showTaskCompose = false
    @State private var showMeetingCompose = false
    @State private var showAssistant = false
    @State private var reactions = ChatReactionSnapshot()
    @State private var people = ChatPeopleSnapshot()
    @State private var searching = false
    @State private var searchQuery = ""
    @State private var scrollTarget: String?
    @State private var lastTypingSentAt: Date?
    @State private var deleteTarget: ChatMessage?
    @FocusState private var composerFocused: Bool
    // The composer's project tag — chat-room.tsx's own <select>, on both
    // portals: what is sent next is filed under this project, shown on the
    // message beside its time (message.project). It is not cleared after a
    // send, the same as the website, so several messages in a row can be
    // tagged without reopening the menu each time.
    @State private var taggableProjects: [ChatMessage.ProjectTag] = []
    @State private var taggedProjectId: String?
    private var taggedProject: ChatMessage.ProjectTag? { taggableProjects.first { $0.id == taggedProjectId } }

    var body: some View {
        VStack(spacing: 0) {
            if let cachedAt { OfflineBanner(savedAt: cachedAt).padding(.horizontal, 12).padding(.top, 6) }
            if searching {
                SearchField(text: $searchQuery, prompt: L("Search this chat")).padding(.horizontal, 12).padding(.top, 8)
            }
            ChatPinnedStrip(
                pinned: reactions.pinned,
                onOpen: { scrollTarget = $0 },
                onUnpin: { id in Task { try? await api.setChatPinned(messageId: id, pin: false) } }
            )

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 6) {
                        if let messages {
                            let shown = displayed(messages)
                            if shown.isEmpty {
                                EmptyState(
                                    symbol: searching ? "magnifyingglass" : "bubble.left",
                                    title: searching ? L("No matches") : L("No messages yet"),
                                    detail: searching ? nil : L("Say hello.")
                                )
                            }
                            ForEach(Array(shown.enumerated()), id: \.element.id) { index, message in
                                if !searching, startsNewDay(at: index, in: shown) {
                                    DaySeparator(iso: message.createdAt)
                                }
                                MessageView(
                                    message: message,
                                    mine: message.isMine(api.identity),
                                    showAuthor: route.isGroup && showsAuthor(at: index, in: shown),
                                    viewerIdentity: api.identity,
                                    tallies: chatTally(reactions.reactions, messageId: message.id, myKey: memberKey),
                                    isPinned: reactions.pinned.contains { $0.id == message.id },
                                    isRead: isRead(message),
                                    callSlug: route.slug,
                                    openImage: { url in
                                        viewer = ImageViewerPayload(items: [ImageViewerItem(id: message.id, url: url, caption: message.body)], startIndex: 0)
                                    },
                                    sendProof: { assignment, card in
                                        proofFor = ProofTarget(id: assignment.id, title: card.title, detail: card.description)
                                    },
                                    onReact: { emoji in Task { try? await api.toggleChatReaction(messageId: message.id, emoji: emoji) } },
                                    onPin: { pin in Task { try? await api.setChatPinned(messageId: message.id, pin: pin) } },
                                    onDelete: canDelete(message) ? { deleteTarget = message } : nil,
                                    onCardChanged: { Task { await load() } }
                                )
                                .id(message.id)
                            }
                        } else if let errorMessage {
                            ErrorState(message: errorMessage) { await load() }
                        } else {
                            ProgressView().padding(.top, 60)
                        }
                        Color.clear.frame(height: 4).id("bottom")
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: messages?.last?.id) { _ in
                    guard scrollTarget == nil else { return }
                    withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
                }
                .onChange(of: composerFocused) { focused in
                    if focused {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                        }
                    }
                }
                .onChange(of: scrollTarget) { target in
                    guard let target else { return }
                    withAnimation { proxy.scrollTo(target, anchor: .center) }
                    scrollTarget = nil
                }
                .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
            }

            if let name = typingName {
                HStack(spacing: 6) {
                    ProgressView().scaleEffect(0.6)
                    Text(L("%@ is typing…", name)).font(.system(size: 12)).foregroundStyle(Color.neonInk.opacity(0.5))
                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.top, 2)
                .transition(.opacity)
            }

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
                HStack(spacing: 8) {
                    AvatarView(url: resolvedMediaURL(route.avatar), name: route.title, size: 30)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(route.title).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                        if let subtitle = route.subtitle, !subtitle.isEmpty {
                            Text(subtitle).font(.system(size: 11)).foregroundStyle(Color.neonInk.opacity(0.5)).lineLimit(1)
                        }
                    }
                }
            }
        }
        .task { await poll() }
        .task { await listenLive() }
        .task { taggableProjects = (try? await api.fetchChatProjects()) ?? [] }
        .fullScreenCover(item: $viewer) { ImageViewerView(payload: $0) }
        .sheet(item: $proofFor) { target in
            ProofSheet(targetId: target.id, title: target.title, subtitle: target.detail) {
                Task { await load() }
            }
        }
        .sheet(isPresented: $showTaskCompose) {
            ChatTaskComposeSheet(conversationSlug: route.slug) { Task { await load() } }
        }
        .sheet(isPresented: $showMeetingCompose) {
            ChatMeetingComposeSheet(conversationSlug: route.slug) { Task { await load() } }
        }
        .sheet(isPresented: $showAssistant) { ChatAssistantSheet() }
        .confirmationDialog(L("Delete this message?"), isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } }), titleVisibility: .visible) {
            Button(L("Delete"), role: .destructive) {
                if let target = deleteTarget { Task { await delete(target) } }
                deleteTarget = nil
            }
            Button(L("Cancel"), role: .cancel) { deleteTarget = nil }
        }
        .photosPicker(isPresented: $showPhotos, selection: $photoItem, matching: .images)
        .onChange(of: photoItem) { item in
            guard let item else { return }
            photoItem = nil
            Task {
                guard let file = await UploadMaker.photo(item) else {
                    sendError = L("That photo could not be read.")
                    return
                }
                await send(file: file)
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                guard let file = UploadMaker.photo(image) else { return }
                Task { await send(file: file) }
            }
            .ignoresSafeArea()
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: UploadMaker.documentTypes) { result in
            guard case .success(let url) = result else { return }
            guard let file = UploadMaker.file(url, field: "document") else {
                sendError = L("That file could not be read.")
                return
            }
            Task { await send(file: file) }
        }
        .alert(L("Microphone access is off"), isPresented: $recorder.permissionDenied) {
            Button(L("OK"), role: .cancel) {}
        } message: {
            Text(L("Turn it on in Settings to send a voice message."))
        }
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
                if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(chatQuickReplies, id: \.text) { reply in
                                Button { Task { await sendQuick(reply.text) } } label: {
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
                    .disabled(sending || cachedAt != nil)

                    TextField(L("Message"), text: $draft, axis: .vertical)
                        .lineLimit(1...5)
                        .focused($composerFocused)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.neonInk.opacity(0.1)))
                        .environment(\.layoutDirection, naturalDirection(draft) ?? AppLanguage.current.layoutDirection)
                        .onChange(of: draft) { _ in noteTyping() }

                    Button {
                        if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Haptic.tap()
                            recorder.start()
                        } else {
                            Task { await sendText() }
                        }
                    } label: {
                        ZStack {
                            if sending {
                                ProgressView().tint(.white)
                            } else {
                                Image(systemName: draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "mic.fill" : "arrow.up")
                                    .font(.system(size: 16, weight: .bold))
                            }
                        }
                        .foregroundStyle(.white)
                        .frame(width: 38, height: 38)
                        .background(Color.neonPurpleStrong, in: Circle())
                    }
                    .disabled(sending || cachedAt != nil)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
            }
        }
        .background(.ultraThinMaterial)
    }

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
                Task { await sendVoice(url: taken.url, seconds: taken.seconds) }
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

    /// The viewer's own key on this card and conversation — "admin" for the
    /// manager, the employee id otherwise. The same key ChatRead, presence and
    /// meeting attendees use.
    private var memberKey: String {
        guard let identity = api.identity else { return "" }
        return identity.side == .admin ? "admin" : (identity.id ?? "")
    }

    private var typingName: String? {
        people.typing.first { $0.memberKey != memberKey }?.name
    }

    /// The other person's key in a private chat, for a read tick — nil in the
    /// group, where one pair of ticks cannot honestly mean "everybody".
    private var otherKey: String? {
        guard !route.isGroup, let identity = api.identity else { return nil }
        if identity.side == .admin { return route.slug }
        return route.slug == "manager" ? "admin" : route.slug
    }

    private func isRead(_ message: ChatMessage) -> Bool {
        guard message.isMine(api.identity), let otherKey, let createdAt = parseISODate(message.createdAt) else { return false }
        guard let mark = people.reads.first(where: { $0.key == otherKey }), let at = parseISODate(mark.at) else { return false }
        return at >= createdAt
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

    private func noteTyping() {
        let now = Date()
        if let last = lastTypingSentAt, now.timeIntervalSince(last) < 3 { return }
        lastTypingSentAt = now
        Task { await api.sendChatTyping(conversation: draft.isEmpty ? nil : route.slug) }
    }

    // MARK: Reading

    private func poll() async {
        await load()
        await markRead()
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 4 * 1_000_000_000)
            if Task.isCancelled { break }
            let before = messages?.last?.id
            await load()
            if messages?.last?.id != before { await markRead() }
        }
    }

    private func listenLive() async {
        guard let token = api.token else { return }
        await ChatStream.listen(conversation: route.slug, token: token) { event in
            Task { @MainActor in
                switch event {
                case .messages(let batch):
                    for message in batch { append(message) }
                    if !batch.isEmpty { await markRead() }
                case .reactions(let snapshot):
                    reactions = snapshot
                case .people(let snapshot):
                    people = snapshot
                case .connected:
                    break
                }
            }
        }
    }

    private func load() async {
        do {
            let loaded = try await api.fetchMessages(conversation: route.slug)
            if loaded.value != messages { messages = loaded.value }
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            if messages == nil { errorMessage = error.localizedDescription }
        }
        if let snapshot = try? await api.fetchChatReactions(conversation: route.slug) { reactions = snapshot }
    }

    private func markRead() async {
        guard cachedAt == nil, messages != nil else { return }
        try? await api.markConversationRead(route.slug)
    }

    // MARK: Sending

    private func sendText() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        sending = true
        sendError = nil
        defer { sending = false }
        do {
            let message = try await api.sendMessage(conversation: route.slug, text: text, projectId: taggedProjectId)
            draft = ""
            append(message)
            Haptic.tap()
            await api.sendChatTyping(conversation: nil)
        } catch APIError.unauthorized {
        } catch {
            sendError = error.localizedDescription
            Haptic.error()
        }
    }

    private func sendQuick(_ text: String) async {
        Haptic.tap()
        do {
            let message = try await api.sendMessage(conversation: route.slug, text: text)
            append(message)
        } catch {
            Toast.error(error)
        }
    }

    private func send(file: UploadFile) async {
        sending = true
        sendError = nil
        defer { sending = false }
        let caption = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let message = try await api.sendAttachment(conversation: route.slug, text: caption, file: file, projectId: taggedProjectId)
            draft = ""
            append(message)
            Haptic.success()
        } catch APIError.unauthorized {
        } catch {
            sendError = error.localizedDescription
            Haptic.error()
        }
    }

    private func sendVoice(url: URL, seconds: Int) async {
        sending = true
        defer { sending = false }
        do {
            let data = try Data(contentsOf: url)
            let file = UploadFile(field: "voice", filename: "voice.m4a", mimeType: "audio/mp4", data: data)
            let message = try await api.sendVoice(conversation: route.slug, file: file, durationSeconds: seconds, projectId: taggedProjectId)
            append(message)
            Haptic.success()
        } catch {
            sendError = error.localizedDescription
            Haptic.error()
        }
        try? FileManager.default.removeItem(at: url)
    }

    private func delete(_ message: ChatMessage) async {
        do {
            try await api.perform("chat/messages/delete", args: [message.id])
            messages?.removeAll { $0.id == message.id }
            Haptic.tap()
        } catch {
            Toast.error(error)
        }
    }

    private func append(_ message: ChatMessage) {
        var list = messages ?? []
        if let index = list.firstIndex(where: { $0.id == message.id }) {
            list[index] = message
        } else {
            list.append(message)
        }
        messages = list
    }

    // MARK: Layout helpers

    private func startsNewDay(at index: Int, in list: [ChatMessage]) -> Bool {
        guard let date = parseISODate(list[index].createdAt) else { return false }
        guard index > 0, let previous = parseISODate(list[index - 1].createdAt) else { return true }
        return !Calendar.current.isDate(date, inSameDayAs: previous)
    }

    private func showsAuthor(at index: Int, in list: [ChatMessage]) -> Bool {
        guard index > 0 else { return true }
        let previous = list[index - 1]
        let current = list[index]
        return previous.authorType != current.authorType || previous.authorId != current.authorId || previous.kind == "CALL"
    }
}


private struct DaySeparator: View {
    let iso: String

    var body: some View {
        Text(label)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color.neonInk.opacity(0.5))
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Color.neonInk.opacity(0.06), in: Capsule())
            .padding(.vertical, 8)
    }

    private var label: String {
        guard let date = parseISODate(iso) else { return "" }
        if Calendar.current.isDateInToday(date) { return L("Today") }
        if Calendar.current.isDateInYesterday(date) { return L("Yesterday") }
        return date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: AppLanguage.current.locale))
    }
}

// MARK: - One message

private struct MessageView: View {
    let message: ChatMessage
    let mine: Bool
    let showAuthor: Bool
    let viewerIdentity: Identity?
    let tallies: [ChatReactionTally]
    let isPinned: Bool
    let isRead: Bool
    let callSlug: String
    let openImage: (URL) -> Void
    let sendProof: (TaskCard.Assignment, TaskCard) -> Void
    let onReact: (String) -> Void
    let onPin: (Bool) -> Void
    let onDelete: (() -> Void)?
    let onCardChanged: () -> Void

    @Environment(\.openURL) private var openURL
    @ObservedObject private var voicePlayer = ChatVoicePlayer.shared

    var body: some View {
        switch message.kind {
        case "CALL":
            callLine
        case "TASK":
            if let card = message.task {
                aligned {
                    TaskCardView(card: card, message: message, viewer: viewerIdentity, sendProof: sendProof, onChanged: onCardChanged)
                        .contextMenu { pinMenu }
                }
            } else {
                aligned { bubble }
            }
        case "MEETING":
            if let meeting = message.meeting {
                aligned {
                    MeetingCardView(meeting: meeting, callSlug: callSlug, callTitle: message.body ?? "", viewer: viewerIdentity, onChanged: onCardChanged)
                        .contextMenu { pinMenu }
                }
            } else {
                aligned { bubble }
            }
        default:
            aligned {
                bubble
                    .contextMenu {
                        ForEach(chatReactionSet, id: \.self) { emoji in
                            Button { onReact(emoji) } label: { Text(emoji) }
                        }
                        pinMenu
                        if let onDelete {
                            Button(role: .destructive, action: onDelete) { Label(L("Delete"), systemImage: "trash") }
                        }
                    }
            }
        }
    }

    @ViewBuilder
    private var pinMenu: some View {
        Button { onPin(!isPinned) } label: {
            Label(isPinned ? L("Unpin") : L("Pin"), systemImage: isPinned ? "pin.slash" : "pin")
        }
    }

    /// Mine on the trailing side, everybody else's on the leading side — which
    /// flips with the app's language, as a chat on either kind of phone does.
    private func aligned<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: mine ? .trailing : .leading, spacing: 3) {
            if showAuthor && !mine, let name = message.authorName {
                Text(name)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.neonPurpleStrong)
                    .padding(.horizontal, 6)
            }
            content()
            ChatReactionRow(tallies: tallies, onToggle: onReact)
                .padding(.horizontal, 6)
            HStack(spacing: 4) {
                if isPinned { Image(systemName: "pin.fill").font(.system(size: 9)) }
                if message.managerOnly == true {
                    Image(systemName: "eye.slash")
                    Text(L("Only you"))
                }
                if let time = parseISODate(message.createdAt) {
                    Text(time.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: AppLanguage.current.locale)))
                }
                if mine && isRead {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 9)).foregroundStyle(Color.neonPurpleStrong)
                } else if mine {
                    Image(systemName: "checkmark").font(.system(size: 9))
                }
            }
            .font(.system(size: 10))
            .foregroundStyle(Color.neonInk.opacity(0.4))
            .padding(.horizontal, 6)
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .padding(mine ? .leading : .trailing, 44)
    }

    @ViewBuilder
    private var bubble: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let project = message.project {
                Label(project.name, systemImage: "folder")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(mine ? Color.white.opacity(0.8) : Color.neonCyanStrong)
            }

            switch message.isPicture ? "IMAGE" : message.kind {
            case "IMAGE":
                if let url = message.attachmentURL {
                    Button { openImage(url) } label: {
                        AsyncImage(url: url) { phase in
                            if let image = phase.image {
                                image.resizable().scaledToFill()
                            } else if phase.error != nil {
                                VStack(spacing: 6) {
                                    Image(systemName: "photo").font(.system(size: 26))
                                    if let name = message.attachmentName {
                                        Text(verbatim: name).font(.system(size: 11)).lineLimit(2)
                                    }
                                    Text(L("Couldn't load the picture")).font(.system(size: 11, weight: .medium))
                                }
                                .foregroundStyle(mine ? Color.white.opacity(0.75) : Color.neonInk.opacity(0.4))
                                .padding(12)
                            } else {
                                ProgressView()
                            }
                        }
                        .frame(width: 220, height: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            case "VOICE":
                if let url = message.attachmentURL {
                    voiceBubble(url: url)
                }
            case "FILE":
                if let url = message.attachmentURL {
                    Button { openURL(url) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "doc.fill").font(.system(size: 26))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: message.attachmentName ?? L("File"))
                                    .font(.system(size: 14, weight: .semibold))
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                                Text(fileDetail)
                                    .font(.system(size: 11))
                                    .opacity(0.7)
                            }
                        }
                        .foregroundStyle(mine ? Color.white : Color.neonInk)
                    }
                    .buttonStyle(.plain)
                }
            default:
                EmptyView()
            }

            if let body = message.body, !body.isEmpty {
                DirText(body, font: .system(size: 16), color: mine ? .white : .neonInk, fill: false)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(
            mine ? AnyShapeStyle(Color.neonPurpleStrong) : AnyShapeStyle(Color.white),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(mine ? Color.clear : Color.neonInk.opacity(0.07))
        )
    }

    private func voiceBubble(url: URL) -> some View {
        let playing = voicePlayer.playingURL == url
        return Button { voicePlayer.toggle(url: url) } label: {
            HStack(spacing: 10) {
                Image(systemName: playing ? "pause.circle.fill" : "play.circle.fill").font(.system(size: 30))
                VStack(alignment: .leading, spacing: 4) {
                    ProgressBar(progress: playing ? voicePlayer.progress : 0, tint: mine ? .white : .neonPurpleStrong, height: 4)
                        .frame(width: 120)
                    Text(message.durationSeconds.map { String(format: "0:%02d", Int($0)) } ?? L("Voice message"))
                        .font(.system(size: 11))
                }
            }
            .foregroundStyle(mine ? Color.white : Color.neonInk)
        }
        .buttonStyle(.plain)
    }

    private var fileDetail: String {
        var parts: [String] = []
        if let type = message.attachmentType { parts.append(type.uppercased()) }
        if let size = message.attachmentSize { parts.append(byteCount(size)) }
        parts.append(L("Tap to open"))
        return parts.joined(separator: " · ")
    }

    private var callLine: some View {
        HStack(spacing: 6) {
            Image(systemName: message.call?.kind == "VIDEO" ? "video.fill" : "phone.fill")
            Text(verbatim: [message.body ?? L("Call"), message.authorName].compactMap { $0 }.joined(separator: " · "))
        }
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(message.call?.endReason == "missed" ? Color.red.opacity(0.8) : Color.neonInk.opacity(0.5))
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.neonInk.opacity(0.05), in: Capsule())
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
    }
}

// MARK: - Cards

/// A job handed out from the chat. Each person on it has their own part; the
/// person looking at their own part, while it is still theirs to do, gets the
/// one action that moves it on — sending proof. The manager approves or sends
/// it back right here, exactly where the web review queue's buttons lead —
/// "Done" stays the manager's word either way — and everybody on the card can
/// talk about it in the thread underneath.
private struct TaskCardView: View {
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
private struct MeetingCardView: View {
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
