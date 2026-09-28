import SwiftUI

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
                                WhatsAppBubble(message: message, showAuthor: chat.isGroup && !message.fromMe, timeZone: timeZone)
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
                                Text(L("Reading the conversation…")).font(.system(size: 12)).foregroundStyle(Color.neonTextTertiary)
                            }
                            .padding(.top, 60)
                        }
                        Color.clear.frame(height: 2).id("bottom")
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 12)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: (messages?.count ?? 0) + pending.count) { _ in
                    withAnimation(.easeOut(duration: 0.2)) { reader.scrollTo("bottom", anchor: .bottom) }
                }
                .onAppear { reader.scrollTo("bottom", anchor: .bottom) }
            }

            composer
        }
        .background(Color.neonBg.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    ZStack {
                        Circle().fill(Color.neonInk.opacity(0.06))
                        Image(systemName: chat.isGroup ? "person.2.fill" : "message.fill")
                            .font(.system(size: 13))
                            .foregroundStyle(Color.neonInk.opacity(0.4))
                    }
                    .frame(width: 30, height: 30)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(chat.displayName).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                        Text(chat.isGroup ? L("Group") : (chat.number ?? ""))
                            .font(.system(size: 11))
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
                Text(L("Reading only in a group. WhatsApp is hard on a linked session that posts into groups, so the studio's number answers people rather than groups."))
                    .font(.system(size: 11))
                    .foregroundStyle(Color.neonTextTertiary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 14)
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
                if showAuthor, let author = message.author {
                    Text(verbatim: author.replacingOccurrences(of: "@.*$", with: "", options: .regularExpression))
                        .font(.system(size: 10, weight: .bold))
                        .textCase(.uppercase)
                        .opacity(0.6)
                }

                if message.hasMedia, let id = message.id {
                    if message.type == "image" || message.type == "sticker" {
                        WhatsAppMediaImage(messageId: id)
                            .frame(width: 200, height: 200)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    } else {
                        WhatsAppAttachmentRow(message: message, mine: message.fromMe)
                    }
                }

                if !message.body.isEmpty {
                    DirText(message.body, font: .system(size: 15), color: message.fromMe ? .white : .neonInk, fill: false)
                } else if !message.hasMedia {
                    Text(whatsAppKindLabel(message.type))
                        .italic()
                        .font(.system(size: 14))
                        .foregroundStyle(message.fromMe ? Color.white.opacity(0.7) : Color.neonInk.opacity(0.6))
                }

                let time = whatsAppTimeLabel(message.timestamp, timeZone: timeZone)
                if !time.isEmpty {
                    Text(time)
                        .font(.system(size: 10))
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
}

private struct WhatsAppPendingBubble: View {
    let text: String

    var body: some View {
        HStack {
            Spacer(minLength: 44)
            VStack(alignment: .trailing, spacing: 4) {
                DirText(text, font: .system(size: 15), color: .white, fill: false)
                HStack(spacing: 4) {
                    ProgressView().scaleEffect(0.6).tint(.white)
                    Text(L("Sending…")).font(.system(size: 10)).foregroundStyle(.white.opacity(0.85))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.neonSuccessStrong.opacity(0.55), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .frame(maxWidth: 300, alignment: .trailing)
        }
    }
}
