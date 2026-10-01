import AVFoundation
import Photos
import SwiftUI

/// The camera, as WhatsApp lays it out: the live picture filling the screen;
/// ✕ and the flash at the top; the newest photos in a strip above the
/// controls (swipe it up for all of them); the gallery, low light, the white
/// shutter, the zoom and the flip; and VIDEO · PHOTO · VIDEO NOTE under them.
///
/// In PHOTO a tap takes a photo and holding records until it is let go
/// (sliding up while holding zooms in). In VIDEO and VIDEO NOTE a tap starts
/// and a second tap stops. Pinch the picture to zoom; tap it to focus there.
struct ChatCameraView: View {
    @ObservedObject var camera: ChatCameraController
    @ObservedObject var library: ChatRecentPhotos
    @Binding var mode: ChatCameraMode
    let onClose: () -> Void
    let onPhoto: (UIImage) -> Void
    let onVideo: (URL, Bool) -> Void
    let onAsset: (PHAsset) -> Void
    /// The system's photo picker: everything, no permission needed.
    let onGallery: () -> Void
    /// The strip swiped up: every photo the app may see.
    let onLibrary: () -> Void

    @State private var focusPoint: CGPoint?
    @State private var focusShown = false
    @State private var pinchStart: CGFloat?
    @State private var pressStarted = false
    @State private var holdRecording = false
    @State private var holdTask: Task<Void, Never>?
    @State private var holdZoomStart: CGFloat?
    @State private var blink = false
    @State private var positionBeforeNote: AVCaptureDevice.Position?
    @GestureState private var isPressed = false

    private var recording: Bool { camera.isRecording || holdRecording }
    private var rightToLeft: Bool { AppLanguage.current.layoutDirection == .rightToLeft }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            preview
                .ignoresSafeArea()

            if mode == .videoNote {
                noteMask
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }

            if let focusPoint, focusShown {
                RoundedRectangle(cornerRadius: 4)
                    .strokeBorder(Color.neonAmber, lineWidth: 1.5)
                    .frame(width: 74, height: 74)
                    .position(focusPoint)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .transition(.scale(scale: 1.4).combined(with: .opacity))
            }

            Color.black
                .opacity(blink ? 0.85 : 0)
                .ignoresSafeArea()
                .allowsHitTesting(false)

            if camera.screenLight {
                Color.white.ignoresSafeArea().allowsHitTesting(false)
            }

            stateNote

