import AVFoundation
import ImageIO
import QuickLookThumbnailing
import UIKit
import UniformTypeIdentifiers

// What was shared, taken off the host app's hands and made ready to send.
//
// An extension is killed at a small fraction of an app's memory, and a share
// can be ten photos or a few long videos, so nothing is held whole in memory:
// each attachment is asked for as a file (`loadFileRepresentation`), moved
// into this extension's own temporary folder, and read from disk from then on
// — one at a time, both when it arrives and when it is sent.

/// One thing being shared, as a file of our own.
struct ShareItem: Identifiable, Equatable {
    enum Kind: Equatable { case photo, video, file }

    let id = UUID()
    var kind: Kind
    /// Our copy, in `ShareInbox.folder`.
    var url: URL
    /// What it is called where it came from ("IMG_0412.HEIC", "Offer.pdf").
    var name: String
    var bytes: Int64
    var thumbnail: UIImage?
    /// Why it cannot go, when that is known before sending (a type or a size
    /// the server refuses). Shown on it, and it is left out.
    var refusal: String?

    static func == (a: ShareItem, b: ShareItem) -> Bool {
        a.id == b.id && a.thumbnail === b.thumbnail && a.refusal == b.refusal
    }
}

/// The server's rules for what it keeps (src/lib/storage.ts, RULES), so a
/// refusal is explained before anything is uploaded rather than after.
enum ShareRules {
    /// A photo goes as `photo` and is kept up to this size before the server
    /// compresses it; ours are a few megabytes once shrunk.
    static let photoMaxBytes: Int64 = 40 * 1024 * 1024
    /// Everything else goes as `document`.
    static let documentMaxBytes: Int64 = 50 * 1024 * 1024
    /// What `saveFile` takes as a document, by the type the upload declares.
    static let documentTypes: Set<String> = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/zip",
        "application/x-zip-compressed",
        "video/mp4",
        "image/jpeg",
        "image/png",
        "image/webp",
        // What a browser sends for a DWG and other CAD files; the server takes it for them.
        "application/octet-stream",
    ]
    /// Drawings the studio sends that a phone may name with a type of its own
    /// ("application/dwg", "image/vnd.dxf") the server does not list: sent as
    /// a browser sends them, which is what the server's rule is written for.
    static let drawingExtensions: Set<String> = ["dwg", "dxf", "skp", "rvt", "rfa", "3dm", "ifc", "dgn", "max", "3ds"]
    /// The longest side a photo is sent at — what the server keeps anyway,
    /// and what the app's own chat sends (UploadMaker.photo).
    static let photoMaxPixels = 2400
    static let photoQuality: CGFloat = 0.82

    /// The type a file is declared as, as the app's chat does it
    /// (UploadMaker.file): from its extension, or the generic one.
    static func mimeType(for name: String) -> String {
        let ext = (name as NSString).pathExtension.lowercased()
        if drawingExtensions.contains(ext) { return "application/octet-stream" }
        return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }
}

enum ShareInbox {
    /// Everything this extension copies, cleared on every launch and finish.
    static let folder = FileManager.default.temporaryDirectory.appendingPathComponent("NeonShare", isDirectory: true)

    /// The most it sends in one go, whatever the share sheet let through.
    static let maxItems = 10

    static func clear() {
        try? FileManager.default.removeItem(at: folder)
    }

    /// The attachments, and any text or link shared with them (joined, for the
    /// message field). `onItem` is told as each one arrives, in order, on the
    /// main actor like the rest of the screen.
    @MainActor
    static func load(
        _ inputItems: [NSExtensionItem],
        expecting: (Int) -> Void,
        onItem: (ShareItem) -> Void
    ) async -> (text: String, dropped: Int) {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        var texts: [String] = []
        var files: [NSItemProvider] = []
        func addText(_ text: String?) {
            guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty,
                  !texts.contains(text) else { return }
            texts.append(text)
        }

        for item in inputItems {
            for provider in item.attachments ?? [] {
                if isFile(provider) {
                    files.append(provider)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                          let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                    if url.isFileURL { files.append(provider) } else { addText(url.absoluteString) }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    let loaded = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier)
                    if let string = loaded as? String {
                        addText(string)
                    } else if let attributed = loaded as? NSAttributedString {
                        addText(attributed.string)
                    } else if let data = loaded as? Data {
                        addText(String(data: data, encoding: .utf8))
                    } else if let url = loaded as? URL, url.isFileURL {
                        files.append(provider)
                    }
                } else if provider.registeredTypeIdentifiers.contains(where: { UTType($0)?.conforms(to: .data) == true }) {
                    // A file of some other kind of text (a web page, a JSON
                    // file): listed, so the refusal is said rather than silent.
                    files.append(provider)
                }
            }
            // WhatsApp and others put a message or a page's title here. A
            // link already on its own is not repeated.
            if let content = item.attributedContentText?.string,
               !texts.contains(where: { content.contains($0) || $0.contains(content) }) {
                addText(content)
            }
        }

