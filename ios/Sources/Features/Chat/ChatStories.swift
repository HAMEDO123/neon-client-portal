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

/// The row under the header, as in the owner's mockup: My Story first (a
/// "+" to add one), then everybody with a live story — a colourful ring
/// while there is something new, grey once it is all seen — and then whoever
/// is here right now, with their green dot, each opening that chat. Nobody
/// else: they are the cards just below, and the rail would only repeat them.
/// With no stories and nobody here it is My Story alone, not padded out.
struct ChatStoriesRail: View {
    let stories: ChatStoriesResponse?
    let isLoading: Bool
    let myName: String
    let isManager: Bool
    /// My own face (`APIClient.myPhoto`), or nil for my initials — or, for
    /// the manager, the studio's mark.
    var myPhoto: URL? = nil
    /// Every conversation without a live story, whoever is here first.
    let people: [ConversationSummary]
    /// Whether an author ("admin" or an employee id) is here right now.
    let isOnline: (String) -> Bool
    let onOpen: (ChatStoryRing) -> Void
    let onCompose: () -> Void
    let onOpenChat: (ConversationSummary) -> Void

    /// The ring's size; the name sits under it.
    static let bubble: CGFloat = 64

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: NeonSpace.md) {
                myStory
                if let others = stories?.others {
                    ForEach(Array(others.enumerated()), id: \.element.id) { index, ring in
                        Button {
                            Haptic.tap()
                            onOpen(ring)
                        } label: {
                            ChatStoryBubble(
                                name: ring.name,
                                ring: ring.allViewed ? .seen : .unseen,
                                online: isOnline(ring.authorKey)
                            ) { size in
                                ChatStoryFace(ring: ring, size: size)
                            }
                        }
                        .buttonStyle(PressableStyle(scale: 0.92))
                        .staggered(index + 1)
                        .accessibilityHint(ring.allViewed ? L("Seen") : L("New story"))
                    }
                } else if isLoading {
                    ForEach(0..<3, id: \.self) { index in
                        VStack(spacing: 6) {
                            Circle().fill(Color.neonInk.opacity(0.07)).frame(width: Self.bubble, height: Self.bubble)
                            SkeletonBlock(width: 48, height: 10)
                        }
                        .shimmer()
                        .staggered(index + 1)
                    }
                }
                ForEach(Array(people.enumerated()), id: \.element.id) { index, conversation in
                    Button {
                        Haptic.tap()
                        onOpenChat(conversation)
                    } label: {
                        ChatStoryBubble(name: conversation.title, ring: .none, online: conversation.online == true) { size in
                            ChatConversationAvatar(conversation: conversation, size: size, showsOnline: false)
                        }
                    }
                    .buttonStyle(PressableStyle(scale: 0.92))
                    .staggered(index + (stories?.others.count ?? 0) + 1)
                    .accessibilityHint(L("Opens the chat"))
                }
            }
            .padding(.horizontal, NeonSpace.gutter)
            .padding(.vertical, 4)
        }
    }

    private var mine: ChatStoryRing? {
        guard let ring = stories?.mine, !ring.stories.isEmpty else { return nil }
        return ring
    }

    private var myStory: some View {
        let size = Self.bubble
        return ZStack(alignment: .topTrailing) {
            Button {
                Haptic.tap()
                if let mine { onOpen(mine) } else { onCompose() }
            } label: {
                ChatStoryBubble(name: L("My Story"), ring: mine == nil ? .none : .unseen, showsAdd: true) { inner in
                    if let mine {
                        ChatStoryFace(ring: mine, size: inner)
                    } else if let myPhoto {
                        ChatAvatar(url: myPhoto, name: isManager ? L("Manager") : myName, size: inner)
                    } else if isManager {
                        ChatStudioMark(size: inner)
                    } else {
                        ChatAvatar(url: nil, name: myName, size: inner)
                    }
                }
            }
            .buttonStyle(PressableStyle(scale: 0.92))
            .accessibilityLabel(mine == nil ? L("Add to your story") : L("Your story"))

            // The "+" adds another even while one is up; the face opens what is there.
            Button {
                Haptic.impact(.light)
                onCompose()
            } label: {
                Color.clear
                    .frame(width: size * 0.46, height: size * 0.46)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .padding(.top, size * 0.58)
            .accessibilityLabel(L("Add to your story"))
        }
        .staggered(0)
    }
}

