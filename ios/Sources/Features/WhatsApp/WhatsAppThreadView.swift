import SwiftUI
import Foundation

/// One WhatsApp conversation — reads and polls `whatsapp/messages` the way
/// the portal's `Thread` component does, with its two rules kept exactly:
/// opening a chat never marks anything read on the phone (the worker is never
/// told to), and a message this sends shows "Sending" until the account's own
/// history hands it back, rather than trusting the send itself.
struct WhatsAppThreadView: View {
    let chat: WhatsAppChat
    let timeZone: String

    @EnvironmentObject var api: APIClient
    @State private var messages: [WhatsAppMessage]?
    @State private var errorMessage: String?
    @State private var pending: [PendingMessage] = []
    @State private var draft = ""
    @State private var sending = false
    @State private var sendError: String?
    /// The visible height of the conversation, to keep the newest in view
    /// when the keyboard rises or the box grows a line.
    @State private var viewport: CGFloat = 0

    private struct PendingMessage: Identifiable {
        let id = UUID()
        let text: String
        let at: Date
    }

    /// The website's own limit on one reply (whatsapp-inbox.ts REPLY_MAX_LENGTH).
    private let maxLength = 4000

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { reader in
                ScrollView {
                    LazyVStack(spacing: 6) {
                        if let messages {
                            if messages.isEmpty && pending.isEmpty {
                                EmptyState(symbol: "bubble.left", title: L("Nothing in this chat yet."))
                                    .padding(.top, 40)
                            }
                            ForEach(Array(messages.enumerated()), id: \.offset) { index, message in
                                let dayKey = whatsAppDayKey(message.timestamp, timeZone: timeZone)
                                let previousDayKey = index > 0 ? whatsAppDayKey(messages[index - 1].timestamp, timeZone: timeZone) : nil
                                if !dayKey.isEmpty, dayKey != previousDayKey {
                                    WhatsAppDayPill(text: whatsAppDayPillLabel(message.timestamp, timeZone: timeZone))
                                }
                                WhatsAppBubble(
                                    message: message,
                                    showAuthor: showsAuthor(at: index, in: messages),
                                    timeZone: timeZone
                                )
                                .id(index)
                            }
                            ForEach(pending) { one in
                                WhatsAppPendingBubble(text: one.text)
                            }
                        } else if let errorMessage {
                            ErrorState(message: errorMessage) { await load() }
                                .padding(.top, 40)
                        } else {
                            VStack(spacing: 10) {
                                ProgressView()
                                Text(L("Reading the conversation…")).font(.neonFootnote).foregroundStyle(Color.neonTextTertiary)
                            }
                            .padding(.top, 60)
                        }
                        Color.clear.frame(height: 2).id("bottom")
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 12)
                }
                .scrollDismissesKeyboard(.interactively)
                // A scroll view keeps its top where it was when it shrinks, so
                // the keyboard rising hid the newest messages: it follows them.
                .modifier(WhatsAppViewportWatch { height in
                    let changed = viewport > 0 && abs(height - viewport) > 1
                    viewport = height
                    guard changed else { return }
                    withAnimation(.easeOut(duration: 0.25)) { reader.scrollTo("bottom", anchor: .bottom) }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { reader.scrollTo("bottom", anchor: .bottom) }
                })
                .onChange(of: (messages?.count ?? 0) + pending.count) { _ in
                    withAnimation(.easeOut(duration: 0.2)) { reader.scrollTo("bottom", anchor: .bottom) }
                }
                .onAppear { reader.scrollTo("bottom", anchor: .bottom) }
            }

