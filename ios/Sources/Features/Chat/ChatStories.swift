import AVFoundation
import AVKit
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// Stories: the whole studio's photos and short videos from the last 24 hours.
// The rail at the top of the chat list, posting one (camera or library, with
// an optional caption), and who has seen yours. The full-screen viewer is in
// ChatStoryPlayer.swift.

// MARK: - The rail

struct ChatStoriesRail: View {
    let stories: ChatStoriesResponse?
    let isLoading: Bool
    let myName: String
    let isManager: Bool
    /// Whether an author ("admin" or an employee id) is here right now.
    let isOnline: (String) -> Bool
    let onOpen: (ChatStoryRing) -> Void
    let onCompose: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 14) {
                myStory
                if let others = stories?.others {
                    ForEach(Array(others.enumerated()), id: \.element.id) { index, ring in
                        Button {
                            Haptic.tap()
                            onOpen(ring)
                        } label: {
                            ChatStoryBubble(
                                name: ring.name,
                                avatarURL: ring.avatarURL ?? ring.stories.last(where: { !$0.isVideo })?.mediaURL,
                                seen: ring.allViewed,
                                online: isOnline(ring.authorKey),
                                isStudio: ring.authorKey == "admin" && ring.avatar == nil
                            )
                        }
                        .buttonStyle(PressableStyle(scale: 0.92))
                        .staggered(index + 1)
                    }
                } else if isLoading {
                    ForEach(0..<4, id: \.self) { index in
                        VStack(spacing: 7) {
                            Circle().fill(Color.neonInk.opacity(0.07)).frame(width: 74, height: 74)
                            SkeletonBlock(width: 52, height: 10)
                        }
                        .shimmer()
                        .staggered(index)
                    }
                }
            }
            .padding(.horizontal, NeonSpace.gutter)
            .padding(.vertical, 6)
        }
    }

    private var mine: ChatStoryRing? {
        guard let ring = stories?.mine, !ring.stories.isEmpty else { return nil }
        return ring
    }

    private var myStory: some View {
        VStack(spacing: 7) {
            ZStack(alignment: .bottomTrailing) {
                Button {
                    Haptic.tap()
                    if let mine { onOpen(mine) } else { onCompose() }
                } label: {
                    ZStack {
                        if mine != nil {
                            Circle().strokeBorder(ChatTint.storyRing, lineWidth: 3)
                        }
                        Group {
                            if isManager && stories?.mine?.avatar == nil {
                                ChatStudioMark(size: 68)
                            } else {
                                ChatAvatar(
                                    url: stories?.mine?.avatarURL ?? mine?.stories.last(where: { !$0.isVideo })?.mediaURL,
                                    name: myName,
                                    size: 68
                                )
                            }
                        }
                    }
                    .frame(width: 76, height: 76)
                }
                .buttonStyle(PressableStyle(scale: 0.92))

                Button {
                    Haptic.impact(.light)
                    onCompose()
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 13, weight: .heavy))
                        .foregroundStyle(.white)
                        .frame(width: 26, height: 26)
                        .background(Circle().fill(ChatTint.accent))
                        .overlay(Circle().strokeBorder(Color.white, lineWidth: 2.5))
                        .neonShadow(.glow(.neonPurple))
                }
                .buttonStyle(PressableStyle(scale: 0.85))
                .accessibilityLabel(L("Add to your story"))
                .offset(x: 2, y: 2)
            }
            Text(L("My Story"))
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.neonInk.opacity(0.8))
                .lineLimit(1)
                .frame(width: 78)
        }
        .staggered(0)
    }
}

/// One ring: colourful while there is something new, grey once it is all seen.
struct ChatStoryBubble: View {
    let name: String
    let avatarURL: URL?
    let seen: Bool
    var online = false
    var isStudio = false

    var body: some View {
        VStack(spacing: 7) {
            ZStack {
                if seen {
                    Circle().strokeBorder(Color.neonInk.opacity(0.16), lineWidth: 2)
                } else {
                    Circle().strokeBorder(ChatTint.storyRing, lineWidth: 3)
                }
                if isStudio && avatarURL == nil {
                    ChatStudioMark(size: 66)
                } else {
                    ChatAvatar(url: avatarURL, name: name, size: 66)
                }
            }
            .frame(width: 76, height: 76)
            .overlay(alignment: .bottomTrailing) {
                if online {
                    Circle()
                        .fill(Color.neonSuccess)
                        .frame(width: 18, height: 18)
                        .overlay(Circle().strokeBorder(Color.white, lineWidth: 3))
                        .offset(x: -2, y: -2)
                }
            }
            .opacity(seen ? 0.85 : 1)

            DirText(name, font: .system(size: 13, weight: seen ? .regular : .medium), color: Color.neonInk.opacity(seen ? 0.55 : 0.85), fill: false, lineLimit: 1)
                .frame(width: 78)
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint(seen ? L("Seen") : L("New story"))
    }
}

// MARK: - Posting

/// The picked media, ready to send: a photo, or a video already turned into mp4.
private enum ChatStoryMedia {
    case photo(UIImage)
    case video(URL)