            VStack(spacing: 0) {
                topBar
                Spacer(minLength: 0)
                bottom
            }
        }
        .animation(NeonMotion.resolved(NeonMotion.snappy), value: mode)
        .animation(NeonMotion.resolved(NeonMotion.quick), value: recording)
        .animation(NeonMotion.resolved(NeonMotion.quick), value: focusShown)
        .onChange(of: camera.shutterCount) { _ in
            withAnimation(.easeOut(duration: 0.05)) { blink = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
                withAnimation(.easeIn(duration: 0.18)) { blink = false }
            }
        }
        .onChange(of: mode) { newMode in
            if newMode == .videoNote {
                positionBeforeNote = camera.position
                camera.useFront()
            } else if let before = positionBeforeNote {
                positionBeforeNote = nil
                if before != camera.position { camera.flip() }
            }
        }
        .onChange(of: isPressed) { pressed in
            // The press ended without an end (an alert took the touch).
            if !pressed { released(cancelled: true) }
        }
    }

    // MARK: The picture

    private var preview: some View {
        ChatCameraPreview(camera: camera)
            .gesture(
                SpatialTapGesture().onEnded { value in
                    guard camera.access == .granted else { return }
                    camera.focus(atLayerPoint: value.location)
                    focusPoint = value.location
                    focusShown = true
                    Haptic.soft()
                    let shownAt = Date()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                        if Date().timeIntervalSince(shownAt) >= 1.15 { focusShown = false }
                    }
                }
            )
            .simultaneousGesture(
                MagnificationGesture()
                    .onChanged { scale in
                        if pinchStart == nil { pinchStart = camera.zoom }
                        camera.setZoom((pinchStart ?? 1) * scale)
                    }
                    .onEnded { _ in pinchStart = nil }
            )
            .simultaneousGesture(
                DragGesture(minimumDistance: 40)
                    .onEnded { value in
                        guard !recording, abs(value.translation.width) > abs(value.translation.height) * 1.5,
                              abs(value.translation.width) > 60 else { return }
                        let forward = value.translation.width < 0
                        step(mode: (forward ? 1 : -1) * (rightToLeft ? -1 : 1))
                    }
            )
            .environment(\.layoutDirection, .leftToRight)
            .accessibilityLabel(L("Camera"))
            .accessibilityHint(L("Tap to focus, pinch to zoom"))
    }

    /// VIDEO NOTE: the picture seen through a circle, as the note will be.
    private var noteMask: some View {
        GeometryReader { geo in
            let circle = noteCircle(in: geo.size)
            ZStack {
                Path { path in
                    path.addRect(CGRect(origin: .zero, size: geo.size))
                    path.addEllipse(in: circle)
                }
                .fill(Color.black.opacity(0.88), style: FillStyle(eoFill: true))

                Circle()
                    .strokeBorder(Color.white.opacity(0.25), lineWidth: 1)
                    .frame(width: circle.width, height: circle.height)
                    .position(x: circle.midX, y: circle.midY)

                if let since = camera.recordingSince {
                    TimelineView(.animation(minimumInterval: 0.1)) { context in
                        let elapsed = context.date.timeIntervalSince(since)
                        Circle()
                            .trim(from: 0, to: min(1, elapsed / ChatCameraMode.videoNote.maxSeconds))
                            .stroke(Color.neonAmber, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                            .frame(width: circle.width + 10, height: circle.height + 10)
                            .position(x: circle.midX, y: circle.midY)
                    }
                }
            }
        }
    }

    private func noteCircle(in size: CGSize) -> CGRect {
        let side = min(size.width - 48, size.height * 0.48, 380)
        return CGRect(x: (size.width - side) / 2, y: size.height * 0.4 - side / 2, width: side, height: side)
    }

    @ViewBuilder
    private var stateNote: some View {
        switch camera.access {
        case .denied:
            VStack(spacing: 12) {
                Image(systemName: "camera.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.8))
                Text(L("Camera access is off"))
                    .font(.neonHeadline)
                    .foregroundStyle(.white)
                Text(L("Allow it in Settings to take photos and videos here. You can still send one from your library."))
                    .font(.neonFootnote)
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
                Button {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                } label: {
                    Text(L("Open Settings"))
                        .font(.system(.subheadline, weight: .bold))
                        .foregroundStyle(.black)
                        .padding(.horizontal, 20)
                        .frame(height: 40)
                        .background(Capsule().fill(Color.white))
                }
                .buttonStyle(PressableStyle(scale: 0.92))
                .padding(.top, 4)
            }
            .padding(.horizontal, 40)
            .offset(y: -60)
        default:
            if camera.interrupted {
                VStack(spacing: 8) {
                    Image(systemName: "pause.circle.fill").font(.system(size: 34))
                    Text(L("The camera is paused")).font(.neonHeadline)
                    Text(L("Another app or a call is using it.")).font(.neonFootnote).opacity(0.7)
                }
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
                .offset(y: -60)
            }
        }
    }

    // MARK: Top

    private var topBar: some View {
        HStack(spacing: 8) {
            ChatCameraButton("xmark", label: L("Close"), size: 42) {
                if camera.isRecording { camera.stopRecording() }
                onClose()
            }
            Spacer(minLength: 4)
            if let since = camera.recordingSince {
                TimelineView(.periodic(from: since, by: 0.5)) { context in
                    HStack(spacing: 6) {
                        Circle().fill(Color.neonDanger).frame(width: 8, height: 8).neonPulse(true)
                        Text(verbatim: chatCameraClock(context.date.timeIntervalSince(since)))
                            .font(.system(.subheadline, weight: .semibold))
                            .monospacedDigit()
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .frame(height: 30)
                    .background(Capsule().fill(Color.black.opacity(0.45)))
                    .environment(\.layoutDirection, .leftToRight)
                }
                .accessibilityLabel(L("Recording"))
                .transition(.opacity)
                Spacer(minLength: 4)
            }
            if camera.hasFlash, !recording {
                ChatCameraButton(camera.flash.symbol, label: camera.flash.label, size: 42) { cycleFlash() }
                    .transition(.opacity)
            } else {
                Color.clear.frame(width: 42, height: 42)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 6)
    }

    private func cycleFlash() {
        let order: [ChatCameraFlash] = camera.position == .front ? [.off, .on] : ChatCameraFlash.allCases
        let index = order.firstIndex(of: camera.flash) ?? 0
        camera.flash = order[(index + 1) % order.count]
    }

    // MARK: Bottom

    private var bottom: some View {
        VStack(spacing: 14) {
            if showsStrip {
                strip
                    .transition(.opacity.combined(with: .offset(y: 10)))
            }
            controls
            if !recording {
                modes
                    .transition(.opacity)
            } else {
                Color.clear.frame(height: 30)
            }
        }
        .padding(.bottom, 8)
        .background(
            LinearGradient(colors: [.black.opacity(0), .black.opacity(0.55)], startPoint: .top, endPoint: .bottom)
                .padding(.top, -40)
                .ignoresSafeArea()
                .allowsHitTesting(false)
        )
    }

    private var showsStrip: Bool {
        !recording && mode != .videoNote && library.canRead && (!library.recent.isEmpty || library.isLimited)
    }

    private var strip: some View {
        VStack(spacing: 8) {
            Button(action: onLibrary) {
                Image(systemName: "chevron.compact.up")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.85))
                    .frame(width: 60, height: 18)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L("All photos"))

            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 4) {
                    ForEach(library.recent, id: \.localIdentifier) { asset in
                        Button {
                            Haptic.tap()
                            onAsset(asset)
                        } label: {
                            ChatAssetThumb(asset: asset, manager: library.images, side: 64)
                                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        }
                        .buttonStyle(PressableStyle(scale: 0.92))
                    }
                    if library.isLimited {
                        Button {
                            library.shareMore()
                        } label: {
                            VStack(spacing: 4) {
                                Image(systemName: "plus").font(.system(size: 18, weight: .semibold))
                                Text(L("More")).font(.system(size: 10, weight: .semibold))
                            }
                            .foregroundStyle(.white)
                            .frame(width: 64, height: 64)
                            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Color.white.opacity(0.14)))
                        }
                        .buttonStyle(PressableStyle(scale: 0.92))
                        .accessibilityLabel(L("Share more photos with NEON"))
                    }
                }
                .padding(.horizontal, 6)
            }
            .frame(height: 64)
        }
        .gesture(
            DragGesture(minimumDistance: 20).onEnded { value in
                if value.translation.height < -40, abs(value.translation.height) > abs(value.translation.width) { onLibrary() }
            }
        )
    }

    private var controls: some View {
        ZStack {
            HStack(spacing: 14) {
                if !recording {
                    ChatCameraButton("photo", label: L("Gallery"), size: 44, action: onGallery)
                        .transition(.opacity)
                    if mode == .photo {
                        ChatCameraButton(camera.lowLight ? "moon.stars.fill" : "moon.stars", label: L("Low light"), size: 44, isOn: camera.lowLight) {
                            camera.lowLight.toggle()
                            if camera.lowLight {
                                Toast.info(L("Low light"), detail: L("Photos take a moment longer and come out cleaner in the dark."))
                            }
                        }
                        .accessibilityValue(camera.lowLight ? L("On") : L("Off"))
                        .transition(.opacity)
                    }
                }
                Spacer(minLength: 0)
                if camera.zoomStops.count > 1 {
                    ChatCameraWordButton(word: zoomText(camera.zoom), label: L("Zoom"), size: 44) {
                        camera.nextZoomStop()
                    }
                    .accessibilityValue(zoomText(camera.zoom))
                }
                if !recording {
                    ChatCameraButton("arrow.triangle.2.circlepath", label: L("Switch camera"), size: 44) {
                        camera.flip()
                    }
                    .transition(.opacity)
                }
            }
            .padding(.horizontal, 18)

            shutter
        }
        .frame(height: 84)
    }

    private func zoomText(_ zoom: CGFloat) -> String {
        let tenth = (zoom * 10).rounded() / 10
        if abs(tenth - tenth.rounded()) < 0.05 { return "\(Int(tenth.rounded()))×" }
        return String(format: "%.1f×", tenth)
    }

    private var modes: some View {
        HStack(spacing: 26) {
            ForEach(ChatCameraMode.allCases) { option in
                Button {
                    Haptic.selection()
                    mode = option
                } label: {
                    Text(option.title.uppercased(with: AppLanguage.current.locale))
                        .font(.system(.footnote, weight: mode == option ? .bold : .semibold))
                        .kerning(0.6)
                        .foregroundStyle(mode == option ? Color.neonAmber : Color.white.opacity(0.85))
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(mode == option ? .isSelected : [])
            }
        }
        .frame(height: 30)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
    }

    private func step(mode delta: Int) {
        let all = ChatCameraMode.allCases
        guard let index = all.firstIndex(of: mode) else { return }
        let next = index + delta
        guard all.indices.contains(next) else { return }
        Haptic.selection()
        mode = all[next]
    }

    // MARK: The shutter

    private var shutter: some View {
        let red = Color.neonDanger
        let tapToStop = camera.isRecording && !holdRecording
        return ZStack {
            Circle()
                .strokeBorder(recording ? red.opacity(0.9) : Color.white, lineWidth: 5)
                .frame(width: 80, height: 80)
            Group {
                if tapToStop {
                    RoundedRectangle(cornerRadius: 7, style: .continuous).fill(red).frame(width: 30, height: 30)
                } else if holdRecording {
                    Circle().fill(red).frame(width: 64, height: 64)
                } else if mode == .photo {
                    Circle().fill(Color.white).frame(width: 64, height: 64)
                } else {
                    Circle().fill(red).frame(width: 64, height: 64)
                }
            }
            .animation(NeonMotion.resolved(NeonMotion.snappy), value: tapToStop)
        }
        .frame(width: 84, height: 84)
        .scaleEffect(holdRecording ? 1.18 : (isPressed && mode == .photo ? 0.93 : 1))
        .animation(NeonMotion.resolved(NeonMotion.snappy), value: holdRecording)
        .animation(NeonMotion.resolved(NeonMotion.quick), value: isPressed)
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .updating($isPressed) { _, state, _ in state = true }
                .onChanged(pressed)
                .onEnded { _ in released(cancelled: false) }
        )
        .disabled(camera.busy)
        .accessibilityElement()
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(shutterLabel)
        .accessibilityHint(mode == .photo ? L("Tap for a photo, hold for a video") : "")
        .accessibilityAction { accessibilityShutter() }
    }

    private var shutterLabel: String {
        if camera.isRecording { return L("Stop recording") }
        switch mode {
        case .photo: return L("Take photo")
        case .video: return L("Record video")
        case .videoNote: return L("Record video note")
        }
    }

    private func pressed(_ value: DragGesture.Value) {
        if !pressStarted {
            pressStarted = true
            guard mode == .photo, camera.access == .granted else { return }
            // Held a moment in PHOTO: a video, until it is let go.
            holdTask = Task { @MainActor in
                try? await Task.sleep(nanoseconds: 350_000_000)
                guard !Task.isCancelled, pressStarted, !camera.busy else { return }
                if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
                    // The microphone question would take the touch away mid-hold;
                    // asked now, the next hold records.
                    pressStarted = false
                    AVCaptureDevice.requestAccess(for: .audio) { _ in }
                    return
                }
                holdRecording = true
                holdZoomStart = camera.zoom
                Haptic.impact(.medium)
                camera.startRecording(mode: .video) { url in
                    holdRecording = false
                    if let url { onVideo(url, false) }
                }
            }
            return
        }
        // Sliding up while holding zooms in, as WhatsApp does.
        if holdRecording, let start = holdZoomStart {
            let lift = max(0, -value.translation.height)
            camera.setZoom(start * (1 + lift / 110))
        }
    }

    private func released(cancelled: Bool) {
        guard pressStarted else { return }
        pressStarted = false
        holdTask?.cancel()
        holdTask = nil
        holdZoomStart = nil
        if holdRecording {
            camera.stopRecording()
            return
        }
        guard !cancelled else { return }
        shutterTapped()
    }

    private func accessibilityShutter() {
        shutterTapped()
    }

    private func shutterTapped() {
        guard camera.access == .granted else {
            Haptic.warning()
            if camera.access == .unavailable { Toast.info(L("There is no camera on this device")) }
            return
        }
        switch mode {
        case .photo:
            if camera.isRecording {
                camera.stopRecording()
                return
            }
            Haptic.impact(.light)
            camera.takePhoto { image in
                if let image {
                    onPhoto(image)
                } else {
                    Haptic.error()
                    Toast.error(L("The photo could not be taken."))
                }
            }
        case .video, .videoNote:
            if camera.isRecording {
                camera.stopRecording()
            } else {
                Haptic.impact(.medium)
                let note = mode == .videoNote
                camera.startRecording(mode: mode) { url in
                    if let url { onVideo(url, note) }
                }
            }
        }
    }
}

