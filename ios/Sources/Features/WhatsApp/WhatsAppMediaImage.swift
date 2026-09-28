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

struct WhatsAppMediaImage: View {
    let messageId: String

    @EnvironmentObject var api: APIClient
    @State private var data: Data?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let data, let uiImage = UIImage(data: data) {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .transition(.opacity)
            } else if failed {
                Color.neonInk.opacity(0.05)
                    .overlay {
                        Image(systemName: "photo")
                            .font(.system(size: 22))
                            .foregroundStyle(Color.neonTextTertiary)
                    }
            } else {
                Color.neonInk.opacity(0.05).shimmer()
                    .task { await load() }
            }
        }
        .animation(NeonMotion.gentle, value: data)
    }

    private func load() async {
        if let cached = await WhatsAppMediaCache.shared.read(messageId) {
            data = cached
            return
        }
        guard let token = api.token,
              let url = URL(string: "api/mobile/whatsapp/media/\(messageId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? messageId)", relativeTo: portalOrigin)
        else {
            failed = true
            return
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        do {
            let (bytes, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                failed = true
                return
            }
            await WhatsAppMediaCache.shared.write(messageId, bytes)
            data = bytes
        } catch {
            failed = true
        }
    }
}
