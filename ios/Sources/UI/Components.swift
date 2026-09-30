import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// MARK: - Text from the server, in its own direction

/// The direction a piece of text reads in, from its first strong letter — what
/// `dir="auto"` does on the web. Most of the team writes Arabic, so a message
/// is laid out by what it says, not by the language the app is set to.
func naturalDirection(_ text: String) -> LayoutDirection? {
    for scalar in text.unicodeScalars {
        switch scalar.value {
        case 0x0590...0x08FF, 0xFB1D...0xFDFF, 0xFE70...0xFEFF:
            return .rightToLeft
        default:
            if scalar.properties.isAlphabetic { return .leftToRight }
        }
    }
    return nil
}

/// Text that came from somebody, aligned the way it is written.
/// `fill: false` keeps it at the row's leading edge (lists, chips) while still
/// shaping it in its own direction.
struct DirText: View {
    let text: String
    var font: Font = .body
    var color: Color = .neonInk
    var fill = true
    var lineLimit: Int?

    init(_ text: String, font: Font = .body, color: Color = .neonInk, fill: Bool = true, lineLimit: Int? = nil) {
        self.text = text
        self.font = font
        self.color = color
        self.fill = fill
        self.lineLimit = lineLimit
    }

    var body: some View {
        let direction = naturalDirection(text) ?? AppLanguage.current.layoutDirection
        Text(verbatim: text)
            .font(font)
            .foregroundStyle(color)
            .lineLimit(lineLimit)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: fill ? .infinity : nil, alignment: .leading)
            .environment(\.layoutDirection, direction)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - States every screen shares

/// Shown whenever a screen is drawing a saved copy because the server could
/// not be reached — so a cache is never mistaken for the studio's current word.
struct OfflineBanner: View {
    let savedAt: Date

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(Circle().fill(Color.neonOrange))
            Text(L("Offline — showing what the server said at %@", savedAt.formatted(
                Date.FormatStyle(date: .abbreviated, time: .shortened, locale: AppLanguage.current.locale)
            )))
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Color.neonOrangeStrong)
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .neonSurface(.tinted(.neonOrange), radius: 14)
        .transition(.neonRise)
        .accessibilityElement(children: .combine)
    }
}

/// A read that failed: the server's own sentence, and a way to try again.
struct ErrorState: View {
    let message: String
    let retry: () async -> Void

