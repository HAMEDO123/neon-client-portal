import SwiftUI
import UIKit

// One open conversation's state, kept apart from the screen so its rules are
// in one place:
//
// - **Messages** come from two directions and are merged, never duplicated:
//   the live stream (ChatStream) delivers a new one the moment it is sent, and
//   a poll of `/chat/messages` every four seconds re-reads the recent list —
//   the fallback when the stream is down, and the source every task and
//   meeting card refreshes its state from. A message the stream (or a send)
//   delivered a moment ago is kept even when a poll that left before it
//   arrived does not have it yet; anything older than the poll's newest that
//   the poll no longer has was deleted, and goes.
// - **What I send** appears at once, as a stand-in with a clock, and is
//   replaced by the server's own copy when it answers. Sends go one at a time,
//   in the order they were written, so a quick burst arrives in order. One
//   that fails stays in the conversation, marked, with Retry.
// - **Who is writing, and how far everybody has read**, from the stream's
//   `people` event — or, while the stream is not connected, from
//   `chat/receipts`, the same snapshot read on its own.
// - **Reading**: while the screen is open and the app is in front, anything
//   that arrives is marked read at once, as WhatsApp does.
@MainActor
final class ChatConversationStore: ObservableObject {
    let slug: String
    let isGroup: Bool

    /// The server's messages, oldest first. nil until the first read answers.
    @Published private(set) var messages: [ChatMessage]?
    /// What this phone is sending, or failed to send, in the order written.
    @Published private(set) var outgoing: [ChatOutgoing] = []
    @Published private(set) var cachedAt: Date?
    @Published private(set) var errorMessage: String?
    @Published private(set) var reactions = ChatReactionSnapshot()
    /// Who else is writing here right now.
    @Published private(set) var typing: [ChatPeopleSnapshot.Typing] = []
    @Published private(set) var people = ChatPeopleSnapshot()
    @Published private(set) var receipts = ChatReceiptBoard.unknown
    /// Counts every message from somebody else that arrived after the first
    /// read — the screen's "new messages" pill counts from it.
    @Published private(set) var arrivedFromOthers = 0

    /// The app is in front with this conversation on screen. Nothing is
    /// marked read while it is not.
    var isActive = true {
        didSet { if isActive, !oldValue { Task { await markRead() } } }
    }

    private weak var api: APIClient?
    private var identity: Identity?
    /// Messages the stream or a send delivered, and when — kept through a poll
    /// that left before they arrived.
    private var recent: [String: Date] = [:]
    private var streamLive = false
    private var peopleAt: Date?
    private var pumping = false
    private var typingSentAt: Date?
    private var readInFlight = false
    private var readAgain = false

    init(slug: String, isGroup: Bool) {
        self.slug = slug
        self.isGroup = isGroup
    }

    /// The viewer's own key — "admin" for the manager, the employee id
    /// otherwise. The same key ChatRead, presence and reactions use.
    var myKey: String {
        guard let identity else { return "" }
        return identity.side == .admin ? "admin" : (identity.id ?? "")
    }

    /// What is drawn after the server's messages: every stand-in whose own
    /// copy has not arrived through the stream yet.
    var pending: [ChatOutgoing] { outgoing.filter { !$0.echoed } }

    // MARK: Running