/// One face in the rail: its ring, the picture inside it, the green dot or
/// the "+", and the name under it. The kit's StoryAvatar, with the picture
/// supplied — the studio's mark, a story's photo, a face in its own colour.
struct ChatStoryBubble<Picture: View>: View {
    let name: String
    var ring: StoryRingStyle
    var online = false
    var showsAdd = false
    var size: CGFloat = ChatStoriesRail.bubble
    @ViewBuilder let picture: (CGFloat) -> Picture

    var body: some View {
        let ringWidth = max(2.5, size * 0.045)
        let inner = size - ringWidth * 2 - size * 0.07
        VStack(spacing: 6) {
            ZStack {
                switch ring {
                case .none:
                    Circle().fill(Color.white).neonShadow(.low)
                case .unseen:
                    Circle().strokeBorder(AngularGradient.neonStory, lineWidth: ringWidth)
                case .seen:
                    Circle().strokeBorder(Color.neonLineStrong, lineWidth: ringWidth)
                }
                picture(inner)
                    .frame(width: inner, height: inner)
                    .clipShape(Circle())
                    .opacity(ring == .seen ? 0.9 : 1)
            }
            .frame(width: size, height: size)
            .overlay(alignment: .bottomTrailing) {
                if showsAdd {
                    Image(systemName: "plus")
                        .font(.system(size: size * 0.17, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: size * 0.34, height: size * 0.34)
                        .background(Circle().fill(LinearGradient.neonAction))
                        .overlay(Circle().strokeBorder(Color.white, lineWidth: max(2, size * 0.04)))
                        .neonShadow(.glow(.neonIndigo))
                        .offset(x: size * 0.02, y: size * 0.02)
                } else if online {
                    OnlineDot(size: size * 0.26)
                        .offset(x: -size * 0.02, y: -size * 0.02)
                }
            }
            DirText(name, font: .system(.footnote, weight: ring == .unseen ? .semibold : .medium),
                    color: ring == .seen ? .neonTextSecondary : .neonInk.opacity(0.85), fill: false, lineLimit: 1)
        }
        .frame(width: size + 12)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: name))
        .accessibilityValue(online ? Text(L("Online now")) : Text(""))
    }
}

/// Inside a story ring: the newest photo of the ring, the way WhatsApp's
/// updates show the latest one, over the author's face (which stays when the
/// newest is a video, or while the photo loads).
struct ChatStoryFace: View {
    let ring: ChatStoryRing
    let size: CGFloat

