import AVFoundation
import SwiftUI

/// A video waiting to be sent: recorded here, or picked from the library.
struct ChatCameraVideo: Identifiable {
    let id = UUID()
    let asset: AVAsset
    /// The file on this phone, when there is one (a recording, or a copy of
    /// a picked video) — for saving to Photos, and deleted when done with.
    let fileURL: URL?
    /// Recorded in VIDEO NOTE: shown round, sent as a square video.
    let isNote: Bool
    /// From the library: no "save to Photos", it is already there.
    let fromLibrary: Bool
    /// Recorded for a story: the screen's short side over its long side,
    /// to cut it to what the full-screen preview showed.
    var screenShape: CGFloat?
}

/// The video after it is recorded or picked: it plays on a loop, a strip of
/// its frames trims it, and the same caption bar and green send button as a
/// photo send it — made into an MP4 that fits the server first, with the
/// ring on the send button filling as it does.
struct ChatVideoReview: View {
    let video: ChatCameraVideo
    let chatName: String
    @Binding var caption: String
    let onClose: () -> Void
    let onRetake: () -> Void
    let onSend: (UploadFile) -> Void
    /// For a story: no caption or chat, a Next button that hands back the
    /// video as an MP4 (cut to the preview's shape when recorded here).
    var forStory: ((URL) -> Void)?

    /// A story keeps a minute (ChatStoryVideo.maxSeconds).
    static let storySeconds: Double = 60

    @StateObject private var player = ChatLoopingPlayer()
    @State private var duration: Double = 0
    @State private var trim: ClosedRange<Double> = 0...0
    @State private var frames: [UIImage] = []
    @State private var sending = false
    @State private var progress: Double = 0
    @State private var work: Task<Void, Never>?
    @State private var saving = false
    @FocusState private var captionFocused: Bool

    private var trimmed: Bool { duration > 0 && (trim.lowerBound > 0.05 || trim.upperBound < duration - 0.05) }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            picture
                .ignoresSafeArea()
                .onTapGesture {
                    captionFocused = false
                    player.toggle()
                }

