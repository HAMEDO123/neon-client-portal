import SwiftUI

/// Everything the share screen shows and does: who is signed in, what was
/// shared, the conversations, which are chosen, and the sending.
@MainActor
final class ShareModel: ObservableObject {
    enum Stage: Equatable {
        /// No session in the shared keychain: the app has not been signed in
        /// (or not opened since the update that moved the session there).
        case signedOut
        case picking
    }

    enum Sending: Equatable {
        case working(step: Int, total: Int, detail: String, fraction: Double?)
        /// `skippable` is the item that failed, when it can be left out.
        case failed(message: String, skippable: UUID?)
        case done
    }

    @Published var stage: Stage
    @Published var conversations: [ShareConversation]?
    @Published var listError: String?
    /// The attachments, in the order they were shared.
    @Published var items: [ShareItem] = []
    /// How many attachments are still arriving from the host app.
    @Published var itemsPending = 0
    /// More were shared than one go sends.
    @Published var droppedCount = 0
    /// The caption, or the whole message for a text or a link.
    @Published var message = ""
    @Published var query = ""
    /// Slugs, in the order they were ticked.
    @Published var selected: [String] = []
    @Published var sending: Sending?

    /// The server's limit on a message's text (MAX_BODY in the route).
    static let maxMessage = 4000

    private let api: ShareAPI?
    private let context: NSExtensionContext?
    private var sendTask: Task<Void, Never>?

    // Progress through a send, kept across a retry so nothing goes twice.
    private var delivered: Set<String> = []
    private var captioned: Set<String> = []
    private var skipped: Set<UUID> = []
    private var prepared: [UUID: ShareUpload] = [:]
    private var doneCount = 0

    init(context: NSExtensionContext?, token: String?) {
        self.context = context
        api = token.map(ShareAPI.init(token:))
        stage = token == nil ? .signedOut : .picking
    }

    #if DEBUG
    /// A screen with no session and no network, for looking at it.
    init(preview stage: Stage) {
        context = nil
        api = nil
        self.stage = stage
    }
    #endif

    // MARK: - Arriving

    func start() {
        guard stage == .picking else { return }
        ShareInbox.clear()
        Task { await loadConversations() }
        Task { await loadItems() }
    }

    func loadConversations() async {
        guard let api else { return }
        listError = nil
        do {
            conversations = try await api.conversations()
        } catch ShareError.unauthorized {
            stage = .signedOut
        } catch {
            listError = error.localizedDescription
        }
    }

    private func loadItems() async {
        let inputs = context?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let result = await ShareInbox.load(inputs) { [weak self] count in
            self?.itemsPending = count
        } onItem: { [weak self] item in
            guard let self else { return }
            withNeonAnimation(NeonMotion.snappy) {
                self.items.append(item)
                self.itemsPending = max(0, self.itemsPending - 1)
            }
        }
        itemsPending = 0
        droppedCount = result.dropped
        if message.isEmpty { message = String(result.text.prefix(Self.maxMessage)) }
    }

    // MARK: - Choosing