// MARK: - The live picture

struct ChatCameraPreview: UIViewRepresentable {
    let camera: ChatCameraController

    func makeUIView(context: Context) -> ChatCameraPreviewView {
        let view = ChatCameraPreviewView()
        view.backgroundColor = .black
        view.previewLayer.session = camera.session
        view.previewLayer.videoGravity = .resizeAspectFill
        camera.previewLayer = view.previewLayer
        return view
    }

    func updateUIView(_ view: ChatCameraPreviewView, context: Context) {
        view.track(camera.device)
    }
}

/// The preview layer, kept level as the phone turns: by the system's
/// rotation coordinator on iOS 17 and later, by the screen's orientation
/// before that.
final class ChatCameraPreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    // swiftlint:disable:next force_cast
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }

    private weak var device: AVCaptureDevice?
    private var coordinator: AnyObject?
    private var observation: NSKeyValueObservation?

    func track(_ device: AVCaptureDevice?) {
        guard device !== self.device else { return }
        self.device = device
        observation = nil
        coordinator = nil
        guard let device else { return }
        if #available(iOS 17.0, *) {
            let coordinator = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: previewLayer)
            apply(angle: coordinator.videoRotationAngleForHorizonLevelPreview)
            observation = coordinator.observe(\.videoRotationAngleForHorizonLevelPreview, options: [.new]) { [weak self] coordinator, _ in
                let angle = coordinator.videoRotationAngleForHorizonLevelPreview
                DispatchQueue.main.async { self?.apply(angle: angle) }
            }
            self.coordinator = coordinator
        } else {
            setNeedsLayout()
        }
    }

    private func apply(angle: CGFloat) {
        guard let connection = previewLayer.connection else { return }
        ChatCameraController.apply(angle: angle, to: connection)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if #available(iOS 17.0, *) {
            if let coordinator = coordinator as? AVCaptureDevice.RotationCoordinator {
                apply(angle: coordinator.videoRotationAngleForHorizonLevelPreview)
            }
            return
        }
        switch window?.windowScene?.interfaceOrientation {
        case .landscapeLeft: apply(angle: 180)
        case .landscapeRight: apply(angle: 0)
        case .portraitUpsideDown: apply(angle: 270)
        default: apply(angle: 90)
        }
    }
}
