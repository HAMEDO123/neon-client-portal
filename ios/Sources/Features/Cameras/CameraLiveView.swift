import Photos
import SwiftUI
import UIKit

/// One camera, live and full screen, on black: pinch or double-tap to zoom
/// (digitally), swipe to the next camera, turn the phone for landscape. The
/// top shows its name and whether the picture is live, connecting or lost,
/// with the full-quality switch and a button that saves the picture on screen
/// to Photos. A camera that pans and tilts gets a stick to move it, held to
/// move and released to stop, and its saved positions as chips.
///
/// Only the camera on screen streams; nothing streams once the view is gone
/// or the app has left the foreground. The phone stays awake while it is open.
struct CameraLiveView: View {
    let cameras: [CameraItem]
    let source: CameraFeedSource
    @ObservedObject var wall: CameraWall

    @Environment(\.dismiss) private var dismiss
    @StateObject private var feed: CameraLiveFeed
    @StateObject private var mover: CameraMover
    @State private var selection: String
    @State private var chromeHidden = false
    @State private var saving = false
    @AppStorage("cameras_live_hd") private var hd = false

    init(cameras: [CameraItem], startAt: String, source: CameraFeedSource, wall: CameraWall) {
        self.cameras = cameras
        self.source = source
        self.wall = wall
        _feed = StateObject(wrappedValue: CameraLiveFeed(source: source))
        _mover = StateObject(wrappedValue: CameraMover(source: source))
        _selection = State(initialValue: startAt)
    }

    private var current: CameraItem? { cameras.first { $0.id == selection } }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            TabView(selection: $selection) {
                ForEach(cameras) { camera in
                    CameraZoomView(
                        image: camera.id == selection ? (feed.image ?? wall.images[camera.id]) : wall.images[camera.id],
                        resetKey: camera.id,
                        onTap: { withAnimation(NeonMotion.gentle) { chromeHidden.toggle() } }
                    )
                    .ignoresSafeArea()
                    .tag(camera.id)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()

            if !chromeHidden {
                chrome
                    .transition(.opacity)
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(chromeHidden)
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            begin()
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            feed.stop()
            mover.release()
        }
        .onChange(of: selection) { _ in
            Haptic.selection()
            begin()
        }
        .onChange(of: hd) { _ in begin() }
        // The app's own notifications rather than `scenePhase`: inside a
        // full-screen cover that value is not kept up to date, and the stream
        // must stop when the app goes to the background and start again when
        // it comes back.
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in
            feed.stop()
            mover.release()
        }
        // Not willEnterForeground: the app is still "in the background" then.
        // Starting twice is harmless — the feed ignores a start for what it is
        // already showing.
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            begin()
        }
    }

    private func begin() {
        guard let camera = current, UIApplication.shared.applicationState != .background else { return }
        feed.start(id: camera.id, hd: hd && camera.canEdit, placeholder: wall.images[camera.id])
        mover.show(camera)
    }

    // MARK: Chrome

    private var chrome: some View {
        VStack(spacing: 0) {
            topBar
            Spacer(minLength: 0)
            bottomBar
        }
        .padding(.horizontal, NeonSpace.gutter)
        .padding(.vertical, 8)
    }

    private var topBar: some View {
        HStack(alignment: .center, spacing: 10) {
            IconButton("xmark", label: L("Close"), tint: .white, size: NeonSize.circleButton) {
                dismiss()
            }
            VStack(alignment: .leading, spacing: 4) {
                if let camera = current {
                    DirText(camera.name, font: .neonHeadline, color: .white, fill: false, lineLimit: 1)
                }
                CameraPhasePill(phase: feed.phase)
            }
            Spacer(minLength: 8)
            if current?.canEdit == true {
                Button {
                    Haptic.selection()
                    hd.toggle()
                } label: {
                    Text(L("HD"))
                        .font(.system(size: 13, weight: .heavy))
                        .foregroundStyle(hd ? Color.black : Color.white)
                        .frame(width: 40, height: 30)
                        .background(Capsule().fill(hd ? Color.white : Color.white.opacity(0.18)))
                }
                .buttonStyle(PressableStyle(scale: 0.9))
                .accessibilityLabel(Text(hd ? L("Full quality is on") : L("Full quality is off")))
            }
            IconButton("square.and.arrow.down", label: L("Save the picture to Photos"), tint: .white, size: NeonSize.circleButton) {
                Task { await savePicture() }
            }
            .disabled(feed.jpeg == nil || saving)
            .opacity(feed.jpeg == nil ? 0.5 : 1)
        }
    }

    private var bottomBar: some View {
        VStack(spacing: 12) {
            if mover.controls?.canMove == true, let camera = current {
                HStack(alignment: .bottom, spacing: 12) {
                    if let presets = mover.controls?.presets, !presets.isEmpty {
                        CameraPresetChips(presets: presets) { preset in
                            mover.goto(preset)
                        }
                    }
                    Spacer(minLength: 0)
                    CameraStick { vector in
                        if let vector {
                            mover.move(x: vector.dx, y: vector.dy)
                        } else {
                            mover.release()
                        }
                    }
                    .accessibilityLabel(Text(L("Move %@", camera.name)))
                }
            }
            if cameras.count > 1 {
                CameraPageDots(count: cameras.count, index: cameras.firstIndex { $0.id == selection } ?? 0)
            }
        }
    }

    // MARK: Saving

    /// The picture on screen, as the camera sent it, into Photos ("add only").
    private func savePicture() async {
        guard let jpeg = feed.jpeg else { return }
        saving = true
        defer { saving = false }
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else {
            Haptic.warning()
            Toast.warning(L("NEON can't save to Photos"), detail: L("Allow it in Settings › NEON › Photos."))
            return
        }
        do {
            try await PHPhotoLibrary.shared().performChanges {
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: jpeg, options: nil)
            }
            Haptic.success()
            Toast.success(L("Saved to Photos"))
        } catch {
            Toast.error(error)
        }
    }
}