    var body: some View {
        ZStack {
            if ring.authorKey == "admin" && ChatFace(url: ring.avatarURL).photo == nil {
                ChatStudioMark(size: size)
            } else {
                ChatAvatar(url: ring.avatarURL, name: ring.name, size: size)
            }
            if let latest = ring.stories.last, !latest.isVideo {
                PipelineImage(url: latest.mediaURL, points: size)
                    .frame(width: size, height: size)
                    .clipShape(Circle())
            }
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Posting

/// The picked media, ready to send: a photo, or a video already turned into mp4.
private enum ChatStoryMedia {
    case photo(UIImage)
    case video(URL)

    var isVideo: Bool {
        if case .video = self { return true }
        return false
    }

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
            subtitle: L("The studio sees it for 24 hours"),
            symbol: "plus.circle.fill",
            primaryTitle: media == nil ? nil : L("Share to story"),
            primaryKind: .brand,
            isPrimaryEnabled: media != nil && !preparing,
            onPrimary: { await post() }
        ) {
            if let media {
                preview(media)
                    .transition(.neonPop)
                FormSection {
                    NeonTextField(L("Caption"), text: $caption, prompt: L("Add a caption (optional)"), symbol: "text.bubble")
                }
                HStack(spacing: 10) {
                    NeonButton(L("Library"), symbol: "photo.on.rectangle", kind: .secondary, size: .medium) { showLibrary = true }
                    if CameraPicker.isAvailable {
                        NeonButton(L("Camera"), symbol: "camera", kind: .secondary, size: .medium) { showCamera = true }
                    }
                }
            } else if preparing {
                VStack(spacing: 14) {
                    IconTile("film", hue: .purple, size: 56)
                        .neonPulse()
                    Text(L("Preparing the video…"))
                        .font(.neonLabel)
                        .foregroundStyle(Color.neonTextSecondary)
                    ProgressView().tint(.neonPurple)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 48)
                .neonSurface(.glass, radius: NeonRadius.lg)
                .transition(.neonPop)
            } else {
                sourceTiles
            }
            if let problem {
                StatusNote(symbol: "exclamationmark.triangle.fill", tone: .danger, title: problem, detail: nil)
                    .transition(.neonRise)
            }
        }
        .neonSheet([.large])
        .animation(NeonMotion.smooth, value: media == nil)
        .animation(NeonMotion.smooth, value: preparing)
        .photosPicker(isPresented: $showLibrary, selection: $pickerItem, matching: .any(of: [.images, .videos]))
        .fullScreenCover(isPresented: $showCamera) {
            // The full-screen story camera: the photo it hands back is exactly
            // what its preview showed, shaped like the screen, so the story
            // fills the screen with nothing cut that wasn't seen.
            NeonCameraView(
                purpose: .story,
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

    /// Where the story comes from: two big tiles in the kit's colours.
    private var sourceTiles: some View {
        VStack(spacing: NeonSpace.stack) {
            if CameraPicker.isAvailable {
                sourceTile(L("Camera"), detail: L("Take a photo or a video"), symbol: "camera.fill", hue: .pink) { showCamera = true }
            }
            sourceTile(L("Photo library"), detail: L("Pick a photo or a video up to a minute"), symbol: "photo.on.rectangle.angled",
                       hue: .indigo) { showLibrary = true }
            // The 24 hours are in the header; what is left to say is who sees the views.
            MetaLabel(L("Only you see who viewed yours."), symbol: "eye", tint: .neonTextSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 6)
                .padding(.top, 2)
        }
    }

    private func sourceTile(_ title: String, detail: String, symbol: String, hue: NeonHue, action: @escaping () -> Void) -> some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            ChatListActionTile(title: title, detail: detail, symbol: symbol, hue: hue)
        }
        .buttonStyle(.pressableCard)
    }

    @ViewBuilder
    private func preview(_ media: ChatStoryMedia) -> some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.xl, style: .continuous)
        // Shaped like this phone's screen and drawn the way the story screen
        // draws it, so what is shown here is what everybody will see — not a
        // crop of it.
        let screen = UIScreen.main.bounds.size
        Group {
            switch media {
            case .photo(let image):
                ChatStoryPhoto(image: image)
            case .video:
                if let player {
                    VideoPlayer(player: player)
                } else {
                    Color.black
                }
            }
        }
        .aspectRatio(screen.width / max(screen.height, 1), contentMode: .fit)
        .frame(maxHeight: 520)
        .frame(maxWidth: .infinity)
        .background(Color.black)
        .clipShape(shape)
        .overlay(shape.strokeBorder(Color.white, lineWidth: 2))
        .overlay(alignment: .topLeading) {
            Label(media.isVideo ? L("Video") : L("Photo"), systemImage: media.isVideo ? "video.fill" : "photo.fill")
                .font(.system(.caption, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Capsule().fill(.ultraThinMaterial))
                .environment(\.colorScheme, .dark)
                .padding(12)
        }
        .neonShadow(.raised)
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
            SheetHeader(L("Seen by"), subtitle: viewers.map { ChatCount.people($0.count) }, symbol: "eye.fill")
            ScrollView {
                VStack(alignment: .leading, spacing: NeonSpace.stack) {
                    if let viewers {
                        if viewers.isEmpty {
                            EmptyState(symbol: "eye.slash", title: L("No one has seen it yet"),
                                       detail: L("Whoever opens it appears here, with when they saw it."), hue: .purple, card: true)
                        } else {
                            CardList(viewers, dividerInset: 66) { viewer in
                                HStack(spacing: NeonSpace.md) {
                                    ChatAvatar(url: viewer.avatarURL, name: viewer.name, size: 42)
                                    DirText(viewer.name, font: .neonRowTitle, fill: false, lineLimit: 1)
                                    Spacer(minLength: 8)
                                    Text(chatTimeAgo(viewer.viewedAt))
                                        .font(.neonMeta)
                                        .foregroundStyle(Color.neonTextTertiary)
                                        .fixedSize()
                                }
                                .padding(.horizontal, NeonSpace.card)
                                .padding(.vertical, 10)
                                .accessibilityElement(children: .combine)
                            }
                            .neonAppear()
                        }
                    } else if let problem {
                        ErrorState(message: problem) { await load() }
                    } else {
                        SkeletonRows(count: 3)
                    }
                }
                .padding(.horizontal, NeonSpace.gutter)
                .padding(.bottom, NeonSpace.xxl)
            }
            .refreshable { await load() }
        }
        .background(NeonAmbient().ignoresSafeArea())
        .task { await load() }
        .neonSheet([.medium, .large])
    }

    private func load() async {
        do {
            let loaded = try await api.fetchChatStoryViewers(storyId: storyId)
            withNeonAnimation(NeonMotion.smooth) { viewers = loaded }
            problem = nil
        } catch {
            if viewers == nil { problem = error.localizedDescription }
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