    var upload: UploadFile? {
        switch self {
        case .photo(let image):
            guard let file = UploadMaker.photo(image, name: "story.jpg") else { return nil }
            return UploadFile(field: "media", filename: file.filename, mimeType: file.mimeType, data: file.data)
        case .video(let url):
            guard let data = try? Data(contentsOf: url) else { return nil }
            return UploadFile(field: "media", filename: "story.mp4", mimeType: "video/mp4", data: data)
        }
    }
}

/// A video from the library, copied out of Photos into a file of our own.
private struct ChatStoryMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let copy = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension(received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension)
            try FileManager.default.copyItem(at: received.file, to: copy)
            return ChatStoryMovie(url: copy)
        }
    }
}

enum ChatStoryVideo {
    /// Stories keep the first minute.
    static let maxSeconds: Double = 60

    /// Any video (the camera's and the library's are QuickTime) as an mp4 of
    /// at most a minute, at 720p, which the server takes and every phone plays.
    static func mp4(from source: URL) async -> URL? {
        let asset = AVURLAsset(url: source)
        guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720)
            ?? AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetMediumQuality) else { return nil }
        let output = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("mp4")
        session.outputURL = output
        session.outputFileType = .mp4
        session.shouldOptimizeForNetworkUse = true
        let seconds = (try? await asset.load(.duration).seconds) ?? 0
        if seconds.isFinite, seconds > maxSeconds {
            session.timeRange = CMTimeRange(start: .zero, duration: CMTime(seconds: maxSeconds, preferredTimescale: 600))
        }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            session.exportAsynchronously { continuation.resume() }
        }
        return session.status == .completed ? output : nil
    }
}