            composer
        }
        .neonAmbientBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    if chat.isGroup {
                        IconTile("person.2.fill", hue: .green, size: 30)
                    } else {
                        AvatarView(url: nil, name: chat.displayName, size: 30)
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        Text(chat.displayName).font(.neonSubheadline.weight(.semibold)).lineLimit(1)
                        Text(chat.isGroup ? L("Group") : (chat.number ?? ""))
                            .font(.neonCaption)
                            .foregroundStyle(Color.neonInk.opacity(0.5))
                    }
                }
            }
        }
        .task { await poll() }
    }

    // MARK: Composer

    private var composer: some View {
        VStack(spacing: 6) {
            if chat.isGroup {
                StatusNote(
                    symbol: "lock.fill",
                    tone: .info,
                    title: L("Groups are read-only here — reply from the phone.")
                )
                .padding(.horizontal, NeonSpace.gutter)
                .padding(.vertical, NeonSpace.sm)
            } else {
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
                    TextField(L("Write a message"), text: $draft, axis: .vertical)
                        .lineLimit(1...5)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.neonInk.opacity(0.1)))
                        .environment(\.layoutDirection, naturalDirection(draft) ?? AppLanguage.current.layoutDirection)

                    Button {
                        Task { await send() }
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
                        .background(canSend ? Color.neonSuccessStrong : Color.neonInk.opacity(0.2), in: Circle())
                    }
                    .disabled(!canSend)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
            }
        }
        .background(.ultraThinMaterial)
    }

    private var canSend: Bool {
        !sending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: Layout

    /// The first message of a run from one group member wears their label;
    /// the rest of the run doesn't repeat it — the same "grouped by author"
    /// shape `ChatMessageRow` draws for the studio's own group rooms.
    private func showsAuthor(at index: Int, in messages: [WhatsAppMessage]) -> Bool {
        guard chat.isGroup, !messages[index].fromMe else { return false }
        guard index > 0 else { return true }
        let previous = messages[index - 1]
        return previous.fromMe || previous.author != messages[index].author
    }

    // MARK: Reading

    private func poll() async {
        await load()
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 10 * 1_000_000_000)
            if Task.isCancelled { break }
            await load()
        }
    }

    private func load() async {
        do {
            let loaded = try await api.fetchWhatsAppThread(chatId: chat.id)
            messages = loaded.value.messages
            pending = reconcile(pending, against: loaded.value.messages)
            errorMessage = nil
        } catch {
            if messages == nil { errorMessage = error.localizedDescription }
        }
    }

    // MARK: Sending

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if text.count > maxLength {
            sendError = L("That is longer than %d characters.", maxLength)
            return
        }
        sending = true
        sendError = nil
        defer { sending = false }
        do {
            try await api.sendWhatsAppReply(chatId: chat.id, text: text)
            draft = ""
            pending.append(PendingMessage(text: text, at: Date()))
            Haptic.tap()
            // Look again shortly, so a message the account releases quickly
            // shows as itself instead of sitting on "Sending" for a full poll.
            try? await Task.sleep(nanoseconds: 3 * 1_000_000_000)
            await load()
        } catch APIError.unauthorized {
        } catch {
            sendError = error.localizedDescription
            Haptic.error()
        }
    }

    /// `stillWaiting` in the web's inbox, ported: a message queued here is
    /// still waiting until the account's own history hands back a message
    /// with the same words, sent from around the same time.
    private func reconcile(_ waiting: [PendingMessage], against arrived: [WhatsAppMessage]) -> [PendingMessage] {
        guard !waiting.isEmpty else { return waiting }

        var seen: [String: Int] = [:]
        for message in arrived where message.fromMe {
            let body = message.body.trimmingCharacters(in: .whitespacesAndNewlines)
            seen[body, default: 0] += 1
        }

        var left: [PendingMessage] = []
        for one in waiting {
            let available = seen[one.text] ?? 0
            let recent = arrived.contains {
                $0.fromMe
                    && $0.body.trimmingCharacters(in: .whitespacesAndNewlines) == one.text
                    && ($0.timestamp ?? 0) >= (one.at.timeIntervalSince1970 - 120) * 1000
            }
            if available > 0 && recent {
                seen[one.text] = available - 1
            } else {
                left.append(one)
            }
        }
        return left
    }
}

// MARK: - Bubbles

private struct WhatsAppBubble: View {
    let message: WhatsAppMessage
    let showAuthor: Bool
    let timeZone: String