    var shownConversations: [ShareConversation] {
        guard let conversations else { return [] }
        let query = query.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return conversations }
        return conversations.filter { ($0.title + " " + ($0.subtitle ?? "")).shareMatches(query) }
    }

    var selectedConversations: [ShareConversation] {
        selected.compactMap { slug in conversations?.first { $0.slug == slug } }
    }

    func toggle(_ conversation: ShareConversation) {
        guard sending == nil else { return }
        Haptic.selection()
        withNeonAnimation(NeonMotion.snappy) {
            if let index = selected.firstIndex(of: conversation.slug) {
                selected.remove(at: index)
            } else {
                selected.append(conversation.slug)
            }
        }
    }

    func remove(_ item: ShareItem) {
        guard sending == nil else { return }
        Haptic.tap()
        withNeonAnimation(NeonMotion.snappy) { items.removeAll { $0.id == item.id } }
        // Each item has a folder of its own inside ours; only that one goes.
        let own = item.url.deletingLastPathComponent().standardizedFileURL
        if own.deletingLastPathComponent().path == ShareInbox.folder.standardizedFileURL.path {
            try? FileManager.default.removeItem(at: own)
        }
    }

    /// What will go: the attachments the server will take.
    var sendableItems: [ShareItem] {
        items.filter { $0.refusal == nil && !skipped.contains($0.id) }
    }

    var trimmedMessage: String {
        String(message.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.maxMessage))
    }

    var canSend: Bool {
        !selected.isEmpty && itemsPending == 0 && sending == nil
            && (!sendableItems.isEmpty || !trimmedMessage.isEmpty)
    }

    /// Nothing but text or a link was shared: the message is the thing sent.
    var isTextOnly: Bool { items.isEmpty && itemsPending == 0 }

    // MARK: - Sending

    func send() {
        guard canSend || isRetry else { return }
        Haptic.impact(.medium)
        sendTask = Task { await run() }
    }

    private var isRetry: Bool {
        if case .failed = sending { return true }
        return false
    }

    func retry() {
        send()
    }

    /// Leaves out the one that failed and carries on with the rest.
    func skip(_ id: UUID) {
        skipped.insert(id)
        if let upload = prepared.removeValue(forKey: id) { discard(upload) }
        send()
    }

    /// For each attachment, for each chosen conversation — so every chat gets
    /// them in the order they were shared, and each file is made ready once.
    /// The caption goes with the first one a conversation receives; with no
    /// attachments (or none it could take) it is sent as a message of its own.
    private func run() async {
        guard let api else { return }
        let targets = selectedConversations
        let items = sendableItems
        let caption = trimmedMessage
        let key = { (item: ShareItem, target: ShareConversation) in "\(item.id)|\(target.slug)" }

        let fileUnits = items.reduce(0) { sum, item in sum + targets.filter { !delivered.contains(key(item, $0)) }.count }
        let textUnits = caption.isEmpty ? 0 : targets.filter { target in
            !captioned.contains(target.slug) && !items.contains { !delivered.contains(key($0, target)) }
        }.count
        let total = doneCount + fileUnits + textUnits
        var current: ShareItem?

        do {
            for item in items {
                let waiting = targets.filter { !delivered.contains(key(item, $0)) }
                guard !waiting.isEmpty else { continue }
                current = item
                sending = .working(step: doneCount + 1, total: total, detail: item.name, fraction: nil)
                let upload: ShareUpload
                if let ready = prepared[item.id] {
                    upload = ready
                } else {
                    upload = try await ShareConverter.prepare(item) { [weak self] status in
                        Task { @MainActor in
                            guard let self, case .working(let step, let total, _, _) = self.sending else { return }
                            self.sending = .working(step: step, total: total, detail: status, fraction: nil)
                        }
                    }
                    prepared[item.id] = upload
                }

                for target in waiting {
                    let withCaption = captioned.contains(target.slug) ? nil : caption
                    let step = doneCount + 1
                    let detail = L("To %@", target.title)
                    sending = .working(step: step, total: total, detail: detail, fraction: 0)
                    try await api.sendFile(conversation: target.slug, caption: withCaption, upload: upload) { fraction in
                        Task { @MainActor [weak self] in
                            guard let self, case .working(let now, _, _, _) = self.sending, now == step else { return }
                            self.sending = .working(step: step, total: total, detail: detail, fraction: fraction)
                        }
                    }
                    delivered.insert(key(item, target))
                    if withCaption?.isEmpty == false { captioned.insert(target.slug) }
                    doneCount += 1
                }
                if let ready = prepared.removeValue(forKey: item.id) { discard(ready) }
            }
            current = nil

            if !caption.isEmpty {
                for target in targets where !captioned.contains(target.slug) {
                    sending = .working(step: doneCount + 1, total: total, detail: L("To %@", target.title), fraction: nil)
                    try await api.sendText(conversation: target.slug, body: caption)
                    captioned.insert(target.slug)
                    doneCount += 1
                }
            }

            Haptic.success()
            withNeonAnimation(NeonMotion.bouncy) { sending = .done }
            try? await Task.sleep(nanoseconds: 900_000_000)
            // Cancel pressed while "Sent" was showing has already closed it.
            guard !Task.isCancelled else { return }
            finish()
        } catch is CancellationError {
            return
        } catch {
            if Task.isCancelled { return }
            Haptic.error()
            let aboutItem = (error as? ShareError)?.isAboutTheItem == true
            // Only one of several can be left out; a lone one is simply Cancel.
            let skippable = aboutItem && sendableItems.count + (caption.isEmpty ? 0 : 1) > 1 ? current?.id : nil
            var message = error.localizedDescription
            if let current, aboutItem, case .refused = error as? ShareError {
                message = "\(current.name): \(message)"
            }
            withNeonAnimation(NeonMotion.snappy) { sending = .failed(message: message, skippable: skippable) }
        }
    }

    private func discard(_ upload: ShareUpload) {
        // Only what was made for sending; the shared file itself stays until the end.
        guard upload.file.lastPathComponent.hasPrefix("send-") else { return }
        try? FileManager.default.removeItem(at: upload.file)
    }

    // MARK: - Leaving

    func cancel() {
        sendTask?.cancel()
        ShareInbox.clear()
        context?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
    }

    private func finish() {
        ShareInbox.clear()
        context?.completeRequest(returningItems: nil)
    }
}