        let kept = Array(files.prefix(maxItems))
        expecting(kept.count)
        for provider in kept {
            if let item = await loadFile(provider) { onItem(item) }
        }
        return (texts.joined(separator: "\n"), files.count - kept.count)
    }

    /// A photo, a video or a document, as opposed to text or a web link.
    private static func isFile(_ provider: NSItemProvider) -> Bool {
        if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) { return true }
        if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) { return true }
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) { return true }
        // Text and web links are data too, and are handled as what they are.
        return provider.registeredTypeIdentifiers.contains { id in
            guard let type = UTType(id) else { return false }
            return type.conforms(to: .data) && !type.conforms(to: .text) && !type.conforms(to: .url)
        }
    }

    private static func loadFile(_ provider: NSItemProvider) async -> ShareItem? {
        let kind: ShareItem.Kind
        let typeID: String
        if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
            kind = .video
            typeID = UTType.movie.identifier
        } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            kind = .photo
            typeID = UTType.image.identifier
        } else {
            kind = .file
            typeID = provider.registeredTypeIdentifiers.first { id in
                guard let type = UTType(id) else { return false }
                return type.conforms(to: .data) || type.conforms(to: .package)
            } ?? provider.registeredTypeIdentifiers.first ?? UTType.data.identifier
        }

        guard let url = await copyFile(provider, typeID: typeID) else {
            let name = provider.suggestedName ?? L("An attachment")
            let nowhere = folder.appendingPathComponent(UUID().uuidString, isDirectory: true).appendingPathComponent(name)
            return ShareItem(kind: kind, url: nowhere, name: name, bytes: 0, refusal: ShareError.unreadable(name).errorDescription)
        }

        let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isDirectoryKey])
        var item = ShareItem(kind: kind, url: url, name: url.lastPathComponent, bytes: Int64(values?.fileSize ?? 0))
        if values?.isDirectory == true {
            // A package (a Pages file kept as a folder, an app bundle): not one file.
            item.refusal = ShareError.unsupported(item.name).errorDescription
        } else if kind == .file {
            item.refusal = documentRefusal(item)
        }
        item.thumbnail = await thumbnail(for: url)
        return item
    }

    /// Why a document would be refused by the server, if it would be. A
    /// picture sent from Files goes as a photo, as it does from the app.
    private static func documentRefusal(_ item: ShareItem) -> String? {
        // A picture is made a JPEG and a video an MP4 on the way, whatever they are now.
        if isPicture(item.url) || isMovie(item.url) { return nil }
        guard ShareRules.documentTypes.contains(ShareRules.mimeType(for: item.name)) else {
            return ShareError.unsupported(item.name).errorDescription
        }
        if item.bytes > ShareRules.documentMaxBytes {
            return ShareError.tooLarge(item.name).errorDescription
        }
        return nil
    }

    static func isMovie(_ url: URL) -> Bool {
        UTType(filenameExtension: url.pathExtension)?.conforms(to: .movie) == true
    }

    static func isPicture(_ url: URL) -> Bool {
        guard UTType(filenameExtension: url.pathExtension)?.conforms(to: .image) == true,
              let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return false }
        return CGImageSourceGetCount(source) > 0 && CGImageSourceGetType(source) != nil
    }

    /// The provider's file, moved into our folder under its own name. The
    /// system deletes its copy when the handler returns, so it is moved there
    /// and then.
    private static func copyFile(_ provider: NSItemProvider, typeID: String) async -> URL? {
        let suggested = provider.suggestedName
        let destinationFolder = folder.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: destinationFolder, withIntermediateDirectories: true)

        func place(_ source: URL) -> URL? {
            let name = fileName(suggested: suggested, source: source)
            let destination = destinationFolder.appendingPathComponent(name)
            do {
                try FileManager.default.moveItem(at: source, to: destination)
            } catch {
                do { try FileManager.default.copyItem(at: source, to: destination) } catch { return nil }
            }
            return destination
        }

        let moved: URL? = await withCheckedContinuation { continuation in
            _ = provider.loadFileRepresentation(forTypeIdentifier: typeID) { url, _ in
                continuation.resume(returning: url.flatMap(place))
            }
        }
        if let moved { return moved }

        // Some apps hand over an object rather than a file: a URL to a file of
        // their own, the bytes, or a picture.
        guard let loaded = try? await provider.loadItem(forTypeIdentifier: typeID) else { return nil }
        if let url = loaded as? URL, url.isFileURL {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let destination = destinationFolder.appendingPathComponent(fileName(suggested: suggested, source: url))
            return (try? FileManager.default.copyItem(at: url, to: destination)) != nil ? destination : nil
        }
        let ext = UTType(typeID)?.preferredFilenameExtension ?? "dat"
        var data = loaded as? Data
        if data == nil, let image = loaded as? UIImage { data = image.jpegData(compressionQuality: 0.95) }
        guard let data else { return nil }
        let base = suggested.map { ($0 as NSString).deletingPathExtension } ?? "Attachment"
        let destination = destinationFolder.appendingPathComponent(data.isJPEG ? "\(base).jpg" : "\(base).\(ext)")
        return (try? data.write(to: destination)) != nil ? destination : nil
    }

    /// The name to keep: the one the app suggested, with the file's own
    /// extension when it left it off; else the file's name.
    private static func fileName(suggested: String?, source: URL) -> String {
        let ext = source.pathExtension
        guard var name = suggested?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
            return source.lastPathComponent
        }
        name = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        if !ext.isEmpty, (name as NSString).pathExtension.lowercased() != ext.lowercased() {
            name += ".\(ext)"
        }
        return name
    }

    /// A small picture of it: the photo, a frame of the video, a PDF's first
    /// page, or the document's icon.
    private static func thumbnail(for url: URL) async -> UIImage? {
        let request = QLThumbnailGenerator.Request(
            fileAt: url,
            size: CGSize(width: 76, height: 76),
            scale: 3,
            representationTypes: .all
        )
        return try? await QLThumbnailGenerator.shared.generateBestRepresentation(for: request).uiImage
    }
}