    var body: some View {
        HStack {
            if message.fromMe { Spacer(minLength: 44) }

            VStack(alignment: .leading, spacing: 4) {
                if showAuthor {
                    Text(whatsAppGroupAuthorLabel(message.author))
                        .font(.neonCaption.weight(.semibold))
                        .foregroundStyle(NeonPalette.color(for: message.author ?? message.id ?? ""))
                }

                if message.hasMedia, let id = message.id {
                    if message.type == "image" || message.type == "sticker" {
                        WhatsAppMediaImage(messageId: id)
                            .frame(width: 200, height: 200)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    } else if message.type == "ptt" || message.type == "audio" {
                        // Played here: the server hands it over as AAC an iPhone plays.
                        WhatsAppVoiceNoteView(messageId: id, mine: message.fromMe)
                    } else {
                        WhatsAppAttachmentRow(message: message, mine: message.fromMe)
                    }
                }

                if !message.body.isEmpty, !bodyIsAttachmentTitle {
                    WhatsAppMessageText(text: message.body, color: message.fromMe ? .white : .neonInk)
                } else if message.body.isEmpty, !message.hasMedia {
                    Text(whatsAppKindLabel(message.type))
                        .italic()
                        .font(.neonSubheadline)
                        .foregroundStyle(message.fromMe ? Color.white.opacity(0.7) : Color.neonInk.opacity(0.6))
                }

                let time = whatsAppBubbleClockLabel(message.timestamp, timeZone: timeZone)
                if !time.isEmpty {
                    Text(time)
                        .font(.neonMeta)
                        .foregroundStyle(message.fromMe ? Color.white.opacity(0.7) : Color.neonInk.opacity(0.4))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                message.fromMe ? AnyShapeStyle(Color.neonSuccessStrong) : AnyShapeStyle(Color.white),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(message.fromMe ? Color.clear : Color.neonInk.opacity(0.07))
            )
            .frame(maxWidth: 300, alignment: .leading)

            if !message.fromMe { Spacer(minLength: 44) }
        }
    }

    /// A document's own filename becomes the attachment row's title (see
    /// `WhatsAppAttachmentRow`) — it must not also print again underneath
    /// as a second, unlabelled line of plain body text.
    private var bodyIsAttachmentTitle: Bool {
        message.hasMedia && message.type == "document" && !message.body.isEmpty
    }
}

/// The centred capsule between two days' worth of bubbles, in place of every
/// bubble carrying its own full date.
private struct WhatsAppDayPill: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.neonCaption)
            .foregroundStyle(Color.neonTextSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(Capsule().fill(Color.white.opacity(0.85)))
            .neonShadow(.low)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
    }
}

/// A message's own words, in the kit's body type rather than a hand-picked
/// point size, with a plain http(s) link picked out and made tappable —
/// where `DirText` only ever draws plain, unlinked text.
private struct WhatsAppMessageText: View {
    let text: String
    let color: Color

    var body: some View {
        let direction = naturalDirection(text) ?? AppLanguage.current.layoutDirection
        Text(attributed)
            .font(.neonBody)
            .tint(.neonAccent)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .environment(\.layoutDirection, direction)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var attributed: AttributedString {
        var result = AttributedString(text)
        result.foregroundColor = color
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return result }
        let full = NSRange(text.startIndex..., in: text)
        for match in detector.matches(in: text, range: full) {
            guard
                let url = match.url,
                let stringRange = Range(match.range, in: text),
                let lower = AttributedString.Index(stringRange.lowerBound, within: result),
                let upper = AttributedString.Index(stringRange.upperBound, within: result)
            else { continue }
            result[lower..<upper].link = url
            result[lower..<upper].foregroundColor = .neonAccent
            result[lower..<upper].underlineStyle = .single
        }
        return result
    }
}

private struct WhatsAppPendingBubble: View {
    let text: String

    var body: some View {
        HStack {
            Spacer(minLength: 44)
            VStack(alignment: .trailing, spacing: 4) {
                DirText(text, font: .neonBody, color: .white, fill: false)
                HStack(spacing: 4) {
                    ProgressView().scaleEffect(0.6).tint(.white)
                    Text(L("Sending…")).font(.neonMeta).foregroundStyle(.white.opacity(0.85))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.neonSuccessStrong.opacity(0.55), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .frame(maxWidth: 300, alignment: .trailing)
        }
    }
}

private struct WhatsAppViewportKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

/// The visible height of the thread's scroll view as it changes: from the
/// scroll view itself on iOS 18 and later, measured on older systems.
private struct WhatsAppViewportWatch: ViewModifier {
    let changed: (CGFloat) -> Void

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content
                // The system keeps the newest in view through a change of
                // size (the keyboard, a photo arriving at its full height),
                // frame by frame; the scroll below catches what a lazy list
                // corrects a moment later.
                .defaultScrollAnchor(.bottom, for: .sizeChanges)
                .onScrollGeometryChange(for: CGFloat.self) { $0.containerSize.height } action: { _, height in
                    changed(height)
                }
        } else {
            content
                .background(
                    GeometryReader { geo in
                        Color.clear.preference(key: WhatsAppViewportKey.self, value: geo.size.height)
                    }
                )
                .onPreferenceChange(WhatsAppViewportKey.self) { changed($0) }
        }
    }
}
