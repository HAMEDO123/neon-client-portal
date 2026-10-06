import SwiftUI

// A WhatsApp message's photo — fetched only when it is actually on screen,
// the way the web's Attachment does. Unlike everything else the kit's
// RemoteImage loads, this is not a public storage URL: the route behind it,
// /api/mobile/whatsapp/media/<id>, is guarded the same as the rest of the
// studio's WhatsApp, so the request needs the app's own bearer token — which
// plain AsyncImage/RemoteImage cannot attach. Kept small and local to this
// area rather than touching the kit's RemoteImage.

private actor WhatsAppMediaCache {
    static let shared = WhatsAppMediaCache()
    private var images: [String: Data] = [:]

    func read(_ id: String) -> Data? { images[id] }
    func write(_ id: String, _ data: Data) { images[id] = data }
}

/// The route an attachment is fetched from, which also names it (a voice
/// note's identity for the player).
func whatsAppMediaURL(_ messageId: String) -> URL? {
    URL(string: "api/mobile/whatsapp/media/\(messageId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? messageId)", relativeTo: portalOrigin)
}

/// An attachment's bytes, with the app's bearer token, kept in memory once
/// fetched. Nil when it could not be read.
@MainActor
func whatsAppMediaData(_ messageId: String) async -> Data? {
    if let cached = await WhatsAppMediaCache.shared.read(messageId) { return cached }
    guard let token = APIClient.shared.token, let url = whatsAppMediaURL(messageId) else { return nil }
    var request = URLRequest(url: url)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    guard let (bytes, response) = try? await URLSession.shared.data(for: request),
          let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), !bytes.isEmpty
    else { return nil }
    await WhatsAppMediaCache.shared.write(messageId, bytes)
    return bytes
}

struct WhatsAppMediaImage: View {
    let messageId: String

    @State private var data: Data?
    @State private var failed = false
    @State private var attempt = 0

    var body: some View {
        ZStack {
            if let data, let uiImage = UIImage(data: data) {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .transition(.opacity)
            } else if failed {
                // Said, with a way to try again — never a grey box that reads
                // as "still loading".
                Button {
                    Haptic.tap()
                    failed = false
                    attempt += 1
                } label: {
                    Color.neonInk.opacity(0.05)
                        .overlay {
                            VStack(spacing: 6) {
                                Image(systemName: "photo.badge.exclamationmark")
                                    .font(.system(size: 22))
                                Text(L("Couldn't load · tap to retry"))
                                    .font(.neonCaption.weight(.semibold))
                                    .multilineTextAlignment(.center)
                            }
                            .foregroundStyle(Color.neonTextTertiary)
                            .padding(8)
                        }
                }
                .buttonStyle(.plain)
            } else {
                Color.neonInk.opacity(0.05).shimmer()
                    .task(id: attempt) { await load() }
            }
        }
        .animation(NeonMotion.gentle, value: data)
    }

    private func load() async {
        if let bytes = await whatsAppMediaData(messageId) {
            data = bytes
        } else {
            failed = true
        }
    }
}

/// A WhatsApp voice note, played in the thread: fetched on the first tap —
/// never on appear, so forty notes are forty buttons, not forty downloads —
/// and played by the chat's own player (one at a time, 1× · 1.5× · 2×).
struct WhatsAppVoiceNoteView: View {
    let messageId: String
    let mine: Bool

    @ObservedObject private var player = ChatVoicePlayer.shared

    private var url: URL? { whatsAppMediaURL(messageId) }
    private var playing: Bool { url != nil && player.playingURL == url }
    private var loading: Bool { url != nil && player.loadingURL == url }

    var body: some View {
        HStack(spacing: 10) {
            Button {
                guard let url else { return }
                Haptic.tap()
                let id = messageId
                player.toggle(url: url) { await whatsAppMediaData(id) }
            } label: {
                ZStack {
                    Circle().fill(mine ? AnyShapeStyle(Color.white) : AnyShapeStyle(Color.neonSuccessStrong))
                    if loading {
                        ProgressView()
                            .controlSize(.small)
                            .tint(mine ? .neonSuccessStrong : .white)
                    } else {
                        Image(systemName: playing ? "pause.fill" : "play.fill")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(mine ? Color.neonSuccessStrong : Color.white)
                            .offset(x: playing ? 0 : 1.5)
                            .environment(\.layoutDirection, .leftToRight)
                    }
                }
                .frame(width: 38, height: 38)
            }
            .buttonStyle(PressableStyle(scale: 0.88))
            .accessibilityLabel(playing ? L("Pause") : L("Play voice message"))

            VStack(alignment: .leading, spacing: 5) {
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(mine ? Color.white.opacity(0.35) : Color.neonSuccess.opacity(0.22))
                        Capsule()
                            .fill(mine ? Color.white : Color.neonSuccessStrong)
                            .frame(width: max(4, proxy.size.width * (playing ? player.progress : 0)))
                    }
                }
                .frame(width: 140, height: 4)
                .environment(\.layoutDirection, .leftToRight)
                HStack(spacing: 6) {
                    Text(playing ? chatDuration(player.elapsed) : L("Voice note"))
                        .font(.neonMeta)
                        .monospacedDigit()
                        .foregroundStyle(mine ? Color.white.opacity(0.85) : Color.neonTextSecondary)
                    Spacer(minLength: 4)
                    ChatVoiceSpeedPill(rate: player.rate, mine: mine, emphasised: playing || player.rate != 1) {
                        Haptic.selection()
                        player.cycleRate()
                    }
                }
                .frame(width: 140)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("Voice note"))
    }
}
