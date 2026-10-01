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
    enum Kind: Equatable { case photo, video, voice, file }

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
    /// A voice note goes as `voice`, up to the server's 15 MB for a recording.
    /// The server turns an Ogg/WebM one (a WhatsApp .opus) into AAC, which an
    /// iPhone plays (src/lib/voice-transcode.ts).
    static let voiceMaxBytes: Int64 = 15 * 1024 * 1024
    /// What it is sent as, by extension — the types the server keeps as audio.
    static let voiceTypes: [String: String] = [
        "opus": "audio/ogg", "ogg": "audio/ogg", "oga": "audio/ogg",
        "m4a": "audio/mp4", "aac": "audio/aac", "mp4a": "audio/mp4",
        "mp3": "audio/mpeg", "wav": "audio/wav", "webm": "audio/webm",
    ]
    /// Audio the phone can read but the server does not keep: written out as
    /// an M4A on the way.
    static let voiceConvertible: Set<String> = ["caf", "aif", "aiff", "amr", "3gp"]
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
                if has(provider, .movie) || has(provider, .image) {
                    files.append(provider)
                } else if let content = contentType(provider), UTType(content)?.conforms(to: .text) != true {
                    // A document: its own bytes are registered, whatever else is.
                    files.append(provider)
                } else if has(provider, .url), let url = await loadURL(provider, type: .url) {
                    // A web link is text; a link to a file on this phone is that file.
                    if url.isFileURL { files.append(provider) } else { addText(url.absoluteString) }
                } else if has(provider, .plainText) {
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
                } else if contentType(provider) != nil {
                    // Some other kind of text (a web page, a contact card):
                    // listed, so the refusal is said rather than silent.
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
            onItem(await loadFile(provider))
        }
        return (texts.joined(separator: "\n"), files.count - kept.count)
    }

    /// Whether any type the provider registered is `type`. Not
    /// `hasItemConformingToTypeIdentifier`, which also answers yes the other
    /// way round: a provider of a web link "has" a file URL by it, since a
    /// file URL is a kind of URL.
    private static func has(_ provider: NSItemProvider, _ type: UTType) -> Bool {
        provider.registeredTypeIdentifiers.contains { UTType($0)?.conforms(to: type) == true }
    }

    /// The first type a provider registered that is the thing itself rather
    /// than a link to it. An extension the phone has no type for (".dwg" on
    /// many iPhones) is registered as a dynamic type, which conforms to
    /// nothing — it is still the file's content.
    private static func contentType(_ provider: NSItemProvider, conformingTo wanted: UTType? = nil) -> String? {
        provider.registeredTypeIdentifiers.first { id in
            guard let type = UTType(id) else { return wanted == nil }
            if let wanted { return type.conforms(to: wanted) }
            return !type.conforms(to: .url)
        }
    }

    /// A link, as the object it is. Asked for as an item instead, an app's
    /// NSURL arrives as the bytes of an archived property list.
    private static func loadURL(_ provider: NSItemProvider, type: UTType) async -> URL? {
        if provider.canLoadObject(ofClass: NSURL.self) {
            let url: URL? = await withCheckedContinuation { continuation in
                _ = provider.loadObject(ofClass: URL.self) { url, _ in continuation.resume(returning: url) }
            }
            if let url, type != .fileURL || url.isFileURL { return url }
        }
        let loaded = try? await provider.loadItem(forTypeIdentifier: type.identifier)
        if let url = loaded as? URL { return url }
        if let data = loaded as? Data, !data.starts(with: Array("bplist".utf8)),
           let string = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) {
            return URL(string: string)
        }
        return nil
    }

    private static func loadFile(_ provider: NSItemProvider) async -> ShareItem {
        var kind: ShareItem.Kind
        let typeID: String?
        if has(provider, .audio) {
            kind = .voice
            typeID = contentType(provider, conformingTo: .audio)
        } else if has(provider, .movie) {
            kind = .video
            typeID = contentType(provider, conformingTo: .movie)
        } else if has(provider, .image) {
            kind = .photo
            typeID = contentType(provider, conformingTo: .image)
        } else {
            kind = .file
            typeID = contentType(provider)
        }

        // What it is called where it came from: the name the app suggested,
        // else the file's own. The copy the system hands over is often
        // called something generic ("PDF document.pdf").
        var original = provider.suggestedName
        if original?.isEmpty != false, has(provider, .fileURL) {
            original = await loadURL(provider, type: .fileURL)?.lastPathComponent
        }

        guard let url = await copyFile(provider, typeID: typeID, name: original) else {
            let name = original ?? L("An attachment")
            let nowhere = folder.appendingPathComponent(UUID().uuidString, isDirectory: true).appendingPathComponent(name)
            return ShareItem(kind: kind, url: nowhere, name: name, bytes: 0, refusal: ShareError.unreadable(name).errorDescription)
        }

        // A voice note from WhatsApp is an ".opus" file, which many phones
        // have no audio type for: known by its extension instead.
        if kind == .file, isVoice(url) { kind = .voice }

        let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isDirectoryKey])
        var item = ShareItem(kind: kind, url: url, name: url.lastPathComponent, bytes: Int64(values?.fileSize ?? 0))
        if kind == .voice {
            item.refusal = voiceRefusal(item)
            return item
        }
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

    static func isVoice(_ url: URL) -> Bool {
        let ext = url.pathExtension.lowercased()
        return ShareRules.voiceTypes[ext] != nil || ShareRules.voiceConvertible.contains(ext)
            || UTType(filenameExtension: ext)?.conforms(to: .audio) == true
    }

    private static func voiceRefusal(_ item: ShareItem) -> String? {
        let ext = item.url.pathExtension.lowercased()
        let known = ShareRules.voiceTypes[ext] != nil || ShareRules.voiceConvertible.contains(ext)
            || UTType(filenameExtension: ext)?.conforms(to: .audio) == true
        if !known { return ShareError.unsupported(item.name).errorDescription }
        // A convertible one is measured after it is written out.
        if ShareRules.voiceTypes[ext] != nil, item.bytes > ShareRules.voiceMaxBytes {
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
    /// and then. With no content type registered, only a file URL, the file
    /// is copied from where it is.
    private static func copyFile(_ provider: NSItemProvider, typeID: String?, name: String?) async -> URL? {
        let destinationFolder = folder.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: destinationFolder, withIntermediateDirectories: true)

        func copy(from url: URL) -> URL? {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let destination = destinationFolder.appendingPathComponent(fileName(suggested: name, source: url))
            return (try? FileManager.default.copyItem(at: url, to: destination)) != nil ? destination : nil
        }

        guard let typeID else {
            guard let url = await loadURL(provider, type: .fileURL), url.isFileURL else { return nil }
            return copy(from: url)
        }

        let moved: URL? = await withCheckedContinuation { continuation in
            _ = provider.loadFileRepresentation(forTypeIdentifier: typeID) { url, _ in
                continuation.resume(returning: url.flatMap { source in
                    let destination = destinationFolder.appendingPathComponent(fileName(suggested: name, source: source))
                    if (try? FileManager.default.moveItem(at: source, to: destination)) != nil { return destination }
                    return (try? FileManager.default.copyItem(at: source, to: destination)) != nil ? destination : nil
                })
            }
        }
        if let moved { return moved }

        // Some apps hand over an object rather than a file: a URL to a file of
        // their own, the bytes, or a picture.
        guard let loaded = try? await provider.loadItem(forTypeIdentifier: typeID) else { return nil }
        if let url = loaded as? URL, url.isFileURL { return copy(from: url) }
        let ext = UTType(typeID)?.preferredFilenameExtension ?? "dat"
        var data = loaded as? Data
        if data == nil, let image = loaded as? UIImage { data = image.jpegData(compressionQuality: 0.95) }
        guard let data else { return nil }
        let base = name.map { ($0 as NSString).deletingPathExtension } ?? "Attachment"
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
        case .voice:
            return try await voice(item, status: status)
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

    /// A voice note, as the app's own recording is sent: the `voice` field
    /// with its length when the phone can read one. An Ogg/WebM note (a
    /// WhatsApp .opus) goes as it is — the phone cannot read it, the server
    /// converts and measures it.
    private static func voice(_ item: ShareItem, status: @escaping (String) -> Void) async throws -> ShareUpload {
        var url = item.url
        var ext = url.pathExtension.lowercased()
        if ShareRules.voiceTypes[ext] == nil {
            status(L("Preparing the voice message…"))
            url = try await m4a(item)
            ext = "m4a"
        }
        let bytes = Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize).flatMap { $0 } ?? 0)
        guard bytes <= ShareRules.voiceMaxBytes else { throw ShareError.tooLarge(item.name) }
        var fields: [(String, String)] = []
        if ext != "opus" && ext != "ogg" && ext != "oga" && ext != "webm" {
            let seconds = try? await AVURLAsset(url: url).load(.duration).seconds
            if let seconds, seconds.isFinite, seconds > 0 { fields.append(("durationSeconds", String(max(1, Int(seconds.rounded()))))) }
        }
        let base = (item.name as NSString).deletingPathExtension
        return ShareUpload(
            field: "voice",
            filename: (base.isEmpty ? "Voice message" : base) + "." + ext,
            mimeType: ShareRules.voiceTypes[ext] ?? "audio/mp4",
            file: url,
            fields: fields
        )
    }

    /// Audio the phone reads but the server does not keep (CAF, AIFF, AMR),
    /// written out as an M4A.
    private static func m4a(_ item: ShareItem) async throws -> URL {
        let destination = item.url.deletingLastPathComponent().appendingPathComponent("voice-\(UUID().uuidString).m4a")
        guard let export = AVAssetExportSession(asset: AVURLAsset(url: item.url), presetName: AVAssetExportPresetAppleM4A) else {
            throw ShareError.unsupported(item.name)
        }
        export.outputURL = destination
        export.outputFileType = .m4a
        await export.export()
        guard export.status == .completed else { throw ShareError.unsupported(item.name) }
        return destination
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