    /// Reads the conversation, then keeps it live — the stream and the poll
    /// side by side — until the screen goes away and cancels it.
    func run(api: APIClient) async {
        self.api = api
        identity = api.identity
        await load()
        await refreshReceipts()
        await refreshReactions()
        await markRead()
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.listen() }
            group.addTask { await self.pollLoop() }
        }
        stopTyping()
    }

    private func pollLoop() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 4 * 1_000_000_000)
            if Task.isCancelled { break }
            guard isActive else { continue }
            await load()
            if !streamLive {
                await refreshReceipts()
                await refreshReactions()
            } else if !typing.isEmpty, let peopleAt, Date().timeIntervalSince(peopleAt) > 12 {
                // Somebody writing refreshes the stream's snapshot every few
                // seconds (writing is also beating). Twelve seconds of quiet
                // means that news stopped coming: ask directly rather than
                // leave "typing…" up.
                await refreshReceipts()
            }
        }
    }

    private func listen() async {
        guard let token = api?.token else { return }
        let since = messages?.last.flatMap { parseISODate($0.createdAt) }
        await ChatStream.listen(conversation: slug, token: token, since: since) { [weak self] event in
            Task { @MainActor in self?.handle(event) }
        }
    }

    private func handle(_ event: ChatStreamEvent) {
        switch event {
        case .messages(let batch):
            absorb(batch)
        case .reactions(let snapshot):
            if snapshot != reactions { reactions = snapshot }
        case .people(let snapshot):
            setPeople(snapshot)
        case .connected:
            streamLive = true
        case .disconnected:
            streamLive = false
        }
    }

    // MARK: Reading

    func load() async {
        guard let api else { return }
        do {
            let loaded = try await api.fetchMessages(conversation: slug)
            merge(server: loaded.value)
            if cachedAt != loaded.cachedAt { cachedAt = loaded.cachedAt }
            errorMessage = nil
        } catch {
            if messages == nil { errorMessage = error.localizedDescription }
        }
    }

    private func refreshReactions() async {
        guard let api, let snapshot = try? await api.fetchChatReactions(conversation: slug) else { return }
        if snapshot != reactions { reactions = snapshot }
    }

    private func refreshReceipts() async {
        guard let api else { return }
        do {
            let loaded = try await api.fetchChatReceipts(conversation: slug)
            var snapshot = loaded.value
            // A saved copy says who was writing when it was saved, not now.
            if loaded.cachedAt != nil { snapshot.typing = [] }
            setPeople(snapshot)
        } catch {
            if !typing.isEmpty { typing = [] }
        }
    }

    private func setPeople(_ snapshot: ChatPeopleSnapshot) {
        peopleAt = Date()
        let others = snapshot.typing.filter { $0.memberKey != myKey }
        if others != typing { typing = others }
        if snapshot != people { people = snapshot }
        let board = ChatReceiptBoard(snapshot: snapshot, fallbackOtherKey: otherKey)
        if board != receipts { receipts = board }
    }

    /// The other person's key in a private chat — the one read marker an older
    /// server sends that a tick can still be drawn from. nil in a group.
    private var otherKey: String? {
        guard !isGroup, let identity else { return nil }
        if identity.side == .admin { return slug }
        return slug == "manager" ? "admin" : slug
    }

    /// The poll's answer, merged with what the stream and sends delivered.
    private func merge(server: [ChatMessage]) {
        let now = Date()
        recent = recent.filter { now.timeIntervalSince($0.value) < 30 }
        let serverIds = Set(server.map(\.id))
        let newest = server.last?.createdAt ?? ""
        var merged = server
        if let current = messages {
            // ISO strings from the server all have one shape, so they order as dates.
            let kept = current.filter { !serverIds.contains($0.id) && recent[$0.id] != nil && $0.createdAt >= newest }
            if !kept.isEmpty {
                merged.append(contentsOf: kept)
                merged.sort { $0.createdAt < $1.createdAt }
            }
        }
        let known = Set((messages ?? []).map(\.id))
        let fresh = messages == nil ? 0 : merged.filter { !known.contains($0.id) && !$0.isMine(identity) }.count
        if merged != messages { messages = merged }
        settleEchoes()
        if fresh > 0 {
            arrivedFromOthers += fresh
            Task { await markRead() }
        }
    }

    /// New messages from the stream: each once, in order.
    private func absorb(_ batch: [ChatMessage]) {
        guard !batch.isEmpty else { return }
        var list = messages ?? []
        var fresh = 0
        var outOfOrder = false
        for message in batch {
            recent[message.id] = Date()
            if let index = list.firstIndex(where: { $0.id == message.id }) {
                list[index] = message
            } else {
                if let last = list.last, last.createdAt > message.createdAt { outOfOrder = true }
                list.append(message)
                if !message.isMine(identity) { fresh += 1 }
            }
        }
        if outOfOrder { list.sort { $0.createdAt < $1.createdAt } }
        messages = list
        settleEchoes()
        if fresh > 0 {
            arrivedFromOthers += fresh
            Task { await markRead() }
        }
    }

    /// Marks the conversation read while it is open and in front. Arrivals in
    /// quick succession are folded into one more request, not one each.
    func markRead() async {
        guard isActive, cachedAt == nil, messages != nil, let api else { return }
        if readInFlight {
            readAgain = true
            return
        }
        readInFlight = true
        repeat {
            readAgain = false
            try? await api.markConversationRead(slug)
        } while readAgain
        readInFlight = false
    }

    // MARK: Sending

    func sendText(_ text: String, project: ChatMessage.ProjectTag?) {
        enqueue(.text(text), project: project)
    }

    func sendFile(_ file: UploadFile, caption: String, project: ChatMessage.ProjectTag?) {
        enqueue(.file(file, caption: caption), project: project)
    }

    func sendVoice(_ file: UploadFile, seconds: Int, project: ChatMessage.ProjectTag?) {
        enqueue(.voice(file, seconds: seconds), project: project)
    }

    /// Sends a failed one again, from where it stands in the conversation.
    func retry(_ id: String) {
        guard let index = outgoing.firstIndex(where: { $0.id == id }) else { return }
        outgoing[index].phase = .queued
        pump()
    }

    /// Takes a failed one out of the conversation without sending it.
    func discard(_ id: String) {
        outgoing.removeAll { $0.id == id }
    }

    private func enqueue(_ payload: ChatOutgoing.Payload, project: ChatMessage.ProjectTag?) {
        let item = ChatOutgoing(
            payload: payload,
            project: project,
            author: identity,
            knownIds: Set((messages ?? []).map(\.id))
        )
        outgoing.append(item)
        pump()
    }

    /// Sends what is queued, one at a time and in order.
    private func pump() {
        guard !pumping, let api else { return }
        pumping = true
        Task {
            while let index = outgoing.firstIndex(where: { $0.phase == .queued }) {
                outgoing[index].phase = .sending
                let item = outgoing[index]
                do {
                    let message = try await deliver(item, api: api)
                    recent[message.id] = Date()
                    var list = messages ?? []
                    if let existing = list.firstIndex(where: { $0.id == message.id }) {
                        list[existing] = message
                    } else {
                        list.append(message)
                        if list.count > 1, list[list.count - 2].createdAt > message.createdAt {
                            list.sort { $0.createdAt < $1.createdAt }
                        }
                    }
                    // The picture already on screen is the server's picture:
                    // kept under its new address, the real message draws at
                    // once, at the same shape, without fetching it back.
                    if let image = item.localImage, let url = message.attachmentURL {
                        ChatPhotoCache.shared.store(image, for: url)
                    }
                    // The same for a video: the frame read from this phone's
                    // own copy is the frame of the server's.
                    if let upload = item.videoUpload, let url = message.attachmentURL {
                        ChatVideoPosters.shared.adopt(upload.key, as: url)
                    }
                    // Swapped in one step, not animated: two rows crossfading
                    // would briefly take the space of both.
                    messages = list
                    outgoing.removeAll { $0.id == item.id }
                } catch {
                    guard let failed = outgoing.firstIndex(where: { $0.id == item.id }) else { continue }
                    if outgoing[failed].echoed {
                        // The answer was lost, but the stream already brought
                        // the server's copy: it was sent. Nothing to retry.
                        outgoing.remove(at: failed)
                    } else {
                        outgoing[failed].phase = .failed(error.localizedDescription)
                        Haptic.error()
                    }
                }
            }
            pumping = false
        }
    }

    private func deliver(_ item: ChatOutgoing, api: APIClient) async throws -> ChatMessage {
        switch item.payload {
        case .text(let text):
            return try await api.sendMessage(conversation: slug, text: text, projectId: item.project?.id)
        case .file(let file, let caption):
            return try await api.sendAttachment(conversation: slug, text: caption, file: file, projectId: item.project?.id)
        case .voice(let file, let seconds):
            return try await api.sendVoice(conversation: slug, file: file, durationSeconds: seconds, projectId: item.project?.id)
        }
    }

    /// A stand-in whose own copy the stream brought before the send answered
    /// is hidden, so the message is not on screen twice for that moment.
    private func settleEchoes() {
        guard let messages, outgoing.contains(where: { !$0.echoed && $0.phase == .sending }) else { return }
        var claimed = Set(outgoing.compactMap(\.echoId))
        for index in outgoing.indices where !outgoing[index].echoed && outgoing[index].phase == .sending {
            let item = outgoing[index]
            if let match = messages.first(where: {
                !claimed.contains($0.id) && !item.knownIds.contains($0.id) && $0.isMine(identity) && item.matches($0)
            }) {
                claimed.insert(match.id)
                outgoing[index].echoId = match.id
            }
        }
    }

    func delete(_ message: ChatMessage) async {
        do {
            try await api?.perform("chat/messages/delete", args: [message.id])
            messages?.removeAll { $0.id == message.id }
            recent[message.id] = nil
            Haptic.tap()
        } catch {
            Toast.error(error)
        }
    }

    // MARK: Typing

    /// "I am writing", at most every four seconds while there is a draft —
    /// the web's own cadence — and "I stopped" the moment the draft empties.
    func draftChanged(_ draft: String) {
        guard cachedAt == nil, let api else { return }
        if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            stopTyping()
            return
        }
        let now = Date()
        if let sent = typingSentAt, now.timeIntervalSince(sent) < 4 { return }
        typingSentAt = now
        let slug = slug
        Task { await api.sendChatTyping(conversation: slug) }
    }

    func stopTyping() {
        guard typingSentAt != nil, let api else { return }
        typingSentAt = nil
        Task { await api.sendChatTyping(conversation: nil) }
    }
}