// MARK: - Live, connecting, lost

private struct CameraPhasePill: View {
    let phase: CameraLiveFeed.Phase

    var body: some View {
        HStack(spacing: 5) {
            switch phase {
            case .live:
                Circle().fill(Color.neonDanger).frame(width: 7, height: 7).neonPulse(true)
                Text(L("Live"))
            case .connecting:
                ProgressView().controlSize(.mini).tint(.white)
                Text(L("Connecting…"))
            case .lost(let message):
                Image(systemName: "wifi.exclamationmark").font(.system(size: 10, weight: .bold))
                Text(message ?? L("Connection lost — trying again"))
                    .lineLimit(2)
            case .idle:
                Image(systemName: "pause.fill").font(.system(size: 9, weight: .bold))
                Text(L("Paused"))
            }
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(Capsule().fill(pillColor))
        .animation(NeonMotion.gentle, value: phase)
        .accessibilityElement(children: .combine)
    }

    private var pillColor: Color {
        switch phase {
        case .live: return Color.black.opacity(0.45)
        case .connecting, .idle: return Color.white.opacity(0.16)
        case .lost: return Color.neonOrange.opacity(0.75)
        }
    }
}

private struct CameraPageDots: View {
    let count: Int
    let index: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<count, id: \.self) { dot in
                Circle()
                    .fill(Color.white.opacity(dot == index ? 0.95 : 0.35))
                    .frame(width: dot == index ? 7 : 5, height: dot == index ? 7 : 5)
            }
        }
        .animation(NeonMotion.snappy, value: index)
        .accessibilityHidden(true)
    }
}

// MARK: - Saved positions

private struct CameraPresetChips: View {
    let presets: [CameraPreset]
    let go: (CameraPreset) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(presets) { preset in
                    Button {
                        Haptic.impact(.light)
                        go(preset)
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "scope").font(.system(size: 11, weight: .bold))
                            Text(verbatim: preset.name).lineLimit(1)
                        }
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .frame(height: 34)
                        .background(Capsule().fill(Color.white.opacity(0.18)))
                        .overlay(Capsule().strokeBorder(Color.white.opacity(0.22)))
                    }
                    .buttonStyle(PressableStyle(scale: 0.94))
                    .accessibilityLabel(Text(L("Go to %@", preset.name)))
                }
            }
            .padding(.vertical, 2)
        }
        .frame(maxWidth: 420)
    }
}

// MARK: - The stick

/// Pan and tilt: hold anywhere on the pad and the camera turns that way, the
/// further from the middle the faster; let go and it stops. Laid out left to
/// right whatever the language — left is the camera's left.
private struct CameraStick: View {
    /// x pans right, y tilts up, each −1…1; nil when released (or back in the middle).
    let onChange: (CGVector?) -> Void

    @State private var knob: CGSize = .zero
    @State private var holding = false
    @State private var lastSent: CGVector?
    @State private var lastSentAt = Date.distantPast

