import AVFoundation
import AVKit
import CryptoKit
import SwiftUI
import UIKit

// Videos in a conversation, the way WhatsApp draws them. The server has no
// video kind: a video arrives as the form's `document` and is kept as a FILE
// whose type is its extension ("mp4"; "video/mp4" on a few older rows) — so
// the room decides from the type and the name, and draws it as a video rather
// than as a file to open: a frame from the video itself with no bubble around
// it (like the chat's photos), a play button, how long it runs in one bottom
// corner, the time and ticks in the other, and the caption underneath. A tap
// plays it full screen with the system's own controls, and Share hands the
// file to the share sheet. This is the same for a video sent from this phone,
// from the website, and shared in through the share extension.
//
// The frame is read from the remote file (AVAssetImageGenerator; the media
// route serves byte ranges, so only the start of the file and its index are
// fetched), never on the main thread, and kept in memory and on disk under the
// file's address: the file never changes under the same address, so a frame
// read once is good for good. A video still going up shows the frame read
// from the bytes this phone holds, and that frame is kept under the address
// the server gives it, so the real message draws at once.

// MARK: - Which attachments are videos

/// The extensions a chat video goes by. The server keeps MP4 only; a .mov or
/// .m4v from elsewhere is drawn the same way.
private let chatVideoExtensions: Set<String> = ["mp4", "mov", "m4v"]

/// The extension of a file's address — for the media route's address
/// (`/api/media?u=…`), the stored file's own, which it carries in `u`.
func chatFileExtension(_ address: String) -> String {
    let components = URLComponents(string: address)
    if let inner = components?.queryItems?.first(where: { $0.name == "u" })?.value, components?.path.hasSuffix("/api/media") == true {
        return chatFileExtension(inner)
    }
    // An address's own path, so a query is not read as the extension.
    let path = components?.path ?? address
    return (path as NSString).pathExtension.lowercased()
}

/// Whether an attachment is a video: by its type (an extension or a MIME
/// type), then by the extension of its name or its address.
func chatIsVideoAttachment(type: String?, name: String?, url: String? = nil) -> Bool {
    if let type = type?.trimmingCharacters(in: .whitespaces).lowercased(), !type.isEmpty {
        if type.hasPrefix("video/") || chatVideoExtensions.contains(type) { return true }
    }
    if let name, chatVideoExtensions.contains((name as NSString).pathExtension.lowercased()) { return true }
    if let url, !url.isEmpty, chatVideoExtensions.contains(chatFileExtension(url)) { return true }
    return false
}

extension ChatMessage {
    /// A video attachment — drawn as a video, not as a file.
    var isVideo: Bool {
        guard kind == "FILE" || kind == "VIDEO" else { return false }
        return chatIsVideoAttachment(type: attachmentType, name: attachmentName, url: attachmentUrl)
    }
}

/// A video this phone is still sending: the bytes it holds, to read a frame from.
struct ChatVideoUpload {
    let key: String
    let data: Data
    let ext: String
}

extension ChatOutgoing {
    /// The video being sent, when this stand-in is one.
    var videoUpload: ChatVideoUpload? {
        guard case .file(let file, _) = payload,
              chatIsVideoAttachment(type: file.mimeType, name: file.filename) else { return nil }
        let ext = (file.filename as NSString).pathExtension.lowercased()
        return ChatVideoUpload(key: ChatVideoPosters.localKey(id), data: file.data, ext: ext.isEmpty ? "mp4" : ext)
    }
}

// MARK: - Frames and lengths

/// What a video looks like before it plays: a frame from it, and how long it runs.
struct ChatVideoInfo: @unchecked Sendable {
    let poster: UIImage?
    let seconds: Double?

    var aspect: CGFloat? {
        guard let poster, poster.size.height > 0 else { return nil }
        return poster.size.width / poster.size.height
    }
}

/// Each video's frame and length, read once: in memory, and on disk in the
/// caches folder (which the system may clear; it is all re-readable).
final class ChatVideoPosters: @unchecked Sendable {
    static let shared = ChatVideoPosters()

    private final class Entry {
        let info: ChatVideoInfo
        init(_ info: ChatVideoInfo) { self.info = info }
    }

    private let memory = NSCache<NSString, Entry>()
    private var inFlight: [String: Task<ChatVideoInfo?, Never>] = [:]
    private let lock = NSLock()
    private let folder: URL?