private extension Data {
    var isJPEG: Bool { starts(with: [0xFF, 0xD8, 0xFF]) }
}

// MARK: - Getting it into the shape the server keeps

enum ShareConverter {
    /// The file to upload for an item, made once and sent to every chosen
    /// conversation. `status` says what is happening when it takes a while.
    static func prepare(_ item: ShareItem, status: @escaping (String) -> Void) async throws -> ShareUpload {
        switch item.kind {
        case .photo:
            if let upload = try? photo(item) { return upload }
            // Not something ImageIO can read after all (a drawing some app
            // labels as an image): it goes as the file it is.
            return try document(item)
        case .video:
            status(L("Preparing the video…"))
            return try await video(item)
        case .file:
            if ShareInbox.isPicture(item.url), let upload = try? photo(item) { return upload }
            if ShareInbox.isMovie(item.url) {
                status(L("Preparing the video…"))
                return try await video(item)
            }
            return try document(item)
        }
    }

    private static func baseName(_ item: ShareItem) -> String {
        let base = (item.name as NSString).deletingPathExtension
        return base.isEmpty ? "photo" : base
    }

    /// Fitted within 2400 px and made a JPEG, as the app's chat sends a photo —
    /// decoded straight to that size, never at full size, and upright.
    private static func photo(_ item: ShareItem) throws -> ShareUpload {
        let destination = item.url.deletingLastPathComponent().appendingPathComponent("send-\(UUID().uuidString).jpg")
        try autoreleasepool {
            guard let source = CGImageSourceCreateWithURL(item.url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary)
            else { throw ShareError.unreadable(item.name) }
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: ShareRules.photoMaxPixels,
            ]
            guard var image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
            else { throw ShareError.unreadable(item.name) }
            // A JPEG has no transparency: a sticker or a cut-out goes on white,
            // not on the black its empty pixels would otherwise turn into.
            if image.hasTransparency, let flat = image.onWhite() { image = flat }
            guard let output = CGImageDestinationCreateWithURL(destination as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
            else { throw ShareError.unreadable(item.name) }
            CGImageDestinationAddImage(output, image, [kCGImageDestinationLossyCompressionQuality: ShareRules.photoQuality] as CFDictionary)
            guard CGImageDestinationFinalize(output) else { throw ShareError.unreadable(item.name) }
        }
        let size = (try? destination.resourceValues(forKeys: [.fileSizeKey]).fileSize).flatMap { $0 } ?? 0
        guard Int64(size) <= ShareRules.photoMaxBytes else { throw ShareError.tooLarge(item.name) }
        return ShareUpload(field: "photo", filename: baseName(item) + ".jpg", mimeType: "image/jpeg", file: destination)
    }

