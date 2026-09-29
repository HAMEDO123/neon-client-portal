import AVFoundation
import SwiftUI

/// The full-screen story viewer, the way Instagram and Snapchat do it: a
/// segmented bar per story, tap the trailing side for the next and the leading
/// side for the previous, hold to pause, swipe down to close. It runs through
/// every ring it is given, starting at `startRing`. The author sees how many
/// people saw each story, who, and can delete it.
struct ChatStoryPlayer: View {
    let myKey: String
    var onClose: () -> Void = {}
    /// Opens the author's chat, for somebody else's story: the list closes the
    /// viewer and pushes the conversation. nil when there is no chat to open.
    var onMessage: ((ChatStoryRing) -> Void)?
    /// A still for the debug router's screenshots: nothing is marked seen and
    /// nothing moves on by itself.
    var isPreview = false

    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var rings: [ChatStoryRing]
    @State private var ringIndex: Int
    @State private var storyIndex: Int
    @State private var progress: Double = 0
    @State private var ready = false
    @State private var image: UIImage?
    @State private var mediaFailed = false
    @State private var player: AVPlayer?
    @State private var holding = false
    /// A press held past a tap's length: the controls step aside and the pause shows.
    @State private var longHold = false
    @State private var pressStart: Date?
    @State private var dragOffset: CGFloat = 0
    @State private var viewersFor: ViewersTarget?
    @State private var confirmDelete = false
    @State private var restartToken = 0
    @State private var closing = false

    private struct ViewersTarget: Identifiable { let id: String }

    /// How long a photo stays up.
    private let photoSeconds: Double = 5

    init(
        rings: [ChatStoryRing],
        startRing: Int,
        myKey: String,
        isPreview: Bool = false,
        onMessage: ((ChatStoryRing) -> Void)? = nil,
        onClose: @escaping () -> Void = {}
    ) {
        self.myKey = myKey
        self.onClose = onClose
        self.onMessage = onMessage
        self.isPreview = isPreview
        let start = min(max(startRing, 0), max(rings.count - 1, 0))
        _rings = State(initialValue: rings)
        _ringIndex = State(initialValue: start)
        let ring = rings.indices.contains(start) ? rings[start] : nil
        _storyIndex = State(initialValue: ring.map { $0.authorKey == myKey ? 0 : $0.firstUnviewedIndex } ?? 0)
    }

    private var ring: ChatStoryRing? { rings.indices.contains(ringIndex) ? rings[ringIndex] : nil }
    private var story: ChatStory? {
        guard let ring, ring.stories.indices.contains(storyIndex) else { return nil }
        return ring.stories[storyIndex]
    }
    private var isMine: Bool { ring?.authorKey == myKey }
    private var paused: Bool { holding || viewersFor != nil || confirmDelete || closing }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color.black.ignoresSafeArea()
                media
                    .id(story?.id)
                    .transition(.opacity)

                // Shades so the white bars, names and caption read on any picture.
                LinearGradient(colors: [.black.opacity(0.6), .black.opacity(0.2), .clear], startPoint: .top, endPoint: .center)
                    .allowsHitTesting(false)
                    .ignoresSafeArea()
                LinearGradient(colors: [.clear, .black.opacity(0.25), .black.opacity(0.65)], startPoint: .center, endPoint: .bottom)
                    .allowsHitTesting(false)
                    .ignoresSafeArea()

                // The gesture surface sits under the controls, so buttons still work.
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(pressGesture(width: proxy.size.width))

                VStack(spacing: NeonSpace.md) {
                    progressBars
                    header
                    Spacer()
                    footer
                }
                .padding(.horizontal, NeonSpace.md)
                .padding(.top, NeonSpace.sm)
                .padding(.bottom, NeonSpace.md)
                .opacity(longHold ? 0 : 1)
                .animation(NeonMotion.quick, value: longHold)