            if !player.isPlaying {
                Image(systemName: "play.fill")
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 72, height: 72)
                    .background(ChatCameraDisc())
                    .allowsHitTesting(false)
                    .transition(.neonPop)
            }

            VStack(spacing: 10) {
                HStack(spacing: 8) {
                    ChatCameraButton("xmark", label: L("Close")) {
                        work?.cancel()
                        onClose()
                    }
                    Spacer(minLength: 4)
                    if !video.fromLibrary, let url = video.fileURL {
                        ChatCameraButton(saving ? "ellipsis" : "arrow.down.to.line", label: L("Save to Photos")) {
                            guard !saving else { return }
                            saving = true
                            Task {
                                await ChatCameraUpload.save(videoAt: url)
                                saving = false
                            }
                        }
                    }
                }
                .padding(.horizontal, 12)

                if duration > 1.5 {
                    ChatTrimBar(duration: duration, range: $trim, frames: frames, longest: forStory == nil ? nil : Self.storySeconds) {
                        player.loop(range: trimmed ? cmRange : nil)
                    }
                    .padding(.horizontal, 16)
                    .disabled(sending)
                }

                Spacer(minLength: 0)

                if forStory != nil {
                    ChatCameraNextBar(isWorking: sending, progress: sending ? progress : nil, action: send)
                        .padding(.bottom, 4)
                } else {
                    ChatCameraCaptionBar(
                        caption: $caption,
                        chatName: chatName,
                        isSending: sending,
                        progress: sending ? progress : nil,
                        focused: $captionFocused,
                        onRetake: {
                            work?.cancel()
                            onRetake()
                        },
                        onSend: send
                    )
                    .padding(.bottom, 4)
                }
            }
            .padding(.top, 6)
            .padding(.bottom, 4)
        }
        .animation(NeonMotion.resolved(NeonMotion.quick), value: player.isPlaying)
        .task {
            player.start(video.asset)
            duration = (try? await video.asset.load(.duration))?.seconds ?? 0
            if duration.isFinite, duration > 0 {
                trim = 0...(forStory == nil ? duration : min(duration, Self.storySeconds))
                if trimmed { player.loop(range: cmRange) }
            } else {
                duration = 0
            }
            frames = await ChatVideoExport.frames(of: video.asset, count: 10, height: 44)
        }
        .onDisappear {
            player.stop()
            work?.cancel()
        }
    }

    @ViewBuilder
    private var picture: some View {
        if video.isNote {
            GeometryReader { geo in
                let side = min(geo.size.width - 40, geo.size.height * 0.55)
                ChatPlayerSurface(player: player.player, fill: true)
                    .frame(width: side, height: side)
                    .clipShape(Circle())
                    .overlay(Circle().strokeBorder(Color.white.opacity(0.2), lineWidth: 1))
                    .position(x: geo.size.width / 2, y: geo.size.height * 0.42)
            }
        } else {
            // A story recorded here is shown as it will be: cut to the screen.
            ChatPlayerSurface(player: player.player, fill: forStory != nil && video.screenShape != nil)
        }
    }

    private var cmRange: CMTimeRange {
        CMTimeRange(
            start: CMTime(seconds: trim.lowerBound, preferredTimescale: 600),
            end: CMTime(seconds: trim.upperBound, preferredTimescale: 600)
        )
    }

    private func send() {
        guard !sending else { return }
        captionFocused = false
        sending = true
        progress = 0
        player.pause()
        let range = trimmed ? cmRange : nil
        let square = video.isNote
        let asset = video.asset
        if let forStory {
            let shape = video.screenShape
            work = Task {
                do {
                    let url = try await ChatVideoExport.storyMP4(from: asset, range: range, screenShape: shape) { value in
                        progress = value
                    }
                    sending = false
                    forStory(url)
                } catch is CancellationError {
                    sending = false
                } catch {
                    sending = false
                    Haptic.error()
                    Toast.error(error)
                }
            }
            return
        }
        work = Task {
            do {
                let url = try await ChatVideoExport.mp4(from: asset, range: range, square: square) { value in
                    progress = value
                }
                defer { try? FileManager.default.removeItem(at: url) }
                let data = try Data(contentsOf: url)
                let file = UploadFile(field: "document", filename: Self.filename(note: square), mimeType: "video/mp4", data: data)
                sending = false
                onSend(file)
            } catch is CancellationError {
                sending = false
            } catch {
                sending = false
                Haptic.error()
                Toast.error(error)
            }
        }
    }

    /// "VID-20261001-143205.mp4", the way phones name a video.
    static func filename(note: Bool) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return "\(note ? "VIDNOTE" : "VID")-\(formatter.string(from: Date())).mp4"
    }
}

// MARK: - Playing

/// A video on a loop, inside a trimmed range when there is one.
@MainActor
final class ChatLoopingPlayer: ObservableObject {
    let player = AVQueuePlayer()
    @Published private(set) var isPlaying = false
    private var looper: AVPlayerLooper?
    private var asset: AVAsset?

    func start(_ asset: AVAsset) {
        self.asset = asset
        // Out of the speaker, not the earpiece the camera's recording left it
        // on — unless a call has the sound, which it keeps.
        if CallCenter.shared.session == nil {
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            try? AVAudioSession.sharedInstance().setActive(true)
        }
        loop(range: nil)
    }

    func loop(range: CMTimeRange?) {
        guard let asset else { return }
        player.pause()
        looper?.disableLooping()
        player.removeAllItems()
        let item = AVPlayerItem(asset: asset)
        if let range {
            looper = AVPlayerLooper(player: player, templateItem: item, timeRange: range)
        } else {
            looper = AVPlayerLooper(player: player, templateItem: item)
        }
        player.play()
        isPlaying = true
    }

    func toggle() {
        if isPlaying { pause() } else { player.play(); isPlaying = true }
    }

    func pause() {
        player.pause()
        isPlaying = false
    }

    func stop() {
        player.pause()
        looper?.disableLooping()
        looper = nil
        player.removeAllItems()
        isPlaying = false
    }
}

/// The picture of an AVPlayer.
struct ChatPlayerSurface: UIViewRepresentable {
    let player: AVPlayer
    /// Fill the frame (cropping) rather than fit inside it.
    var fill = false