    /// The size a frame is read at: a chat shows it 250 points wide.
    private static let posterPixels: CGFloat = 900

    private init() {
        memory.countLimit = 80
        folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent("NeonVideoPosters", isDirectory: true)
        let folder = folder
        Task.detached(priority: .background) { Self.tidy(folder) }
    }

    static func key(_ url: URL) -> String { url.absoluteString }
    static func localKey(_ outgoingId: String) -> String { "local:\(outgoingId)" }

    /// Already read, without waiting — for drawing the first frame of a row.
    func cached(_ key: String) -> ChatVideoInfo? {
        memory.object(forKey: key as NSString)?.info
    }

    /// The frame and length of the video at `url`. nil when it could not be read.
    func info(for url: URL) async -> ChatVideoInfo? {
        await load(Self.key(url), persist: true) {
            var options: [String: Any] = [:]
            let ext = chatFileExtension(url.absoluteString)
            if #available(iOS 17.0, *), chatVideoExtensions.contains(ext) {
                // The media route's address has no extension of its own; say
                // what it is rather than leave it to the answer's headers.
                options[AVURLAssetOverrideMIMETypeKey] = ext == "mov" ? "video/quicktime" : "video/mp4"
            }
            return await Self.read(AVURLAsset(url: url, options: options))
        }
    }

    /// The same, for a video this phone is sending, read from its own bytes.
    func info(of upload: ChatVideoUpload) async -> ChatVideoInfo? {
        let data = upload.data
        let ext = upload.ext
        return await load(upload.key, persist: false) {
            // AVFoundation reads from a file, so the bytes go to one for a moment.
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("poster-\(UUID().uuidString).\(ext)")
            defer { try? FileManager.default.removeItem(at: file) }
            guard (try? data.write(to: file)) != nil else { return nil }
            return await Self.read(AVURLAsset(url: file))
        }
    }

    /// A video this phone just sent: its frame, read before it went up, kept
    /// under the address the server gave it.
    func adopt(_ localKey: String, as url: URL) {
        guard let info = cached(localKey) else { return }
        let key = Self.key(url)
        memory.setObject(Entry(info), forKey: key as NSString)
        memory.removeObject(forKey: localKey as NSString)
        let folder = folder
        Task.detached(priority: .utility) { Self.save(info, key: key, in: folder) }
    }

    #if DEBUG
    /// The debug router's fixtures: a frame without a file behind it.
    func seed(_ info: ChatVideoInfo, for key: String) {
        memory.setObject(Entry(info), forKey: key as NSString)
    }
    #endif

    private func load(_ key: String, persist: Bool, make: @escaping @Sendable () async -> ChatVideoInfo?) async -> ChatVideoInfo? {
        if let hit = cached(key) { return hit }
        let folder = folder
        let task: Task<ChatVideoInfo?, Never> = lock.withLock {
            if let running = inFlight[key] { return running }
            let started = Task.detached(priority: .utility) { () -> ChatVideoInfo? in
                if persist, let saved = Self.restore(key: key, in: folder) { return saved }
                guard let made = await make() else { return nil }
                if persist { Self.save(made, key: key, in: folder) }
                return made
            }
            inFlight[key] = started
            return started
        }
        let info = await task.value
        lock.withLock { inFlight[key] = nil }
        if let info { memory.setObject(Entry(info), forKey: key as NSString) }
        return info
    }

    /// A frame from near the start (half a second in, past a fade from black)
    /// and the length.
    private static func read(_ asset: AVURLAsset) async -> ChatVideoInfo? {
        var seconds: Double?
        if let duration = try? await asset.load(.duration), duration.isNumeric, duration.seconds > 0 {
            seconds = duration.seconds
        }
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: posterPixels, height: posterPixels)
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = CMTime(seconds: 1, preferredTimescale: 600)
        let at = min(0.5, (seconds ?? 0) / 2)
        var frame: CGImage?
        if let result = try? await generator.image(at: CMTime(seconds: at, preferredTimescale: 600)) {
            frame = result.image
        } else {
            // Any frame at all, the nearest the file can give quickly.
            generator.requestedTimeToleranceBefore = .positiveInfinity
            generator.requestedTimeToleranceAfter = .positiveInfinity
            frame = (try? await generator.image(at: .zero))?.image
        }
        guard frame != nil || seconds != nil else { return nil }
        return ChatVideoInfo(poster: frame.map { UIImage(cgImage: $0) }, seconds: seconds)
    }

    // MARK: On disk

    private static func file(_ key: String, in folder: URL?) -> URL? {
        guard let folder else { return nil }
        let digest = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return folder.appendingPathComponent(digest)
    }

    private static func save(_ info: ChatVideoInfo, key: String, in folder: URL?) {
        guard let folder, let base = file(key, in: folder) else { return }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        if let poster = info.poster, let jpeg = poster.jpegData(compressionQuality: 0.8) {
            try? jpeg.write(to: base.appendingPathExtension("jpg"), options: .atomic)
        }
        // Written last: its being there means the frame beside it is whole.
        let meta: [String: Double] = ["seconds": info.seconds ?? 0]
        if let data = try? JSONSerialization.data(withJSONObject: meta) {
            try? data.write(to: base.appendingPathExtension("json"), options: .atomic)
        }
    }

    private static func restore(key: String, in folder: URL?) -> ChatVideoInfo? {
        guard let base = file(key, in: folder),
              let data = try? Data(contentsOf: base.appendingPathExtension("json")),
              let meta = (try? JSONSerialization.jsonObject(with: data)) as? [String: Double]
        else { return nil }
        let poster = (try? Data(contentsOf: base.appendingPathExtension("jpg"))).flatMap { UIImage(data: $0) }
        let seconds = meta["seconds"].flatMap { $0 > 0 ? $0 : nil }
        guard poster != nil || seconds != nil else { return nil }
        // Decoded here, off the main thread, not on first draw.
        return ChatVideoInfo(poster: poster.map { $0.preparingForDisplay() ?? $0 }, seconds: seconds)
    }

    /// Frames not looked at for a month go.
    private static func tidy(_ folder: URL?) {
        guard let folder,
              let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentAccessDateKey, .contentModificationDateKey])
        else { return }
        let cutoff = Date().addingTimeInterval(-30 * 24 * 3600)
        for file in files {
            let values = try? file.resourceValues(forKeys: [.contentAccessDateKey, .contentModificationDateKey])
            if let used = values?.contentAccessDate ?? values?.contentModificationDate, used < cutoff {
                try? FileManager.default.removeItem(at: file)
            }
        }
    }
}

