import SwiftUI

/// One conversation. Messages oldest at the top, the box to write in pinned
/// above the keyboard.
struct ChatRoomView: View {
    let conversation: ConversationSummary

    @EnvironmentObject private var api: APIClient
    @State private var messages: [ChatMessage] = []
    @State private var draft = ""
    @State private var loading = true
    @State private var sending = false
    @State private var failed = false

    var body: some View {
        VStack(spacing: 0) {
            if loading && messages.isEmpty {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                thread
            }
            composer
        }
        .neonAmbientBackground()
        .navigationTitle(conversation.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var thread: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 8) {
                    if failed && messages.isEmpty {
                        Text(L("Couldn't load this conversation."))
                            .foregroundStyle(Color.neonInk.opacity(0.6))
                            .padding(.top, 40)
                    }

                    ForEach(messages) { message in
                        if message.isSystemLine {
                            SystemLine(text: message.body ?? "")
                        } else {
                            Bubble(
                                message: message,
                                mine: message.mine(api.actor),
                                showAuthor: conversation.isGroup && !message.mine(api.actor)
                            )
                        }
                    }

                    // Something to scroll to that is always the bottom.
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .onChange(of: messages.count) { _ in
                withAnimation { proxy.scrollTo("end", anchor: .bottom) }
            }
            .onAppear { proxy.scrollTo("end", anchor: .bottom) }
        }
    }

    private var composer: some View {
        HStack(spacing: 10) {
            TextField(L("Message"), text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(Color.white.opacity(0.9))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(Color.neonInk.opacity(0.08), lineWidth: 1)
                )

            Button {
                Task { await send() }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(Circle().fill(canSend ? Color.neonPurple : Color.neonInk.opacity(0.22)))
            }
            .disabled(!canSend)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }

    private var canSend: Bool {
        !sending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func load() async {
        failed = false
        do {
            messages = try await api.fetchMessages(conversation: conversation.slug)
        } catch {
            failed = true
        }
        loading = false
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        sending = true
        // Cleared before the request, not after: a message that stays in the
        // box while it sends invites a second tap, and two taps is two
        // messages. Put back only if it genuinely failed.
        draft = ""

        do {
            let sent = try await api.sendMessage(conversation: conversation.slug, body: text)
            messages.append(sent)
            Haptic.tap()
        } catch {
            draft = text
        }
        sending = false
    }
}

private struct Bubble: View {
    let message: ChatMessage
    let mine: Bool
    let showAuthor: Bool

    var body: some View {
        HStack {
            if mine { Spacer(minLength: 50) }

            VStack(alignment: mine ? .trailing : .leading, spacing: 3) {
                // Who spoke, in the group only. In a private chat there are two
                // people and a name above every line is noise.
                if showAuthor {
                    Text(message.authorName)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.neonPurpleStrong)
                }

                if let url = message.attachmentURL, message.kind == "IMAGE" {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Color.neonInk.opacity(0.06)
                    }
                    .frame(maxWidth: 220, maxHeight: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                if let body = message.body, !body.isEmpty {
                    Text(body)
                        .font(.system(size: 15))
                        .foregroundStyle(mine ? .white : Color.neonInk)
                }

                if let sentAt = message.sentAt {
                    Text(sentAt, style: .time)
                        .font(.system(size: 10))
                        .foregroundStyle(mine ? Color.white.opacity(0.7) : Color.neonInk.opacity(0.45))
                }
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(mine ? Color.neonPurple : Color.white.opacity(0.92))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color.neonInk.opacity(mine ? 0 : 0.07), lineWidth: 1)
            )

            if !mine { Spacer(minLength: 50) }
        }
    }
}

/// A call's record, drawn across the conversation rather than as a bubble —
/// nobody said it, so it must not look like somebody did.
private struct SystemLine: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundStyle(Color.neonInk.opacity(0.55))
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(Capsule().fill(Color.neonInk.opacity(0.06)))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
    }
}
