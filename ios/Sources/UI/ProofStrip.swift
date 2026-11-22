import SwiftUI

// What was sent as proof of finished work, drawn the same wherever it is drawn:
// the review queue, a task card in a chat, and the job somebody sent it for.

/// One file of a proof.
struct ProofFile: Codable, Equatable {
    let url: String
    let isImage: Bool
    let label: String
}

extension ProofFile {
    /// From the stored address alone, where the server sends no more than that.
    /// The server's own reading (`isImage` in src/lib/attachments.ts): a file
    /// nothing is known about is a file, never a broken picture.
    init(url: String) {
        let path = url.split(separator: "?").first.map(String.init) ?? url
        let ending = (path as NSString).pathExtension.lowercased()
        self.init(
            url: url,
            isImage: ["jpg", "jpeg", "png", "webp", "gif", "avif"].contains(ending),
            label: ending.isEmpty ? L("File") : ending.uppercased()
        )
    }
}

/// One file, opened by tapping it.
struct ProofTile: View {
    let file: ProofFile
    var size: CGFloat = 72

    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            if let url = resolvedMediaURL(file.url) { openURL(url) }
        } label: {
            Group {
                if file.isImage {
                    RemoteImage(url: resolvedMediaURL(file.url), contentMode: .fill)
                } else {
                    VStack(spacing: 4) {
                        Image(systemName: "doc.fill").foregroundStyle(Color.neonPurpleStrong)
                        Text(verbatim: file.label)
                            .font(.neonCaption)
                            .foregroundStyle(Color.neonTextSecondary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .neonSurface(.sunken, radius: NeonRadius.md)
                }
            }
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(file.isImage ? L("Photo") : file.label)
    }
}

/// Every one of them, side by side, so nothing is approved unseen.
struct ProofStrip: View {
    let files: [ProofFile]
    var size: CGFloat = 72

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: NeonSpace.xs) {
                ForEach(Array(files.enumerated()), id: \.offset) { _, file in
                    ProofTile(file: file, size: size)
                }
            }
        }
    }
}