    private let size: CGFloat = 128
    private let knobSize: CGFloat = 50
    private let keepAlive = Timer.publish(every: 0.45, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            Circle().fill(Color.black.opacity(0.35))
            Circle().strokeBorder(Color.white.opacity(0.28), lineWidth: 1.5)
            ForEach(Arrow.allCases, id: \.self) { arrow in
                Image(systemName: arrow.symbol)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white.opacity(0.8))
                    .offset(arrow.offset(size / 2 - 15))
            }
            Circle()
                .fill(Color.white.opacity(holding ? 0.95 : 0.7))
                .frame(width: knobSize, height: knobSize)
                .shadow(color: .black.opacity(0.3), radius: 6, y: 2)
                .offset(knob)
        }
        .frame(width: size, height: size)
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in drag(to: value.location) }
                .onEnded { _ in release() }
        )
        .onReceive(keepAlive) { _ in
            // Each move lasts about a second on the camera; while a finger is
            // held, the same move is sent again before it runs out.
            if holding, let lastSent, Date().timeIntervalSince(lastSentAt) > 0.4 { send(lastSent) }
        }
        .environment(\.layoutDirection, .leftToRight)
        .accessibilityElement()
        .accessibilityAction(named: Text(L("Turn left"))) { nudge(CGVector(dx: -1, dy: 0)) }
        .accessibilityAction(named: Text(L("Turn right"))) { nudge(CGVector(dx: 1, dy: 0)) }
        .accessibilityAction(named: Text(L("Tilt up"))) { nudge(CGVector(dx: 0, dy: 1)) }
        .accessibilityAction(named: Text(L("Tilt down"))) { nudge(CGVector(dx: 0, dy: -1)) }
    }

    private func drag(to location: CGPoint) {
        let reach = size / 2 - knobSize / 2
        var dx = location.x - size / 2
        var dy = location.y - size / 2
        let distance = hypot(dx, dy)
        if distance > reach, distance > 0 {
            dx *= reach / distance
            dy *= reach / distance
        }
        knob = CGSize(width: dx, height: dy)
        if !holding {
            holding = true
            Haptic.impact(.light)
        }
        // Screen y grows downwards; a camera tilts up for positive y.
        let vector = CGVector(dx: dx / reach, dy: -dy / reach)
        if hypot(vector.dx, vector.dy) < 0.25 {
            if lastSent != nil {
                lastSent = nil
                onChange(nil)
            }
            return
        }
        // Only a real change is sent at once; the keep-alive covers the rest.
        if let lastSent, angle(lastSent, vector) < 0.2, abs(hypot(lastSent.dx, lastSent.dy) - hypot(vector.dx, vector.dy)) < 0.2 { return }
        if lastSent == nil { Haptic.selection() }
        send(vector)
    }

    private func send(_ vector: CGVector) {
        lastSent = vector
        lastSentAt = Date()
        onChange(CGVector(dx: (vector.dx * 100).rounded() / 100, dy: (vector.dy * 100).rounded() / 100))
    }

    private func release() {
        withAnimation(NeonMotion.bouncy) { knob = .zero }
        holding = false
        lastSent = nil
        onChange(nil)
    }

    private func nudge(_ vector: CGVector) {
        onChange(vector)
        Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            onChange(nil)
        }
    }

    private func angle(_ a: CGVector, _ b: CGVector) -> CGFloat {
        let difference = abs(atan2(a.dy, a.dx) - atan2(b.dy, b.dx))
        return min(difference, 2 * .pi - difference)
    }

    private enum Arrow: CaseIterable {
        case up, down, left, right

        var symbol: String {
            switch self {
            case .up: return "chevron.up"
            case .down: return "chevron.down"
            case .left: return "chevron.left"
            case .right: return "chevron.right"
            }
        }

        func offset(_ distance: CGFloat) -> CGSize {
            switch self {
            case .up: return CGSize(width: 0, height: -distance)
            case .down: return CGSize(width: 0, height: distance)
            case .left: return CGSize(width: -distance, height: 0)
            case .right: return CGSize(width: distance, height: 0)
            }
        }
    }
}

// MARK: - Moving the camera

/// Sends the stick's moves to the server one at a time: while one is on its
/// way only the newest waiting command is kept, so a held finger never builds
/// a queue, and a release is never lost behind it.
@MainActor
final class CameraMover: ObservableObject {
    @Published private(set) var controls: CameraControls?