    private static func document(_ item: ShareItem) throws -> ShareUpload {
        let mime = ShareRules.mimeType(for: item.name)
        guard ShareRules.documentTypes.contains(mime) else { throw ShareError.unsupported(item.name) }
        guard item.bytes <= ShareRules.documentMaxBytes else { throw ShareError.tooLarge(item.name) }
        return ShareUpload(field: "document", filename: item.name, mimeType: mime, file: item.url)
    }

    /// An MP4 of 50 MB or less — the only video the server keeps. One that
    /// already is goes as it is; anything else (an iPhone's .mov, a long clip)
    /// is written out again as H.264, at the largest of 1080p, 720p, 540p or
    /// 480p that fits — playable in every browser the studio uses, where an
    /// iPhone's own HEVC is not.
    private static func video(_ item: ShareItem) async throws -> ShareUpload {
        let isMP4 = UTType(filenameExtension: item.url.pathExtension)?.conforms(to: .mpeg4Movie) == true
        let name = baseName(item) + ".mp4"
        if isMP4, item.bytes > 0, item.bytes <= ShareRules.documentMaxBytes {
            return ShareUpload(field: "document", filename: name, mimeType: "video/mp4", file: item.url)
        }

        let asset = AVURLAsset(url: item.url)
        let compatible = await withCheckedContinuation { continuation in
            AVAssetExportSession.determineCompatibility(ofExportPreset: AVAssetExportPreset1280x720, with: asset, outputFileType: .mp4) {
                continuation.resume(returning: $0)
            }
        }
        guard compatible else { throw ShareError.unreadable(item.name) }

        let presets = [AVAssetExportPreset1920x1080, AVAssetExportPreset1280x720, AVAssetExportPreset960x540, AVAssetExportPreset640x480]
        for preset in presets {
            guard let session = AVAssetExportSession(asset: asset, presetName: preset) else { continue }
            let destination = item.url.deletingLastPathComponent().appendingPathComponent("send-\(UUID().uuidString).mp4")
            session.outputURL = destination
            session.outputFileType = .mp4
            session.shouldOptimizeForNetworkUse = true
            // Its own estimate first, so a long clip is not written out four
            // times over; zero means it could not say.
            if preset != presets.last, session.estimatedOutputFileLength > ShareRules.documentMaxBytes { continue }

            let export = ShareExport(session)
            await withTaskCancellationHandler {
                await withCheckedContinuation { continuation in
                    export.session.exportAsynchronously { continuation.resume() }
                }
            } onCancel: {
                export.session.cancelExport()
            }
            try Task.checkCancellation()
            guard session.status == .completed else {
                try? FileManager.default.removeItem(at: destination)
                throw ShareError.unreadable(item.name)
            }
            let size = (try? destination.resourceValues(forKeys: [.fileSizeKey]).fileSize).flatMap { $0 } ?? 0
            if Int64(size) <= ShareRules.documentMaxBytes {
                return ShareUpload(field: "document", filename: name, mimeType: "video/mp4", file: destination)
            }
            try? FileManager.default.removeItem(at: destination)
        }
        throw ShareError.tooLarge(item.name)
    }
}

/// An export that Cancel can stop from any thread, which the session allows.
private final class ShareExport: @unchecked Sendable {
    let session: AVAssetExportSession
    init(_ session: AVAssetExportSession) { self.session = session }
}

private extension CGImage {
    var hasTransparency: Bool {
        switch alphaInfo {
        case .first, .last, .premultipliedFirst, .premultipliedLast, .alphaOnly: return true
        default: return false
        }
    }

    func onWhite() -> CGImage? {
        let space = colorSpace ?? CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: space.model == .rgb ? space : CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        ) else { return nil }
        let rect = CGRect(x: 0, y: 0, width: width, height: height)
        context.setFillColor(UIColor.white.cgColor)
        context.fill(rect)
        context.draw(self, in: rect)
        return context.makeImage()
    }
}