// MARK: - In the conversation

/// A video in the conversation at its own shape (within ChatPhotoLayout's
/// limits): its frame, a soft shade, the play button — a spinner while it is
/// still going up — and how long it runs in the bottom leading corner.
/// Shimmers while the frame is read; a dark tile if it cannot be.
struct ChatVideoFrame: View {
    let url: URL?
    var upload: ChatVideoUpload?
    /// Still going up.
    var sending = false
    /// Called as the frame takes the video's own height, so the conversation
    /// can stay at the newest (as a photo does).
    var onResize: (() -> Void)?

    @State private var info: ChatVideoInfo?
    @State private var failed = false

    init(url: URL?, upload: ChatVideoUpload? = nil, sending: Bool = false, onResize: (() -> Void)? = nil) {
        self.url = url
        self.upload = upload
        self.sending = sending
        self.onResize = onResize
        let key = url.map(ChatVideoPosters.key) ?? upload?.key
        _info = State(initialValue: key.flatMap { ChatVideoPosters.shared.cached($0) })
    }

    private var loadKey: String? { url.map(ChatVideoPosters.key) ?? upload?.key }

    var body: some View {
        ZStack {
            if let poster = info?.poster {
                Image(uiImage: poster)
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            } else if failed {
                ZStack {
                    LinearGradient.neonInkHero
                    Image(systemName: "film")
                        .font(.system(size: 34, weight: .regular))
                        .foregroundStyle(Color.white.opacity(0.22))
                        .offset(y: -44)
                }
            } else {
                Color.neonPurple.opacity(0.08).shimmer()
            }
            ChatPhotoShade()
            ChatVideoPlayGlyph(sending: sending)
        }
        .frame(width: ChatPhotoLayout.width, height: ChatPhotoLayout.height(aspect: info?.aspect))
        .clipped()
        .overlay(alignment: .bottomLeading) {
            if let seconds = info?.seconds {
                ChatVideoLength(seconds: seconds)
                    .transition(.opacity)
            }
        }
        .task(id: loadKey) { await load() }
    }