/// A message this phone is sending (or could not send), drawn in the
/// conversation as a stand-in `ChatMessage` until the server's own replaces it.
struct ChatOutgoing: Identifiable {
    enum Payload {
        case text(String)
        case file(UploadFile, caption: String)
        case voice(UploadFile, seconds: Int)
    }

    enum Phase: Equatable {
        case queued
        case sending
        case failed(String)
    }

    let id: String
    let payload: Payload
    let project: ChatMessage.ProjectTag?
    var phase: Phase = .queued
    /// The server's copy that arrived through the stream before the send
    /// answered, which this stand-in is now hiding behind.
    var echoId: String?
    var echoed: Bool { echoId != nil }
    /// Every message already on screen when this one was written, none of
    /// which can be its copy.
    let knownIds: Set<String>
    /// The picture being sent, shown while it goes up.
    let localImage: UIImage?
    /// What is drawn.
    let message: ChatMessage

    init(payload: Payload, project: ChatMessage.ProjectTag?, author: Identity?, knownIds: Set<String>) {
        let id = "local-\(UUID().uuidString)"
        self.id = id
        self.payload = payload
        self.project = project
        self.knownIds = knownIds

        var kind = "TEXT"
        var body: String?
        var name: String?
        var type: String?
        var size: Int?
        var seconds: Double?
        var image: UIImage?
        switch payload {
        case .text(let text):
            body = text
        case .file(let file, let caption):
            kind = file.field == "photo" ? "IMAGE" : "FILE"
            body = caption.isEmpty ? nil : caption
            name = file.filename
            type = (file.filename as NSString).pathExtension.lowercased()
            size = file.data.count
            if file.mimeType.hasPrefix("image/"), let full = UIImage(data: file.data) {
                // Shown at chat size, not held at the upload's 2400 pixels.
                let scale = min(1, 900 / max(full.size.width, full.size.height, 1))
                image = full.preparingThumbnail(of: CGSize(width: full.size.width * scale, height: full.size.height * scale)) ?? full
            }
        case .voice(let file, let length):
            kind = "VOICE"
            name = file.filename
            seconds = Double(length)
        }
        localImage = image

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        message = ChatMessage(
            id: id,
            authorType: author?.side == .admin ? "ADMIN" : "EMPLOYEE",
            authorId: author?.side == .admin ? nil : author?.id,
            authorName: author?.name,
            kind: kind,
            body: body,
            attachmentUrl: nil,
            attachmentName: name,
            attachmentType: type,
            attachmentSize: size,
            durationSeconds: seconds,
            managerOnly: false,
            createdAt: formatter.string(from: Date()),
            project: project,
            task: nil,
            call: nil,
            meeting: nil
        )
    }

    /// Whether a message from the server is this one's copy.
    func matches(_ other: ChatMessage) -> Bool {
        switch payload {
        case .text(let text):
            return other.kind == "TEXT" && other.body == text
        case .file(_, let caption):
            return (other.kind == "IMAGE" || other.kind == "FILE") && (other.body ?? "") == caption
        case .voice:
            return other.kind == "VOICE"
        }
    }

    var delivery: ChatDelivery {
        if case .failed = phase { return .failed }
        return .sending
    }

    var failure: String? {
        if case .failed(let message) = phase { return message }
        return nil
    }
}