    func makeUIView(context: Context) -> ChatPlayerLayerView {
        let view = ChatPlayerLayerView()
        view.backgroundColor = .clear
        view.playerLayer.player = player
        view.playerLayer.videoGravity = fill ? .resizeAspectFill : .resizeAspect
        return view
    }

    func updateUIView(_ view: ChatPlayerLayerView, context: Context) {
        view.playerLayer.videoGravity = fill ? .resizeAspectFill : .resizeAspect
    }
}

final class ChatPlayerLayerView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    // swiftlint:disable:next force_cast
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

// MARK: - Trimming

/// The video's frames in a row, with a yellow frame whose two ends are
/// dragged to keep only part of it; how long the kept part is, above.
struct ChatTrimBar: View {
    let duration: Double
    @Binding var range: ClosedRange<Double>
    let frames: [UIImage]
    /// The longest part that may be kept, if there is a limit.
    var longest: Double?
    /// The ends were let go: play the new part.
    let onCommit: () -> Void

    @State private var startValue: Double?

    private let height: CGFloat = 46
    private let handle: CGFloat = 14
    private let shortest = 1.0

    var body: some View {
        VStack(spacing: 6) {
            Text(verbatim: chatCameraClock(range.upperBound - range.lowerBound))
                .font(.system(.caption, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 3)
                .background(Capsule().fill(Color.black.opacity(0.45)))

            GeometryReader { geo in
                let width = geo.size.width - handle * 2
                let lowerX = handle + width * CGFloat(range.lowerBound / duration)
                let upperX = handle + width * CGFloat(range.upperBound / duration)
                ZStack(alignment: .topLeading) {
                    HStack(spacing: 0) {
                        ForEach(frames.indices, id: \.self) { index in
                            Image(uiImage: frames[index])
                                .resizable()
                                .scaledToFill()
                                .frame(width: width / CGFloat(max(frames.count, 1)), height: height)
                                .clipped()
                        }
                    }
                    .frame(width: width, height: height, alignment: .leading)
                    .background(Color.white.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .offset(x: handle)

                    // Outside the kept part, dimmed.
                    Rectangle().fill(Color.black.opacity(0.55))
                        .frame(width: max(0, lowerX - handle), height: height)
                        .offset(x: handle)
                    Rectangle().fill(Color.black.opacity(0.55))
                        .frame(width: max(0, handle + width - upperX), height: height)
                        .offset(x: upperX)

                    // The yellow frame.
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .strokeBorder(Color.neonAmber, lineWidth: 3)
                        .frame(width: upperX - lowerX + handle * 2, height: height)
                        .offset(x: lowerX - handle)
                        .allowsHitTesting(false)

                    end(isLower: true)
                        .offset(x: lowerX - handle)
                        .gesture(drag(isLower: true, width: width))
                    end(isLower: false)
                        .offset(x: upperX)
                        .gesture(drag(isLower: false, width: width))
                }
            }
            .frame(height: height)
        }
        .environment(\.layoutDirection, .leftToRight)
        .accessibilityElement()
        .accessibilityLabel(L("Trim"))
        .accessibilityValue(L("%@ of %@", chatCameraClock(range.upperBound - range.lowerBound), chatCameraClock(duration)))
    }

    private func end(isLower: Bool) -> some View {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(Color.neonAmber)
            .frame(width: handle, height: height)
            .overlay(
                Capsule().fill(Color.black.opacity(0.6)).frame(width: 3, height: 16)
            )
            .contentShape(Rectangle().inset(by: -12))
            .accessibilityHidden(true)
    }

    private func drag(isLower: Bool, width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if startValue == nil { startValue = isLower ? range.lowerBound : range.upperBound }
                guard let start = startValue, width > 0 else { return }
                let moved = start + Double(value.translation.width / width) * duration
                if isLower {
                    let lower = min(max(0, moved), range.upperBound - shortest)
                    // Past the limit, the other end follows.
                    let upper = longest.map { min(range.upperBound, lower + $0) } ?? range.upperBound
                    range = lower...upper
                } else {
                    let upper = max(min(duration, moved), range.lowerBound + shortest)
                    let lower = longest.map { max(range.lowerBound, upper - $0) } ?? range.lowerBound
                    range = lower...upper
                }
            }
            .onEnded { _ in
                startValue = nil
                Haptic.selection()
                onCommit()
            }
    }
}