    private func load() async {
        guard info?.poster == nil else { return }
        let loaded: ChatVideoInfo?
        if let url {
            loaded = await ChatVideoPosters.shared.info(for: url)
        } else if let upload {
            loaded = await ChatVideoPosters.shared.info(of: upload)
        } else {
            return
        }
        guard !Task.isCancelled else { return }
        let before = ChatPhotoLayout.height(aspect: info?.aspect)
        withAnimation(.easeOut(duration: 0.25)) {
            info = loaded
            failed = loaded?.poster == nil
        }
        if ChatPhotoLayout.height(aspect: loaded?.aspect) != before { onResize?() }
    }
}

/// The round play button over a video — a spinner while it is still sending.
struct ChatVideoPlayGlyph: View {
    var sending = false
    var size: CGFloat = 52

    var body: some View {
        ZStack {
            Circle().fill(Color.black.opacity(0.42))
            Circle().strokeBorder(Color.white.opacity(0.4), lineWidth: 1)
            if sending {
                ProgressView().tint(.white)
            } else {
                Image(systemName: "play.fill")
                    .font(.system(size: size * 0.38, weight: .bold))
                    .foregroundStyle(.white)
                    // The triangle sits a touch right of centre to look centred.
                    .offset(x: size * 0.04)
            }
        }
        .frame(width: size, height: size)
        .shadow(color: .black.opacity(0.25), radius: 6, x: 0, y: 2)
        .environment(\.layoutDirection, .leftToRight)
        .allowsHitTesting(false)
    }
}

/// How long a video runs, over its bottom corner like a photo's time.
struct ChatVideoLength: View {
    let seconds: Double

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "video.fill").font(.system(size: 10, weight: .semibold))
            Text(verbatim: chatCallLength(seconds)).font(.system(size: 11, weight: .medium)).monospacedDigit()
        }
        .foregroundStyle(.white)
        .shadow(color: .black.opacity(0.35), radius: 2, y: 0.5)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: chatCallLength(seconds)))
    }
}

// MARK: - Full screen

/// What the full-screen player plays, and what its top line says.
struct ChatVideoPayload: Identifiable {
    let id: String
    let url: URL
    /// Who sent it.
    var title: String?
    /// When.
    var subtitle: String?
    var caption: String?
    /// The file's own name, for sharing it.
    var fileName: String?
}

/// The video, full screen, with the system's own controls (play, the
/// scrubber, AirPlay, its own full-screen button); above it Close, who sent
/// it and when, and Share — which downloads the file and hands it to the
/// share sheet (Save to Files, AirDrop, another app; Save Video too, where the
/// app may write to Photos). Streams over byte ranges, so it starts before
/// the whole file is here.
struct ChatVideoPlayerScreen: View {
    let payload: ChatVideoPayload

    @Environment(\.dismiss) private var dismiss
    @StateObject private var playback: ChatVideoPlayback

    init(payload: ChatVideoPayload) {
        self.payload = payload
        _playback = StateObject(wrappedValue: ChatVideoPlayback(url: payload.url, fileName: payload.fileName))
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            ZStack {
                ChatAVPlayerView(player: playback.player)
                if playback.failed {
                    VStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle").font(.system(size: 28))
                        Text(L("This video couldn't be played."))
                            .font(.neonSubtitle)
                            .multilineTextAlignment(.center)
                    }
                    .foregroundStyle(.white.opacity(0.7))
                    .padding(24)
                    .transition(.opacity)
                }
            }
            if let caption = payload.caption, !caption.isEmpty {
                DirText(caption, font: .system(.footnote, weight: .medium), color: .white.opacity(0.9), lineLimit: 4)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
            }
        }
        .background(Color.black.ignoresSafeArea())
        // The app is light; on this black page the status bar's glyphs must be white.
        .preferredColorScheme(.dark)
        .animation(NeonMotion.resolved(NeonMotion.quick), value: playback.failed)
        .onAppear { playback.start() }
        .onDisappear { playback.stop() }
        .sheet(item: $playback.shareFile) { file in
            ChatShareSheet(url: file.url)
                .ignoresSafeArea()
                .neonSheet([.medium, .large])
        }
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            IconButton("xmark", label: L("Close"), tint: .white, size: 40) { dismiss() }
            VStack(alignment: .leading, spacing: 1) {
                if let title = payload.title, !title.isEmpty {
                    DirText(title, font: .system(.subheadline, weight: .semibold), color: .white, fill: false, lineLimit: 1)
                }
                if let subtitle = payload.subtitle, !subtitle.isEmpty {
                    Text(verbatim: subtitle)
                        .font(.system(.caption, weight: .medium))
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if playback.preparingShare {
                ProgressView()
                    .tint(.white)
                    .frame(width: 40, height: 40)
                    .accessibilityLabel(L("Downloading…"))
            } else {
                IconButton("square.and.arrow.up", label: L("Share or save"), tint: .white, size: 40) {
                    Task { await playback.prepareShare() }
                }
            }
        }
        .padding(.horizontal, NeonSpace.gutter)
        .padding(.vertical, 8)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
}

