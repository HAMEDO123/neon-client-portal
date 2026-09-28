import PhotosUI
import SwiftUI

/// One conversation. It reads `/chat/messages` and re-reads it every few
/// seconds while open — the web has a live stream, the mobile API does not,
/// so this polls — and marks the conversation read so the web and the app
/// show the same unread number.
struct ChatRoomView: View {
    let route: ChatRoute

    @EnvironmentObject var api: APIClient
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
    @State private var web: WebPortalLink?
    @FocusState private var composerFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            if let cachedAt { OfflineBanner(savedAt: cachedAt).padding(.horizontal, 12).padding(.top, 6) }

            ScrollViewReader { reader in
                ScrollView {
                    LazyVStack(spacing: 6) {
                        if let messages {
                            if messages.isEmpty {
                                EmptyState(symbol: "bubble.left", title: L("No messages yet"), detail: L("Say hello."))
                            }
                            ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                                if startsNewDay(at: index, in: messages) {
                                    DaySeparator(iso: message.createdAt)
                                }
                                MessageView(
                                    message: message,
                                    mine: message.isMine(api.identity),
                                    showAuthor: route.isGroup && showsAuthor(at: index, in: messages),
                                    viewerIdentity: api.identity,
                                    openImage: { url in
                                        viewer = ImageViewerPayload(items: [ImageViewerItem(id: message.id, url: url, caption: message.body)], startIndex: 0)
                                    },
                                    sendProof: { assignment, card in
                                        proofFor = ProofTarget(id: assignment.id, title: card.title, detail: card.description)
                                    },
                                    openReviews: {
                                        web = WebPortalLink(path: "/admin/reviews", title: L("Reviews"),
                                                            hint: L("Approve the proof, or send it back with a reason."))
                                    }
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
                    withAnimation(.easeOut(duration: 0.2)) { reader.scrollTo("bottom", anchor: .bottom) }
                }
                .onChange(of: composerFocused) { focused in
                    if focused {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            withAnimation { reader.scrollTo("bottom", anchor: .bottom) }
                        }
                    }
                }
                .onAppear { reader.scrollTo("bottom", anchor: .bottom) }
            }

            composer
        }
        .background(Color.neonBg.ignoresSafeArea())
        // The whole screen belongs to the conversation, as it does on the web.
        .toolbar(.hidden, for: .tabBar)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Calls run on the website's own call screen, opened here signed
            // in, until the phone API has call routes (ios/SERVER-REQUEST.md).
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { openCall() } label: { Image(systemName: "phone.fill") }
                    .accessibilityLabel(L("Voice call"))
                Button { openCall() } label: { Image(systemName: "video.fill") }
                    .accessibilityLabel(L("Video call"))
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
        .fullScreenCover(item: $viewer) { ImageViewerView(payload: $0) }
        .fullScreenCover(item: $web) { WebPortalSheet(link: $0) }
        .sheet(item: $proofFor) { target in
            ProofSheet(targetId: target.id, title: target.title, subtitle: target.detail) {
                Task { await load() }
            }
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
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    if CameraPicker.isAvailable {
                        Button { showCamera = true } label: { Label(L("Camera"), systemImage: "camera") }
                    }
                    Button { showPhotos = true } label: { Label(L("Photo"), systemImage: "photo") }
                    Button { showFiles = true } label: { Label(L("File"), systemImage: "doc") }
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

                Button {
                    Task { await sendText() }
                } label: {
                    ZStack {
                        if sending {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "arrow.up").font(.system(size: 16, weight: .bold))
                        }
                    }
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(canSend ? Color.neonPurpleStrong : Color.neonInk.opacity(0.2), in: Circle())
                }
                .disabled(!canSend)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
        }
        .background(.ultraThinMaterial)
    }

    private var canSend: Bool {
        !sending && cachedAt == nil && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func openCall() {
        Haptic.tap()
        guard let identity = api.identity else { return }
        web = WebPortalLink(
            path: identity.webChatPath(route.slug),
            title: route.title,
            hint: L("Start or join the call with the buttons at the top of the chat.")
        )
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

    private func load() async {
        do {
            let loaded = try await api.fetchMessages(conversation: route.slug)
            if loaded.value != messages { messages = loaded.value }
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            if messages == nil { errorMessage = error.localizedDescription }
        }
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
            let message = try await api.sendMessage(conversation: route.slug, text: text)
            draft = ""
            append(message)
            Haptic.tap()
        } catch APIError.unauthorized {
        } catch {
            // The draft stays in the box, so nothing typed is lost.
            sendError = error.localizedDescription
            Haptic.error()
        }
    }

    private func send(file: UploadFile) async {
        sending = true
        sendError = nil
        defer { sending = false }
        let caption = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let message = try await api.sendAttachment(conversation: route.slug, text: caption, file: file)
            draft = ""
            append(message)
            Haptic.success()
        } catch APIError.unauthorized {
        } catch {
            sendError = error.localizedDescription
            Haptic.error()
        }
    }

    private func append(_ message: ChatMessage) {
        var list = messages ?? []
        if !list.contains(where: { $0.id == message.id }) { list.append(message) }
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
    let openImage: (URL) -> Void
    let sendProof: (TaskCard.Assignment, TaskCard) -> Void
    let openReviews: () -> Void

    @Environment(\.openURL) private var openURL

    var body: some View {
        switch message.kind {
        case "CALL":
            callLine
        case "TASK":
            if let card = message.task {
                aligned { TaskCardView(card: card, message: message, viewer: viewerIdentity, sendProof: sendProof, openReviews: openReviews) }
            } else {
                aligned { bubble }
            }
        case "MEETING":
            if let meeting = message.meeting {
                aligned { MeetingCardView(meeting: meeting) }
            } else {
                aligned { bubble }
            }
        default:
            aligned { bubble }
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
            HStack(spacing: 4) {
                if message.managerOnly == true {
                    Image(systemName: "eye.slash")
                    Text(L("Only you"))
                }
                if let time = parseISODate(message.createdAt) {
                    Text(time.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: AppLanguage.current.locale)))
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
                                // Could not be fetched from here — say what it is, and
                                // the tap still offers it in the full-screen viewer.
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
            case "FILE", "VOICE":
                if let url = message.attachmentURL {
                    Button { openURL(url) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: message.kind == "VOICE" ? "waveform.circle.fill" : "doc.fill")
                                .font(.system(size: 26))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: message.kind == "VOICE" ? L("Voice message") : (message.attachmentName ?? L("File")))
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
            // One string, so the order survives either direction.
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
/// one action that moves it on — sending proof. Approving is the manager's,
/// on the web's review screen.
private struct TaskCardView: View {
    let card: TaskCard
    let message: ChatMessage
    let viewer: Identity?
    let sendProof: (TaskCard.Assignment, TaskCard) -> Void
    let openReviews: () -> Void

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
                            Button {
                                Haptic.tap()
                                openReviews()
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
        }
        .padding(14)
        .frame(width: 290, alignment: .leading)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.neonPurple.opacity(0.25)))
    }

    private func isMine(_ part: TaskCard.Assignment) -> Bool {
        viewer?.side == .employee && viewer?.id == part.employeeId
    }

}

/// A meeting set from the chat. Read-only here: answering it has no mobile
/// route yet, and joining is the web's call.
private struct MeetingCardView: View {
    let meeting: MeetingCard

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(L("MEETING"), systemImage: "calendar")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.neonCyanStrong)
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

            if !meeting.attendees.isEmpty {
                Divider()
                ForEach(meeting.attendees) { person in
                    HStack {
                        Text(person.name).font(.system(size: 13))
                        Spacer()
                        Text(rsvpLabel(person.rsvp))
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(person.rsvp == "ACCEPTED" ? Color.green : Color.neonInk.opacity(0.5))
                    }
                }
            }
        }
        .padding(14)
        .frame(width: 290, alignment: .leading)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.neonCyan.opacity(0.3)))
    }
}
