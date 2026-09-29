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
    @State private var pressStart: Date?
    @State private var dragOffset: CGFloat = 0
    @State private var viewersFor: ViewersTarget?
    @State private var confirmDelete = false
    @State private var restartToken = 0
    @State private var closing = false

    private struct ViewersTarget: Identifiable { let id: String }

    /// How long a photo stays up.
    private let photoSeconds: Double = 5

    init(rings: [ChatStoryRing], startRing: Int, myKey: String, onClose: @escaping () -> Void = {}) {
        self.myKey = myKey
        self.onClose = onClose
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

                LinearGradient(colors: [.black.opacity(0.55), .clear], startPoint: .top, endPoint: .center)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .allowsHitTesting(false)
                    .ignoresSafeArea()
                LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .center, endPoint: .bottom)
                    .allowsHitTesting(false)
                    .ignoresSafeArea()

                // The gesture surface sits under the controls, so buttons still work.
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(pressGesture(width: proxy.size.width))

                VStack(spacing: 10) {
                    progressBars
                    header
                    Spacer()
                    footer
                }
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .padding(.bottom, 12)
                .opacity(holding ? 0 : 1)
                .animation(NeonMotion.quick, value: holding)
            }
            .offset(y: dragOffset)
            .scaleEffect(1 - min(dragOffset, 400) / 2400)
            .id(ring?.id)
            .transition(.asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .leading)))
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
                VStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle").font(.system(size: 30))
                    Text(L("This story could not be loaded.")).font(.system(size: 15, weight: .medium))
                }
                .foregroundStyle(.white.opacity(0.8))
            } else {
                ProgressView().tint(.white).scaleEffect(1.2)
            }
        }
    }

    private var progressBars: some View {
        HStack(spacing: 4) {
            ForEach(Array((ring?.stories ?? []).enumerated()), id: \.element.id) { index, _ in
                GeometryReader { bar in
                    Capsule()
                        .fill(Color.white.opacity(0.32))
                        .overlay(alignment: .leading) {
                            Capsule()
                                .fill(Color.white)
                                .frame(width: bar.size.width * fill(for: index))
                        }
                }
                .frame(height: 3)
            }
        }
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
                if ring.authorKey == "admin" && ring.avatar == nil {
                    ChatStudioMark(size: 38)
                } else {
                    ChatAvatar(url: ring.avatarURL, name: ring.name, size: 38)
                }
                VStack(alignment: .leading, spacing: 1) {
                    DirText(isMine ? L("Your story") : ring.name, font: .system(size: 15, weight: .semibold), color: .white, fill: false, lineLimit: 1)
                    if let story {
                        Text(chatTimeAgo(story.createdAt))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.white.opacity(0.75))
                    }
                }
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
        VStack(spacing: 12) {
            if let caption = story?.caption, !caption.isEmpty {
                DirText(caption, font: .system(size: 17, weight: .medium), color: .white, lineLimit: 4)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.black.opacity(0.35)))
                    .shadow(color: .black.opacity(0.4), radius: 6)
            }
            if isMine, let story {
                Button {
                    Haptic.tap()
                    viewersFor = ViewersTarget(id: story.id)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "eye.fill")
                        Text(L("%d views", story.viewCount ?? 0))
                        Image(systemName: "chevron.up").font(.system(size: 11, weight: .bold))
                    }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .frame(height: 38)
                    .background(Capsule().fill(.ultraThinMaterial))
                    .environment(\.colorScheme, .dark)
                }
                .buttonStyle(PressableStyle(scale: 0.94))
            }
        }
    }

    private func storyButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 38, height: 38)
                .background(Circle().fill(.black.opacity(0.28)))
        }
        .buttonStyle(PressableStyle(scale: 0.9))
        .accessibilityLabel(label)
    }

    // MARK: - Gestures

    /// One gesture for all three: a quick tap moves, holding pauses, dragging
    /// down closes.
    private func pressGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if pressStart == nil {
                    pressStart = Date()
                    holding = true
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
            if let (data, _) = try? await URLSession.shared.data(from: url), let loaded = UIImage(data: data) {
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
        guard !isMine, !story.viewed else { return }
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