    private let source: CameraFeedSource
    private var cameraId: String?
    private var pending: Command?
    private var sending = false
    private var moving = false
    private var loading: Task<Void, Never>?
    private var warned = false

    private enum Command {
        case move(Double, Double)
        case stop
        case goto(String)
    }

    init(source: CameraFeedSource) {
        self.source = source
    }

    /// Reads what this camera can do. Nothing for a camera that cannot move,
    /// or that does not answer — it then simply has no controls.
    func show(_ camera: CameraItem) {
        guard camera.id != cameraId else { return }
        release()
        cameraId = camera.id
        controls = nil
        warned = false
        loading?.cancel()
        guard camera.canEdit, !camera.signsInWithTapoAccount, camera.ptz != false else { return }
        loading = Task { [weak self] in
            guard let self else { return }
            let answer = try? await self.source.controls(id: camera.id)
            guard !Task.isCancelled, self.cameraId == camera.id else { return }
            withNeonAnimation(.smooth) { self.controls = answer }
        }
    }

    func move(x: Double, y: Double) {
        moving = true
        enqueue(.move(x, y))
    }

    /// The finger lifted (or the view went away): stop, if it was moving.
    func release() {
        guard moving else { return }
        moving = false
        enqueue(.stop)
    }

    func goto(_ preset: CameraPreset) {
        enqueue(.goto(preset.token))
    }

    private func enqueue(_ command: Command) {
        pending = command
        pump()
    }

    private func pump() {
        guard !sending, let command = pending, let id = cameraId else { return }
        pending = nil
        sending = true
        Task { [weak self] in
            guard let self else { return }
            do {
                switch command {
                case .move(let x, let y): try await self.source.move(id: id, x: x, y: y)
                case .stop: try await self.source.stop(id: id)
                case .goto(let token): try await self.source.goto(id: id, preset: token)
                }
            } catch {
                if !self.warned {
                    self.warned = true
                    Haptic.warning()
                    Toast.warning(L("The camera didn't move"), detail: error.localizedDescription)
                }
            }
            self.sending = false
            self.pump()
        }
    }
}

// MARK: - Zoom

/// The picture, fitted to the screen, with the system's own pinch and
/// double-tap zoom. A UIScrollView, because nothing in SwiftUI zooms and pans
/// together this well — and inside the pager it hands a swipe on to the next
/// camera only once the picture is back at its full-screen size.
private struct CameraZoomView: UIViewRepresentable {
    let image: UIImage?
    let resetKey: String
    let onTap: () -> Void

    func makeUIView(context: Context) -> CameraZoomScrollView {
        let view = CameraZoomScrollView()
        view.onTap = onTap
        return view
    }

    func updateUIView(_ view: CameraZoomScrollView, context: Context) {
        view.onTap = onTap
        view.show(image, key: resetKey)
    }
}

final class CameraZoomScrollView: UIScrollView, UIScrollViewDelegate {
    private let imageView = UIImageView()
    private var key: String?
    var onTap: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        delegate = self
        minimumZoomScale = 1
        maximumZoomScale = 6
        bouncesZoom = true
        showsVerticalScrollIndicator = false
        showsHorizontalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        backgroundColor = .black
        imageView.contentMode = .scaleAspectFit
        imageView.isAccessibilityElement = true
        imageView.accessibilityTraits = .image
        addSubview(imageView)

        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        addGestureRecognizer(doubleTap)
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
        tap.require(toFail: doubleTap)
        addGestureRecognizer(tap)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func show(_ image: UIImage?, key: String) {
        if key != self.key {
            self.key = key
            setZoomScale(1, animated: false)
        }
        if imageView.image !== image { imageView.image = image }
    }

    private var laidOutFor: CGSize = .zero

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != laidOutFor else { return }
        // A turn of the phone: back to the whole picture at the new size.
        laidOutFor = bounds.size
        setZoomScale(1, animated: false)
        imageView.frame = bounds
        contentSize = bounds.size
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

    @objc private func doubleTapped(_ recognizer: UITapGestureRecognizer) {
        if zoomScale > 1.01 {
            setZoomScale(1, animated: true)
        } else {
            let point = recognizer.location(in: imageView)
            let scale: CGFloat = 2.5
            let size = CGSize(width: bounds.width / scale, height: bounds.height / scale)
            zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
        }
    }

    @objc private func tapped() {
        onTap?()
    }
}
