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
            IconTile("exclamationmark.triangle.fill", tint: .neonOrangeStrong, size: 56)
            VStack(spacing: 6) {
                Text(L("Couldn't load this"))
                    .font(.neonHeadline)
                    .foregroundStyle(Color.neonInk)
                Text(message)
                    .font(.neonSubheadline)
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
        .padding(.vertical, 36)
        .padding(.horizontal, 24)
        .neonAppear()
    }
}

/// Nothing to show — said plainly, with the symbol breathing so the screen
/// doesn't read as frozen. An optional action offers the obvious next step.
struct EmptyState: View {
    let symbol: String
    let title: String
    var detail: String?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(LinearGradient.neonAmbient)
                    .frame(width: 72, height: 72)
                Circle()
                    .strokeBorder(Color.white.opacity(0.9), lineWidth: 1)
                    .frame(width: 72, height: 72)
                Image(systemName: symbol)
                    .font(.system(size: 28, weight: .regular))
                    .foregroundStyle(Color.neonPurpleStrong.opacity(0.7))
                    .neonFloat()
            }
            .padding(.bottom, 4)
            Text(title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.neonInk.opacity(0.75))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let detail {
                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.neonTextTertiary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let actionTitle, let action {
                NeonButton(actionTitle, kind: .tinted(.neonPurpleStrong), size: .medium) { action() }
                    .padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
        .padding(.horizontal, 24)
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

/// The standard loading placeholder: rows shaped like `ListRow`s, shimmering.
struct SkeletonRows: View {
    var count = 4

    var body: some View {
        VStack(spacing: 10) {
            ForEach(0..<count, id: \.self) { index in
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(Color.neonInk.opacity(0.07))
                        .frame(width: 40, height: 40)
                    VStack(alignment: .leading, spacing: 8) {
                        SkeletonBlock(width: index.isMultiple(of: 2) ? 170 : 130, height: 12)
                        SkeletonBlock(width: index.isMultiple(of: 2) ? 110 : 150, height: 10)
                    }
                    Spacer(minLength: 0)
                    SkeletonBlock(width: 44, height: 18, radius: 9)
                }
                .padding(.horizontal, 14)
                .frame(height: 72)
                .neonSurface(.glass, radius: 16)
            }
        }
        .shimmer()
        .accessibilityLabel(L("Loading"))
    }
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

    var body: some View {
        let accent = NeonPalette.color(for: name)
        ZStack {
            LinearGradient(
                colors: [accent.opacity(0.20), accent.opacity(0.10)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Text(Self.initials(name, size: size))
                .font(.system(size: size * 0.38, weight: .semibold, design: .rounded))
                .foregroundStyle(accent)
            if let url {
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
                Circle()
                    .fill(Color.neonSuccess)
                    .frame(width: size * 0.28, height: size * 0.28)
                    .overlay(Circle().strokeBorder(Color.white, lineWidth: max(1.5, size * 0.05)))
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
            AvatarView(url: nil, name: accountName, size: 30, ring: true)
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