/// A downloaded file waiting for the share sheet.
struct ChatSharedFile: Identifiable {
    let id = UUID()
    let url: URL
}

/// The player behind the full-screen video, and the file's download for sharing.
@MainActor
final class ChatVideoPlayback: ObservableObject {
    let player: AVPlayer
    @Published private(set) var failed = false
    @Published private(set) var preparingShare = false
    @Published var shareFile: ChatSharedFile?

    private let url: URL
    private let fileName: String
    private var downloaded: URL?
    private var statusObservation: NSKeyValueObservation?

    init(url: URL, fileName: String?) {
        self.url = url
        var name = (fileName ?? "").replacingOccurrences(of: "/", with: "-").trimmingCharacters(in: .whitespaces)
        if name.isEmpty { name = "video" }
        if (name as NSString).pathExtension.isEmpty {
            let ext = (url.path as NSString).pathExtension
            name += "." + (ext.isEmpty ? "mp4" : ext)
        }
        self.fileName = name
        let item = AVPlayerItem(url: url)
        player = AVPlayer(playerItem: item)
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            let failed = item.status == .failed
            Task { @MainActor [weak self] in
                guard let self, failed != self.failed else { return }
                self.failed = failed
            }
        }
    }

    func start() {
        // One sound at a time: a voice note playing stops.
        ChatVoicePlayer.shared.stop()
        // During a call the session belongs to the call; leave it as it is.
        if CallCenter.shared.session == nil {
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            try? AVAudioSession.sharedInstance().setActive(true)
        }
        player.play()
    }

    func stop() {
        player.pause()
    }

    /// Fetches the file (once) and opens the share sheet on it.
    func prepareShare() async {
        guard !preparingShare else { return }
        if let downloaded {
            shareFile = ChatSharedFile(url: downloaded)
            return
        }
        preparingShare = true
        defer { preparingShare = false }
        do {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("chat-video-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let destination = folder.appendingPathComponent(fileName)
            if url.isFileURL {
                try FileManager.default.copyItem(at: url, to: destination)
            } else {
                let (temporary, response) = try await URLSession.shared.download(from: url)
                if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                    throw URLError(.badServerResponse)
                }
                try FileManager.default.moveItem(at: temporary, to: destination)
            }
            downloaded = destination
            Haptic.tap()
            shareFile = ChatSharedFile(url: destination)
        } catch {
            Toast.error(L("The video could not be downloaded."))
        }
    }
}

/// AVKit's own player view, embedded: the system's controls, no picture in
/// picture (nothing here could bring it back to the conversation).
private struct ChatAVPlayerView: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.showsPlaybackControls = true
        controller.allowsPictureInPicturePlayback = false
        controller.canStartPictureInPictureAutomaticallyFromInline = false
        controller.entersFullScreenWhenPlaybackBegins = false
        controller.exitsFullScreenWhenPlaybackEnds = false
        controller.videoGravity = .resizeAspect
        controller.view.backgroundColor = .black
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player { controller.player = player }
    }
}

/// The system's share sheet for one file.
struct ChatShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        // "Save Video" writes to Photos, which iOS lets an app do only when its
        // Info.plist says why (NSPhotoLibraryAddUsageDescription) — without
        // that the app is stopped on the spot. Offered once the key is there.
        if Bundle.main.object(forInfoDictionaryKey: "NSPhotoLibraryAddUsageDescription") == nil {
            controller.excludedActivityTypes = [.saveToCameraRoll]
        }
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
