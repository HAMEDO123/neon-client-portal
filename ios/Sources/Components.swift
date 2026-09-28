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
struct DirText: View {
    let text: String
    var font: Font = .body
    var color: Color = .neonInk
    var fill = true

    init(_ text: String, font: Font = .body, color: Color = .neonInk, fill: Bool = true) {
        self.text = text
        self.font = font
        self.color = color
        self.fill = fill
    }

    var body: some View {
        let direction = naturalDirection(text) ?? AppLanguage.current.layoutDirection
        Text(verbatim: text)
            .font(font)
            .foregroundStyle(color)
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
        HStack(spacing: 8) {
            Image(systemName: "wifi.slash")
            Text(L("Offline — showing what the server said at %@", savedAt.formatted(
                Date.FormatStyle(date: .abbreviated, time: .shortened, locale: AppLanguage.current.locale)
            )))
        }
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(Color.neonOrangeStrong)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.neonOrange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct ErrorState: View {
    let message: String
    let retry: () async -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 26))
                .foregroundStyle(Color.neonInk.opacity(0.35))
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Color.neonInk.opacity(0.6))
                .multilineTextAlignment(.center)
            Button(L("Retry")) { Task { await retry() } }
                .buttonStyle(.borderedProminent)
                .tint(.neonInk)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .padding(.horizontal, 24)
    }
}

struct EmptyState: View {
    let symbol: String
    let title: String
    var detail: String?

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 28))
                .foregroundStyle(Color.neonInk.opacity(0.25))
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.neonInk.opacity(0.65))
                .multilineTextAlignment(.center)
            if let detail {
                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.neonInk.opacity(0.45))
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
        .padding(.horizontal, 24)
    }
}

struct SectionLabel: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(Color.neonInk.opacity(0.4))
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct SkeletonRows: View {
    var count = 4
    @State private var pulse = false

    var body: some View {
        VStack(spacing: 10) {
            ForEach(0..<count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.neonInk.opacity(pulse ? 0.05 : 0.09))
                    .frame(height: 72)
            }
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulse = true }
        }
    }
}

struct AvatarView: View {
    let url: URL?
    let name: String
    var size: CGFloat = 44

    var body: some View {
        AsyncImage(url: url) { phase in
            if let image = phase.image {
                image.resizable().scaledToFill()
            } else {
                ZStack {
                    Color.neonPurple.opacity(0.14)
                    Text(String(name.prefix(1)).uppercased())
                        .font(.system(size: size * 0.42, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color.neonPurpleStrong)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
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
            Image(systemName: "person.crop.circle")
                .font(.system(size: 19))
                .foregroundStyle(Color.neonInk.opacity(0.7))
        }
        .confirmationDialog(L("Sign out of NEON?"), isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button(L("Sign Out"), role: .destructive) { api.logout() }
            Button(L("Cancel"), role: .cancel) {}
        }
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