/// The camera, for a photo or a short video there and then.
struct ChatStoryCamera: UIViewControllerRepresentable {
    let onPhoto: (UIImage) -> Void
    let onVideo: (URL) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = [UTType.image.identifier, UTType.movie.identifier]
        picker.videoMaximumDuration = ChatStoryVideo.maxSeconds
        picker.videoQuality = .typeHigh
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: ChatStoryCamera
        init(_ parent: ChatStoryCamera) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let url = info[.mediaURL] as? URL {
                parent.onVideo(url)
            } else if let image = info[.originalImage] as? UIImage {
                parent.onPhoto(image)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

struct ChatStoryComposer: View {
    var onPosted: () -> Void = {}

    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var media: ChatStoryMedia?
    @State private var caption = ""
    @State private var pickerItem: PhotosPickerItem?
    @State private var showLibrary = false
    @State private var showCamera = false
    @State private var preparing = false
    @State private var problem: String?
    @State private var player: AVPlayer?

    var body: some View {
        SheetScaffold(
            L("New story"),
            subtitle: L("Everyone at the studio sees it for 24 hours."),
            symbol: "sparkles",
            primaryTitle: media == nil ? nil : L("Share to story"),
            primaryKind: .brand,
            isPrimaryEnabled: media != nil && !preparing,
            onPrimary: { await post() }
        ) {
            if let media {
                preview(media)
                    .transition(.neonPop)
                NeonTextField(L("Caption"), text: $caption, prompt: L("Add a caption (optional)"), symbol: "text.bubble")
                HStack(spacing: 10) {
                    NeonButton(L("Library"), symbol: "photo.on.rectangle", kind: .secondary, size: .medium) { showLibrary = true }
                    if CameraPicker.isAvailable {
                        NeonButton(L("Camera"), symbol: "camera", kind: .secondary, size: .medium) { showCamera = true }
                    }
                }
            } else if preparing {
                VStack(spacing: 12) {
                    ProgressView()
                    Text(L("Preparing the video…"))
                        .font(.system(size: 14))
                        .foregroundStyle(Color.neonTextSecondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 60)
            } else {
                sourceTiles
            }
            if let problem {
                StatusNote(symbol: "exclamationmark.triangle.fill", tone: .danger, title: problem, detail: nil)
            }
        }
        .neonSheet([.large])
        .animation(NeonMotion.smooth, value: media == nil)
        .photosPicker(isPresented: $showLibrary, selection: $pickerItem, matching: .any(of: [.images, .videos]))
        .fullScreenCover(isPresented: $showCamera) {
            ChatStoryCamera(
                onPhoto: { image in withNeonAnimation(NeonMotion.smooth) { setMedia(.photo(image)) } },
                onVideo: { url in Task { await prepareVideo(url) } }
            )
            .ignoresSafeArea()
        }
        .onChange(of: pickerItem) { item in
            guard let item else { return }
            pickerItem = nil
            Task { await load(item) }
        }
        .onDisappear { player?.pause() }
    }

    private var sourceTiles: some View {
        VStack(spacing: 12) {
            if CameraPicker.isAvailable {
                sourceTile(L("Camera"), detail: L("Take a photo or a video"), symbol: "camera.fill",
                           gradient: [.neonPink, .neonOrange]) { showCamera = true }
            }
            sourceTile(L("Photo library"), detail: L("Pick a photo or a video up to a minute"), symbol: "photo.on.rectangle.angled",
                       gradient: [Color(hex: 0x6366F1), .neonPurple]) { showLibrary = true }
        }
        .neonAppear()
    }

    private func sourceTile(_ title: String, detail: String, symbol: String, gradient: [Color], action: @escaping () -> Void) -> some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            HStack(spacing: 14) {
                Image(systemName: symbol)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 54, height: 54)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(LinearGradient(colors: gradient, startPoint: .topLeading, endPoint: .bottomTrailing)))
                    .shadow(color: gradient[0].opacity(0.35), radius: 10, y: 5)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 17, weight: .semibold)).foregroundStyle(Color.neonInk)
                    Text(detail).font(.system(size: 13)).foregroundStyle(Color.neonTextSecondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.forward").font(.system(size: 13, weight: .semibold)).foregroundStyle(Color.neonTextFaint)
            }
            .padding(16)
            .neonSurface(.strong, radius: NeonRadius.lg)
        }
        .buttonStyle(.pressableCard)
    }

    @ViewBuilder
    private func preview(_ media: ChatStoryMedia) -> some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.xl, style: .continuous)
        Group {
            switch media {
            case .photo(let image):
                Image(uiImage: image).resizable().scaledToFill()
            case .video:
                if let player {
                    VideoPlayer(player: player)
                } else {
                    Color.black
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 420)
        .background(Color.black)
        .clipShape(shape)
        .overlay(shape.strokeBorder(Color.white, lineWidth: 1))
        .neonShadow(.card)
    }

    private func setMedia(_ value: ChatStoryMedia) {
        problem = nil
        player?.pause()
        if case .video(let url) = value {
            let next = AVPlayer(url: url)
            next.isMuted = true
            player = next
            next.play()
        } else {
            player = nil
        }
        media = value
        Haptic.soft()
    }

    private func load(_ item: PhotosPickerItem) async {
        problem = nil
        if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
            preparing = true
            defer { preparing = false }
            guard let movie = try? await item.loadTransferable(type: ChatStoryMovie.self) else {
                problem = L("That video could not be read.")
                return
            }
            await prepareVideo(movie.url)
        } else {
            guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
                problem = L("That photo could not be read.")
                return
            }
            withNeonAnimation(NeonMotion.smooth) { setMedia(.photo(image)) }
        }
    }

    private func prepareVideo(_ url: URL) async {
        preparing = true
        defer { preparing = false }
        guard let mp4 = await ChatStoryVideo.mp4(from: url) else {
            problem = L("That video could not be read.")
            return
        }
        withNeonAnimation(NeonMotion.smooth) { setMedia(.video(mp4)) }
    }

    private func post() async {
        guard let file = media?.upload else {
            problem = L("That photo could not be read.")
            return
        }
        do {
            try await api.postChatStory(media: file, caption: caption)
            Haptic.success()
            Toast.success(L("Shared to your story"))
            player?.pause()
            onPosted()
            dismiss()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

// MARK: - Who saw it

struct ChatStoryViewersSheet: View {
    let storyId: String

    @EnvironmentObject private var api: APIClient
    @State private var viewers: [ChatStoryViewer]?
    @State private var problem: String?

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(L("Seen by"), subtitle: viewers.map { L("%d people", $0.count) }, symbol: "eye")
            ScrollView {
                VStack(spacing: 8) {
                    if let viewers {
                        if viewers.isEmpty {
                            EmptyState(symbol: "eye.slash", title: L("No one has seen it yet"))
                        }
                        ForEach(Array(viewers.enumerated()), id: \.element.id) { index, viewer in
                            HStack(spacing: 12) {
                                ChatAvatar(url: viewer.avatarURL, name: viewer.name, size: 44)
                                DirText(viewer.name, font: .system(size: 16, weight: .semibold), lineLimit: 1)
                                Text(chatTimeAgo(viewer.viewedAt))
                                    .font(.system(size: 13))
                                    .foregroundStyle(Color.neonTextTertiary)
                            }
                            .padding(12)
                            .neonSurface(.strong, radius: NeonRadius.md)
                            .staggered(index)
                        }
                    } else if let problem {
                        ErrorState(message: problem) { await load() }
                    } else {
                        SkeletonRows(count: 3)
                    }
                }
                .padding(NeonSpace.gutter)
            }
        }
        .task { await load() }
        .neonSheet([.medium, .large])
    }

    private func load() async {
        do {
            viewers = try await api.fetchChatStoryViewers(storyId: storyId)
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }
}

/// "5m", "2h" — how long ago, short, in the app's language.
func chatTimeAgo(_ iso: String?) -> String {
    guard let date = parseISODate(iso) else { return "" }
    let formatter = RelativeDateTimeFormatter()
    formatter.locale = AppLanguage.current.locale
    formatter.unitsStyle = .abbreviated
    if Date().timeIntervalSince(date) < 60 { return L("Just now") }
    return formatter.localizedString(for: date, relativeTo: Date())
}
