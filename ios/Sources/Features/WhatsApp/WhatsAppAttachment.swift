import SwiftUI
import UIKit

// A WhatsApp attachment that isn't a photo — a voice note, a document, a
// video, a contact card. There is no in-app player or viewer for these (that
// would be a web view's job in spirit, if not in code), so the row downloads
// the bytes with the app's own bearer token — the same guard the picture
// uses — into a file, and hands it to the system's own share sheet, which
// offers Quick Look, Save to Files, and "Open in…". That is opening a stored
// file in the system, which ARCHITECTURE.md allows; nothing here is a browser.

private struct FileToShare: Identifiable {
    let id = UUID()
    let url: URL
}

struct WhatsAppAttachmentRow: View {
    let message: WhatsAppMessage
    var mine: Bool

    @EnvironmentObject var api: APIClient
    @State private var downloading = false
    @State private var toShare: FileToShare?
    @State private var errorMessage: String?

    var body: some View {
        Button {
            Haptic.tap()
            Task { await download() }
        } label: {
            HStack(spacing: 10) {
                if downloading {
                    ProgressView().tint(mine ? .white : .neonPurpleStrong)
                        .frame(width: 22)
                } else {
                    Image(systemName: whatsAppSymbol(for: message.type))
                        .font(.system(size: 18))
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(whatsAppKindLabel(message.type))
                        .font(.system(size: 13, weight: .semibold))
                    Text(downloading ? L("Downloading…") : L("Tap to open"))
                        .font(.system(size: 11))
                        .opacity(0.7)
                }
            }
            .foregroundStyle(mine ? Color.white : Color.neonInk)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(mine ? Color.white.opacity(0.15) : Color.neonInk.opacity(0.05), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.pressable)
        .disabled(downloading || message.id == nil)
        .sheet(item: $toShare) { file in
            WhatsAppShareSheet(url: file.url)
        }
        .alert(L("Couldn't open that"), isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button(L("OK"), role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func download() async {
        guard let id = message.id, let token = api.token else { return }
        guard
            let url = URL(
                string: "api/mobile/whatsapp/media/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)",
                relativeTo: portalOrigin
            )
        else { return }

        downloading = true
        defer { downloading = false }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                errorMessage = L("The attachment could not be read.")
                return
            }
            let suggestedName = filename(from: http) ?? "attachment"
            let destination = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent(suggestedName)
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: destination)
            toShare = FileToShare(url: destination)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func filename(from response: HTTPURLResponse) -> String? {
        guard let header = response.value(forHTTPHeaderField: "content-disposition") else { return nil }
        // filename*=UTF-8''<encoded>, else filename="<name>" — see the route's own comment.
        if let range = header.range(of: "filename\\*=UTF-8''", options: .regularExpression) {
            let raw = header[range.upperBound...]
            return raw.removingPercentEncoding ?? String(raw)
        }
        if let range = header.range(of: "filename=\"") {
            let rest = header[range.upperBound...]
            if let end = rest.firstIndex(of: "\"") { return String(rest[..<end]) }
        }
        return nil
    }
}

private struct WhatsAppShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