                if longHold {
                    Image(systemName: "pause.fill")
                        .font(.system(.title2, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 64, height: 64)
                        .background(Circle().fill(.ultraThinMaterial))
                        .environment(\.colorScheme, .dark)
                        .transition(.neonPop)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .offset(y: dragOffset)
            .scaleEffect(1 - min(dragOffset, 400) / 2400)
            .id(ring?.id)
            .transition(.asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .leading)))
            .animation(NeonMotion.snappy, value: longHold)
        }
        .background(Color.black.opacity(1 - Double(min(dragOffset, 400)) / 600).ignoresSafeArea())
        .statusBarHidden(true)
        .task(id: "\(story?.id ?? "")#\(restartToken)") { await run() }
        .onChange(of: paused) { isPaused in
            if isPaused { player?.pause() } else if ready { player?.play() }
        }
        .onDisappear {
            player?.pause()
            onClose()
        }
        .sheet(item: $viewersFor) { target in
            ChatStoryViewersSheet(storyId: target.id)
        }
        .confirmationDialog(L("Delete this story?"), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(L("Delete"), role: .destructive) { Task { await deleteCurrent() } }
            Button(L("Cancel"), role: .cancel) {}
        } message: {
            Text(L("It disappears for everyone now."))
        }
    }

    // MARK: - Pieces

    @ViewBuilder
    private var media: some View {
        if let story {
            if story.isVideo, let player {
                ChatStoryVideoLayer(player: player).ignoresSafeArea()
            } else if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .ignoresSafeArea()
            } else if mediaFailed {
                VStack(spacing: NeonSpace.md) {
                    IconTile("exclamationmark.triangle.fill", hue: .orange, size: 56, style: .filled)
                    Text(L("This story could not be loaded."))
                        .font(.system(.callout, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.9))
                }
            } else {
                ZStack {
                    if let ring {
                        ChatStoryFace(ring: ring, size: 96)
                            .blur(radius: 18)
                            .opacity(0.5)
                    }
                    ProgressView().tint(.white).scaleEffect(1.3)
                }
            }
        }
    }

    private var progressBars: some View {
        HStack(spacing: 4) {
            ForEach(Array((ring?.stories ?? []).enumerated()), id: \.element.id) { index, _ in
                GeometryReader { bar in
                    Capsule()
                        .fill(Color.white.opacity(0.3))
                        .overlay(alignment: .leading) {
                            Capsule()
                                .fill(Color.white)
                                .frame(width: bar.size.width * fill(for: index))
                                .shadow(color: .white.opacity(0.6), radius: 2)
                        }
                }
                .frame(height: 3)
            }
        }
        .shadow(color: .black.opacity(0.25), radius: 3, y: 1)
        .accessibilityHidden(true)
    }

    private func fill(for index: Int) -> CGFloat {
        if index < storyIndex { return 1 }
        if index > storyIndex { return 0 }
        return CGFloat(min(max(progress, 0), 1))
    }

    private var header: some View {
        HStack(spacing: 10) {
            if let ring {
                ZStack {
                    Circle().strokeBorder(AngularGradient.neonStory, lineWidth: 2)
                    if ring.authorKey == "admin" && ChatFace(url: ring.avatarURL).photo == nil {
                        ChatStudioMark(size: 34)
                    } else {
                        ChatAvatar(url: ring.avatarURL, name: ring.name, size: 34)
                    }
                }
                .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 1) {
                    DirText(isMine ? L("Your story") : ring.name, font: .system(.subheadline, weight: .bold), color: .white, fill: false, lineLimit: 1)
                    if let story {
                        HStack(spacing: 5) {
                            Text(chatTimeAgo(story.createdAt))
                            if ring.stories.count > 1 {
                                Text(verbatim: "·")
                                Text(L("%d of %d", storyIndex + 1, ring.stories.count))
                            }
                            if story.isVideo {
                                Image(systemName: "video.fill").font(.system(.caption2, weight: .bold))
                            }
                        }
                        .font(.system(.caption, weight: .medium))
                        .foregroundStyle(.white.opacity(0.8))
                    }
                }
                .shadow(color: .black.opacity(0.35), radius: 4)
            }
            Spacer(minLength: 8)
            if isMine {
                storyButton("trash", label: L("Delete")) { confirmDelete = true }
            }
            storyButton("xmark", label: L("Close")) { close() }
        }
    }

    @ViewBuilder
    private var footer: some View {
        VStack(spacing: NeonSpace.md) {
            if let caption = story?.caption, !caption.isEmpty {
                DirText(caption, font: .system(.body, weight: .medium), color: .white, lineLimit: 4)
                    .padding(.horizontal, NeonSpace.lg)
                    .padding(.vertical, NeonSpace.md)
                    .background(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous).fill(.ultraThinMaterial))
                    .environment(\.colorScheme, .dark)
                    .transition(.neonRise)
                    .id(story?.id)
            }
            if isMine, let story {
                Button {
                    Haptic.tap()
                    viewersFor = ViewersTarget(id: story.id)
                } label: {
                    footerCapsule(symbol: "eye.fill", title: L("%d views", story.viewCount ?? 0), trailing: "chevron.up")
                }
                .buttonStyle(PressableStyle(scale: 0.94))
                .accessibilityHint(L("Shows who has seen it"))
            } else if let ring, let onMessage {
                Button {
                    Haptic.tap()
                    closing = true
                    player?.pause()
                    onMessage(ring)
                } label: {
                    footerCapsule(symbol: "bubble.left.fill", title: L("Message %@", ring.name), trailing: nil)
                }
                .buttonStyle(PressableStyle(scale: 0.94))
            }
        }
        .animation(NeonMotion.smooth, value: story?.id)
    }

    /// A frosted capsule at the foot of the story: views for the author, a
    /// way into the chat for everybody else.
    private func footerCapsule(symbol: String, title: String, trailing: String?) -> some View {
        HStack(spacing: 7) {
            Image(systemName: symbol)
            Text(title).lineLimit(1)
            if let trailing {
                Image(systemName: trailing).font(.system(.caption2, weight: .bold))
            }
        }
        .font(.system(.subheadline, weight: .semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, NeonSpace.lg + 2)
        .frame(minHeight: NeonSize.touch)
        .background(Capsule().fill(.ultraThinMaterial))
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.22), lineWidth: 1))
        .environment(\.colorScheme, .dark)
    }

    private func storyButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            // A white glyph makes the kit's round button the dark frosted disc.
            IconButtonLabel(symbol, tint: .white, size: 38)
        }
        .buttonStyle(PressableStyle(scale: 0.88))
        .accessibilityLabel(label)
    }

    // MARK: - Gestures

    /// One gesture for all three: a quick tap moves, holding pauses, dragging
    /// down closes.
    private func pressGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if pressStart == nil {
                    let started = Date()
                    pressStart = started
                    holding = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        if holding, pressStart == started { longHold = true }
                    }
                }
                let down = value.translation.height
                if down > 0, abs(down) > abs(value.translation.width) {
                    dragOffset = down
                }
            }
            .onEnded { value in
                let held = Date().timeIntervalSince(pressStart ?? Date())
                pressStart = nil
                holding = false
                longHold = false
                if dragOffset > 120 || value.predictedEndTranslation.height > 320 {
                    close()
                    return
                }
                withNeonAnimation(NeonMotion.snappy) { dragOffset = 0 }
                let moved = abs(value.translation.width) + abs(value.translation.height)
                guard held < 0.3, moved < 12 else { return }
                // The location is in the view's own space, which the layout
                // direction mirrors: the leading third always goes back.
                if value.location.x < width / 3 { previous() } else { next() }
            }
    }

    // MARK: - Playing

    private func run() async {
        guard let story else { return }
        progress = 0
        ready = false
        image = nil
        mediaFailed = false
        player?.pause()
        player = nil
        markViewed(story)

        if story.isVideo, let url = story.mediaURL {
            let next = AVPlayer(url: url)
            player = next
            ready = true
            if !paused { next.play() }
        } else if let url = story.mediaURL {
            if let loaded = await ImagePipeline.shared.image(url, pixels: 1600) {
                guard !Task.isCancelled else { return }
                image = loaded
            } else {
                mediaFailed = true
            }
            ready = true
        } else {
            mediaFailed = true
            ready = true
        }

        var last = Date()
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 33_000_000)
            let now = Date()
            let elapsed = now.timeIntervalSince(last)
            last = now
            guard ready, !paused else { continue }
            if isPreview {
                progress = 0.4
                continue
            }
            if story.isVideo, let player, let item = player.currentItem {
                if item.status == .failed {
                    mediaFailed = true
                    progress += elapsed / photoSeconds
                } else {
                    let total = item.duration.seconds
                    guard total.isFinite, total > 0 else { continue }
                    progress = player.currentTime().seconds / total
                    if player.rate == 0 && item.status == .readyToPlay && progress < 0.98 { player.play() }
                }
            } else {
                progress += elapsed / photoSeconds
            }
            if progress >= 0.999 {
                next()
                return
            }
        }
    }

    private func markViewed(_ story: ChatStory) {
        guard !isPreview, !isMine, !story.viewed else { return }
        let ringAt = ringIndex
        let storyAt = storyIndex
        rings[ringAt].stories[storyAt].viewed = true
        rings[ringAt].allViewed = rings[ringAt].stories.allSatisfy(\.viewed)
        Task { await api.markChatStoryViewed(id: story.id) }
    }

    private func next() {
        guard let ring else { return close() }
        if storyIndex + 1 < ring.stories.count {
            storyIndex += 1
        } else if ringIndex + 1 < rings.count {
            Haptic.soft()
            withNeonAnimation(NeonMotion.smooth) {
                ringIndex += 1
                storyIndex = rings[ringIndex].authorKey == myKey ? 0 : rings[ringIndex].firstUnviewedIndex
            }
        } else {
            close()
        }
    }

    private func previous() {
        if storyIndex > 0 {
            storyIndex -= 1
        } else if ringIndex > 0 {
            Haptic.soft()
            withNeonAnimation(NeonMotion.smooth) {
                ringIndex -= 1
                storyIndex = max(rings[ringIndex].stories.count - 1, 0)
            }
        } else {
            restartToken += 1
        }
    }

    private func close() {
        guard !closing else { return }
        closing = true
        player?.pause()
        dismiss()
    }

    private func deleteCurrent() async {
        guard let story else { return }
        do {
            try await api.deleteChatStory(id: story.id)
            Haptic.success()
            Toast.success(L("Story deleted"))
            rings[ringIndex].stories.removeAll { $0.id == story.id }
            if rings[ringIndex].stories.isEmpty {
                close()
            } else {
                storyIndex = min(storyIndex, rings[ringIndex].stories.count - 1)
                restartToken += 1
            }
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

/// A player's picture, fitted, with no controls — the story's own bars are the controls.
private struct ChatStoryVideoLayer: UIViewRepresentable {
    let player: AVPlayer

    final class LayerView: UIView {
        override static var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    func makeUIView(context: Context) -> LayerView {
        let view = LayerView()
        view.backgroundColor = .black
        view.playerLayer.videoGravity = .resizeAspect
        view.playerLayer.player = player
        return view
    }

    func updateUIView(_ uiView: LayerView, context: Context) {
        if uiView.playerLayer.player !== player { uiView.playerLayer.player = player }
    }
}