    var body: some View {
        VStack(spacing: 14) {
            IconTile("exclamationmark.triangle.fill", hue: .orange, size: 60)
            VStack(spacing: 6) {
                Text(L("Couldn't load this"))
                    .font(.neonCardTitle)
                    .foregroundStyle(Color.neonInk)
                Text(message)
                    .font(.neonLabel)
                    .foregroundStyle(Color.neonTextSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            NeonButton(L("Retry"), symbol: "arrow.clockwise", kind: .secondary, size: .medium) {
                await retry()
            }
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .padding(.horizontal, 24)
        .neonAppear()
    }
}

/// Nothing to show — said plainly, on a pastel tile whose symbol breathes so
/// the screen doesn't read as frozen. An optional action offers the obvious
/// next step. `card: true` sets it on a white card of its own, for a page
/// whose other blocks are cards.
struct EmptyState: View {
    let symbol: String
    let title: String
    var detail: String?
    var actionTitle: String?
    var action: (() -> Void)?
    var hue: NeonHue = .indigo
    var card = false

    var body: some View {
        let stack = VStack(spacing: 10) {
            IconTile(symbol, hue: hue, size: 64)
                .neonFloat()
                .padding(.bottom, 6)
            Text(title)
                .font(.neonCardTitle)
                .foregroundStyle(Color.neonInk)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let detail {
                Text(detail)
                    .font(.neonLabel)
                    .foregroundStyle(Color.neonTextSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let actionTitle, let action {
                NeonButton(actionTitle, kind: .tinted(hue.deep), size: .medium) { action() }
                    .padding(.top, 8)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, card ? 28 : 36)
        .padding(.horizontal, 24)

        Group {
            if card {
                stack.neonSurface(.glass, radius: NeonRadius.lg)
            } else {
                stack
            }
        }
        .neonAppear()
    }
}

/// The small uppercase heading above a block of a screen.
struct SectionLabel: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .semibold))
            .tracking(0.7)
            .foregroundStyle(Color.neonInk.opacity(0.42))
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

/// The standard loading placeholder: row cards shaped like `ListCardRow`s,
/// shimmering.
struct SkeletonRows: View {
    var count = 4

    var body: some View {
        VStack(spacing: NeonSpace.sm) {
            ForEach(0..<count, id: \.self) { index in
                HStack(spacing: 12) {
                    Circle()
                        .fill(Color.neonInk.opacity(0.07))
                        .frame(width: 46, height: 46)
                    // Capped rather than fixed widths, so a narrow phone never overflows.
                    VStack(alignment: .leading, spacing: 9) {
                        SkeletonBlock(height: 13).frame(maxWidth: index.isMultiple(of: 2) ? 150 : 115)
                        SkeletonBlock(height: 10).frame(maxWidth: index.isMultiple(of: 2) ? 200 : 165)
                    }
                    Spacer(minLength: 0)
                    SkeletonBlock(width: 42, height: 10)
                }
                .padding(.horizontal, 14)
                .frame(height: 74)
                .neonSurface(.glass, radius: NeonRadius.lg)
            }
        }
        .shimmer()
        .accessibilityLabel(L("Loading"))
    }
}

/// A `SectionCard` still loading: its heading and a few lines.
struct SkeletonCard: View {
    var lines = 3

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                SkeletonBlock(width: NeonSize.iconTileLarge, height: NeonSize.iconTileLarge, radius: NeonRadius.tile(NeonSize.iconTileLarge))
                VStack(alignment: .leading, spacing: 8) {
                    SkeletonBlock(height: 14).frame(maxWidth: 140)
                    SkeletonBlock(height: 10).frame(maxWidth: 190)
                }
                Spacer(minLength: 0)
                SkeletonBlock(width: 78, height: 30, radius: 15)
            }
            ForEach(0..<max(lines, 0), id: \.self) { index in
                SkeletonBlock(width: nil, height: 12)
                    .padding(.trailing, CGFloat(index % 3) * 40)
            }
        }
        .padding(NeonSpace.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .shimmer()
        .accessibilityLabel(L("Loading"))
    }
}

/// A `KPICard` still loading.
struct SkeletonKPICard: View {
    var compact = false

    var body: some View {
        let tile: CGFloat = compact ? 32 : NeonSize.iconTileLarge
        VStack(alignment: .leading, spacing: compact ? 10 : 12) {
            SkeletonBlock(width: tile, height: tile, radius: NeonRadius.tile(tile))
            SkeletonBlock(width: compact ? 26 : 44, height: compact ? 22 : 28, radius: 8)
            SkeletonBlock(width: compact ? 56 : 104, height: 11)
            SkeletonBlock(width: compact ? 44 : 84, height: 9)
            Spacer(minLength: 0)
            HStack(alignment: .bottom, spacing: 4) {
                ForEach(0..<6, id: \.self) { index in
                    SkeletonBlock(width: nil, height: CGFloat(8 + index * 4), radius: 3)
                        .frame(maxWidth: compact ? 8 : 12)
                }
            }
        }
        .padding(compact ? 12 : NeonSpace.card)
        .frame(maxWidth: .infinity, minHeight: compact ? 150 : 170, alignment: .topLeading)
        .neonSurface(.glass, radius: compact ? NeonRadius.md + 2 : NeonRadius.lg)
        .shimmer()
        .accessibilityLabel(L("Loading"))
    }
}

/// How an avatar without a photo is drawn.
enum AvatarStyle {
    /// Initials in the person's colour on a pastel disc — quiet, for dense lists.
    case soft
    /// White initials on the person's colour, solid — the chat list's avatars.
    case solid
}

/// Somebody's picture, or their initials on a colour that is theirs.
struct AvatarView: View {
    let url: URL?
    let name: String
    var size: CGFloat = 44
    /// A white ring, for avatars sitting on photos or overlapping in a stack.
    var ring = false
    /// A green dot: here right now.
    var online = false
    var style: AvatarStyle = .soft

    var body: some View {
        let hue = NeonPalette.hue(for: name)
        ZStack {
            switch style {
            case .soft:
                LinearGradient(colors: [hue.wash, hue.pastel], startPoint: .topLeading, endPoint: .bottomTrailing)
            case .solid:
                LinearGradient(colors: [hue.color, hue.deep], startPoint: .topLeading, endPoint: .bottomTrailing)
            }
            Text(Self.initials(name, size: size))
                .font(.system(size: size * 0.4, weight: .bold))
                .foregroundStyle(style == .solid ? Color.white : hue.deep)
            // Laid over the initials rather than instead of them: the circle
            // is right from the first paint, and a photo that never loads
            // leaves the initials. The server's own initials picture
            // (`/api/avatar`) is not a photo — those are drawn right here.
            if let url, url.path != "/api/avatar" {
                PipelineImage(url: url, points: size)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay {
            if ring { Circle().strokeBorder(Color.white, lineWidth: max(1.5, size * 0.05)) }
        }
        .overlay(alignment: .bottomTrailing) {
            if online {
                OnlineDot(size: max(10, size * 0.27))
                    .offset(x: size * 0.02, y: size * 0.02)
            }
        }
        .accessibilityLabel(Text(verbatim: name))
    }

    /// Two initials for a Latin name; one letter for an Arabic one, whose
    /// letters would otherwise join into a word that isn't one.
    static func initials(_ name: String, size: CGFloat = 44) -> String {
        let words = name.split(whereSeparator: { $0.isWhitespace })
        guard let first = words.first?.first else { return "·" }
        if naturalDirection(name) == .rightToLeft || size < 30 || words.count < 2 {
            return String(first).uppercased()
        }
        let second = words[1].first.map(String.init) ?? ""
        return (String(first) + second).uppercased()
    }
}

// MARK: - Who is signed in

/// The toolbar menu every signed-in screen carries: who this is, the language,
/// and signing out.
struct AccountMenu: View {
    @EnvironmentObject var api: APIClient
    @State private var confirmSignOut = false

    var body: some View {
        Menu {
            if let identity = api.identity {
                Section(identity.side == .admin ? L("Manager") : identity.name) {}
            }
            Button {
                Haptic.tap()
                AppLanguage.toggle()
            } label: {
                Label(AppLanguage.current == .arabic ? "English" : "العربية", systemImage: "globe")
            }
            Button(role: .destructive) {
                confirmSignOut = true
            } label: {
                Label(L("Sign Out"), systemImage: "rectangle.portrait.and.arrow.right")
            }
        } label: {
            AvatarView(url: facePhotoURL(api.myPhoto), name: accountName, size: 30, ring: true)
                .neonShadow(.low)
                .accessibilityLabel(L("Account"))
        }
        .confirmationDialog(L("Sign out of NEON?"), isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button(L("Sign Out"), role: .destructive) { api.logout() }
            Button(L("Cancel"), role: .cancel) {}
        }
    }

    /// Their own initials for somebody on the team; the studio's "N" for the manager.
    private var accountName: String {
        guard let identity = api.identity, identity.side == .employee, !identity.name.isEmpty else { return "NEON" }
        return identity.name
    }
}

// MARK: - Picking something to send

/// Turns what the person picked into an upload: photos are shrunk to the size
/// the server keeps anyway (it fits images within 2400px), so a site photo
/// taken on a slow connection is not sent at twelve megapixels.
enum UploadMaker {
    static func photo(_ image: UIImage, name: String = "photo.jpg") -> UploadFile? {
        let scaled = image.scaledDown(maxDimension: 2400)
        guard let data = scaled.jpegData(compressionQuality: 0.82) else { return nil }
        return UploadFile(field: "photo", filename: name, mimeType: "image/jpeg", data: data)
    }

    static func photo(_ item: PhotosPickerItem) async -> UploadFile? {
        guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else { return nil }
        return photo(image)
    }

    /// A file from the Files app. Security-scoped: it has to be opened inside
    /// the access window, so it is read into memory there and then.
    static func file(_ url: URL, field: String) -> UploadFile? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return nil }
        let type = UTType(filenameExtension: url.pathExtension)
        let mime = type?.preferredMIMEType ?? "application/octet-stream"
        // An image picked from Files goes up as a photo, so it is shown as one.
        if type?.conforms(to: .image) == true, let image = UIImage(data: data),
           let jpeg = photo(image, name: url.deletingPathExtension().lastPathComponent + ".jpg") {
            return jpeg
        }
        return UploadFile(field: field, filename: url.lastPathComponent, mimeType: mime, data: data)
    }

    /// What the server stores: "PDF, DOCX, XLSX, ZIP, MP4, DWG, or image (max 50MB)".
    static let documentTypes: [UTType] = {
        var types: [UTType] = [.pdf, .image, .spreadsheet, .zip, .movie, .presentation, .plainText]
        for ext in ["docx", "doc", "xlsx", "xls", "dwg", "dxf", "skp"] {
            if let type = UTType(filenameExtension: ext) { types.append(type) }
        }
        return types
    }()
}

extension UIImage {
    func scaledDown(maxDimension: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxDimension else { return self }
        let ratio = maxDimension / longest
        let target = CGSize(width: (size.width * ratio).rounded(), height: (size.height * ratio).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
    }
}

/// The camera, for a photo taken there and then. Not offered where there is
/// no camera (the simulator), rather than offered and failing.
struct CameraPicker: UIViewControllerRepresentable {
    let onPick: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    static var isAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onPick(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

func byteCount(_ bytes: Int) -> String {
    ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
}
