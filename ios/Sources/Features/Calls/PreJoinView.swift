import AVFoundation
import SwiftUI
import WebRTC

// The moment before a call: see yourself, check the microphone and camera,
// and choose to go in muted or with the camera off — the Swift counterpart
// of components/calls/pre-join.tsx. iOS has one camera to flip rather than a
// list of devices to pick from, so that replaces the web's device pickers.
//
// The microphone and camera opened here are handed to the call when it
// starts (CallCenter.confirmPreJoin), not closed and opened again: closing
// them as this screen went away is what used to leave a video call sending a
// frozen picture.

struct CallPreJoinModel {
    var title: String
    /// Who is about to be rung, drawn as the chat draws them.
    var face: CallFace
    var isVideo: Bool
    var isJoin: Bool
    var loading: Bool
    var micOn: Bool
    /// False when there is no microphone to use: the toggle has nothing to switch.
    var micAvailable: Bool
    /// Refused in Settings, which is where it can be allowed again.
    var micBlocked = false
    var cameraOn: Bool
    var cameraBlocked = false
    /// This phone has no camera it could open (the simulator, or one in use).
    var cameraUnavailable = false
    var camera: RTCVideoTrack?
    var mirror: Bool
    var problem: CallMediaProblem?
    /// What the microphone hears, 0…1, newest last (voice calls).
    var micLevels: [Double] = []
}

struct CallPreJoinActions {
    var cancel: () -> Void = {}
    var toggleMic: () -> Void = {}
    var toggleCamera: () -> Void = {}
    var flip: () -> Void = {}
    var dismissProblem: () -> Void = {}
    var confirm: () async -> Void = {}
}

/// The pre-join screen, drawn from plain values.
struct CallPreJoinStage: View {
    let model: CallPreJoinModel
    var actions: CallPreJoinActions

    /// Nothing of this phone would reach anybody — no microphone and no
    /// picture — and Settings is what would change that. Ringing people then
    /// is the thing to talk somebody out of, so Settings becomes the main
    /// button and calling anyway the quiet one.
    private var nothingToSend: Bool {
        !model.loading && !model.micAvailable && model.micBlocked && !model.cameraOn
    }

    /// A video call that would start with no picture from this phone.
    private var soundOnly: Bool { model.isVideo && !model.loading && !model.cameraOn }

    private var primaryTitle: String {
        if model.isJoin { return soundOnly ? L("Join with sound only") : L("Join call") }
        if soundOnly { return L("Start with sound only") }
        return model.isVideo ? L("Start video call") : L("Start call")
    }

    private var anywayTitle: String {
        if model.isJoin {
            return model.isVideo ? L("Join anyway: you won't be heard or seen") : L("Join anyway: you won't be heard")
        }
        return model.isVideo ? L("Start anyway: you won't be heard or seen") : L("Start anyway: you won't be heard")
    }

    private var subtitle: String {
        if model.isVideo {
            return model.isJoin ? L("The call has started. Check your camera and mic first.") : L("Check your camera and mic first.")
        }
        if model.isJoin { return L("The call has started. Check your microphone first.") }
        return model.face.kind == .person
            ? L("Check your microphone before %@'s phone rings.", model.title)
            : L("Check your microphone before their phones ring.")
    }

    var body: some View {
        ZStack {
            CallBackdrop(hue: model.face.hue)

            VStack(spacing: NeonSpace.lg) {
                header
                if model.isVideo {
                    videoPreview
                        .frame(maxHeight: .infinity)
                        .neonAppear(delay: 0.05)
                } else {
                    Spacer(minLength: 0)
                    voiceCard
                        .neonAppear(delay: 0.05)
                    Spacer(minLength: 0)
                }
                if let problem = model.problem {
                    CallNoticeBanner(
                        text: problem.text,
                        // Said once: when Settings is the main button, the
                        // notice only explains.
                        actionTitle: problem.fixedInSettings && !nothingToSend ? L("Open Settings") : nil,
                        action: problem.fixedInSettings && !nothingToSend ? { openCallSettings() } : nil,
                        onDismiss: actions.dismissProblem
                    )
                    .transition(.neonRise)
                }
                toggles
                    .neonAppear(delay: 0.1)
                primary
                    .neonAppear(delay: 0.15)
            }
            .padding(.horizontal, NeonSpace.gutter)
            .padding(.bottom, NeonSpace.sm)
        }
        .animation(NeonMotion.smooth, value: model.cameraOn)
        .animation(NeonMotion.smooth, value: model.problem)
        .animation(NeonMotion.smooth, value: nothingToSend)
    }

    // MARK: Header

    /// The close button sits beside the overline and the name, so the line
    /// under them has the whole width.
    private var header: some View {
        VStack(alignment: .leading, spacing: NeonSpace.xs) {
            HStack(alignment: .center, spacing: NeonSpace.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Label(model.isVideo ? L("Video call") : L("Call"), systemImage: model.isVideo ? "video.fill" : "phone.fill")
                        .font(.neonOverline)
                        .textCase(.uppercase)
                        .foregroundStyle(.white.opacity(0.7))
                    DirText(model.title, font: .neonTitle2, color: .white, fill: false, lineLimit: 2)
                }
                Spacer(minLength: 0)
                CallGlassIconButton(symbol: "xmark", label: L("Cancel"), action: actions.cancel)
            }
            Text(subtitle)
                .font(.neonSubtitle)
                .foregroundStyle(.white.opacity(0.72))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.top, NeonSpace.sm)
    }

    // MARK: The card

    private func cardBackground(_ shape: RoundedRectangle) -> some View {
        let hue = model.face.hue
        return ZStack {
            Color.neonInk.opacity(0.6)
            LinearGradient(
                colors: [(hue?.color ?? .neonPurple).opacity(CallBackdrop.glow(hue) < 0.5 ? 0.3 : 0.42), Color.neonIndigoStrong.opacity(0.55)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
        }
        .clipShape(shape)
    }

    /// A voice call has nothing to look at: who is being rung, and whether
    /// the microphone hears anything — the one thing worth checking.
    private var voiceCard: some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.xl, style: .continuous)
        return VStack(spacing: NeonSpace.md) {
            CallHalo(face: model.face, size: 104)
            if model.loading {
                ProgressView().tint(.white)
                    .frame(height: 26)
            } else {
                CallMicMeter(levels: model.micLevels, live: model.micAvailable && model.micOn)
            }
            micChip
                .opacity(model.loading ? 0 : 1)
        }
        .padding(.vertical, NeonSpace.xl)
        .frame(maxWidth: .infinity)
        .background(cardBackground(shape))
        .overlay(shape.strokeBorder(Color.white.opacity(0.14), lineWidth: 1))
        .neonShadow(.floating)
    }

    private var videoPreview: some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.xl, style: .continuous)
        return ZStack {
            cardBackground(shape)
            if let camera = model.camera, model.cameraOn {
                CallVideoView(track: camera, mirror: model.mirror)
                    .transition(.opacity)
            } else if model.loading {
                VStack(spacing: NeonSpace.md) {
                    ProgressView().tint(.white).controlSize(.large)
                    Text(L("Opening the microphone and camera…"))
                        .font(.neonFootnote)
                        .foregroundStyle(.white.opacity(0.75))
                }
                .transition(.opacity)
            } else {
                // The words are in the chip below; the glyph only shows there
                // is no picture.
                Image(systemName: model.cameraBlocked ? "lock.fill" : "video.slash.fill")
                    .font(.system(size: 32, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.75))
                    .frame(width: 84, height: 84)
                    .background(CallGlass(shape: Circle(), strength: 0.2))
                    .accessibilityHidden(true)
                    .transition(.opacity)
            }
        }
        .clipShape(shape)
        .overlay(shape.strokeBorder(Color.white.opacity(0.14), lineWidth: 1))
        .overlay(alignment: .bottomLeading) {
            HStack(spacing: NeonSpace.sm) {
                micChip
                cameraChip
            }
            .padding(NeonSpace.md)
            .opacity(model.loading ? 0 : 1)
        }
        .neonShadow(.floating)
    }

    // MARK: Chips

    /// Where the microphone stands, in words: blocked (Settings can fix it),
    /// missing, switched off here, or on.
    private var micChip: some View {
        if model.micBlocked {
            return statusChip(L("Microphone blocked"), symbol: "lock.fill", tint: .neonWarning)
        }
        if !model.micAvailable {
            return statusChip(L("No microphone"), symbol: "mic.slash.fill", tint: .neonDanger)
        }
        return model.micOn
            ? statusChip(L("Microphone on"), symbol: "mic.fill", tint: .neonSuccess)
            : statusChip(L("You'll join muted"), symbol: "mic.slash.fill", tint: .neonDanger)
    }

    private var cameraChip: some View {
        if model.cameraBlocked {
            return statusChip(L("Camera blocked"), symbol: "lock.fill", tint: .neonWarning)
        }
        if model.cameraOn {
            return statusChip(L("Camera on"), symbol: "video.fill", tint: .neonSuccess)
        }
        return model.cameraUnavailable
            ? statusChip(L("No camera found"), symbol: "video.slash.fill", tint: .neonWarning)
            : statusChip(L("Camera off"), symbol: "video.slash.fill", tint: .neonDanger)
    }

    private func statusChip(_ text: String, symbol: String, tint: Color) -> some View {
        HStack(spacing: 5) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(tint)
            Text(text)
                .font(.system(.caption, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(CallGlass(shape: Capsule(), strength: 0.35))
        .accessibilityElement(children: .combine)
    }

    // MARK: Controls

    /// The same names and looks as the call's own bar: "Mute" / "Unmute",
    /// "Camera" / "Camera off", and a white disc only for "you are not
    /// sending this". Flip appears only while there is a camera to flip.
    private var toggles: some View {
        HStack(alignment: .top, spacing: 0) {
            micToggle
                .frame(maxWidth: .infinity)
            if model.isVideo {
                cameraToggle
                    .frame(maxWidth: .infinity)
                if model.cameraOn {
                    CallRoundButton(symbol: "arrow.triangle.2.circlepath.camera.fill", title: L("Flip"), action: actions.flip)
                        .disabled(model.loading)
                        .frame(maxWidth: .infinity)
                        .transition(.neonPop)
                }
            }
        }
    }

    @ViewBuilder
    private var micToggle: some View {
        if model.micBlocked {
            CallRoundButton(symbol: "mic.slash.fill", title: L("No mic"), look: .active, value: L("Microphone blocked"), mark: .warning) {
                openCallSettings()
            }
            .accessibilityHint(Text(L("Opens Settings")))
        } else if !model.micAvailable {
            CallRoundButton(symbol: "mic.slash.fill", title: L("No mic"), look: .active, value: L("No microphone")) {}
                .disabled(true)
        } else {
            CallRoundButton(
                symbol: model.micOn ? "mic.fill" : "mic.slash.fill", title: model.micOn ? L("Mute") : L("Unmute"),
                look: model.micOn ? .glass : .active, value: model.micOn ? L("Microphone on") : L("Muted"),
                action: actions.toggleMic
            )
            .disabled(model.loading)
        }
    }

    @ViewBuilder
    private var cameraToggle: some View {
        if model.cameraBlocked {
            CallRoundButton(symbol: "video.slash.fill", title: L("No camera"), look: .active, value: L("Camera blocked"), mark: .warning) {
                openCallSettings()
            }
            .accessibilityHint(Text(L("Opens Settings")))
        } else {
            CallRoundButton(
                symbol: model.cameraOn ? "video.fill" : "video.slash.fill", title: model.cameraOn ? L("Camera") : L("Camera off"),
                look: model.cameraOn ? .glass : .active, value: model.cameraOn ? L("Turned on") : L("Turned off"),
                action: actions.toggleCamera
            )
            .disabled(model.loading)
        }
    }

    @ViewBuilder
    private var primary: some View {
        if nothingToSend {
            VStack(spacing: NeonSpace.sm) {
                NeonButton(L("Open Settings"), symbol: "gear", kind: .brand) { openCallSettings() }
                NeonButton(anywayTitle, kind: .tinted(.white), size: .medium, fullWidth: true) {
                    await actions.confirm()
                }
            }
            .transition(.opacity)
        } else {
            NeonButton(primaryTitle, symbol: model.isVideo && !soundOnly ? "video.fill" : "phone.fill", kind: .brand) {
                await actions.confirm()
            }
            .disabled(model.loading)
            .transition(.opacity)
        }
    }
}

/// The pre-join screen with the real microphone and camera behind it.
struct PreJoinView: View {
    let request: PreJoinRequest
    let onCancel: () -> Void
    let onConfirm: (LocalMedia, RTCAudioTrack?, RTCVideoTrack?, Bool, CallMediaProblem?) async -> Void

    @ObservedObject private var faces = CallFaceDirectory.shared
    @StateObject private var meter = CallMicLevelMonitor()
    @State private var media = LocalMedia()
    @State private var micTrack: RTCAudioTrack?
    @State private var cameraTrack: RTCVideoTrack?
    @State private var micOn = true
    @State private var cameraOn: Bool
    @State private var loading = true
    @State private var problem: CallMediaProblem?
    @State private var micBlocked = false
    @State private var cameraBlocked = false
    @State private var cameraUnavailable = false
    @State private var mirror = true
    /// Set once the call has taken the microphone and camera over.
    @State private var handedOver = false

    init(
        request: PreJoinRequest, onCancel: @escaping () -> Void,
        onConfirm: @escaping (LocalMedia, RTCAudioTrack?, RTCVideoTrack?, Bool, CallMediaProblem?) async -> Void
    ) {
        self.request = request
        self.onCancel = onCancel
        self.onConfirm = onConfirm
        _cameraOn = State(initialValue: request.isVideo)
    }

    private var isJoin: Bool { if case .join = request { return true }; return false }

    /// Who is about to be rung: from the call itself when joining one, else
    /// from the conversation, in the colour the chat shows them in.
    private var face: CallFace {
        switch request {
        case .start(let conversation, _, let title):
            return faces.face(slug: conversation, title: title)
        case .join(let callId, _, let title):
            if let call = CallCenter.shared.calls.first(where: { $0.id == callId }) {
                return faces.face(for: call, me: CallCenter.shared.me)
            }
            return .person(title, color: nil)
        }
    }

    var body: some View {
        CallPreJoinStage(
            model: CallPreJoinModel(
                title: request.title, face: face, isVideo: request.isVideo, isJoin: isJoin, loading: loading,
                micOn: micOn, micAvailable: micTrack != nil, micBlocked: micBlocked,
                cameraOn: cameraOn, cameraBlocked: cameraBlocked, cameraUnavailable: cameraUnavailable,
                camera: cameraTrack, mirror: mirror, problem: problem, micLevels: meter.levels
            ),
            actions: CallPreJoinActions(
                cancel: onCancel,
                toggleMic: {
                    Haptic.selection()
                    micOn.toggle()
                    micTrack?.isEnabled = micOn
                    listen()
                },
                toggleCamera: { Task { await toggleCamera() } },
                flip: { Task { await flip() } },
                dismissProblem: { withNeonAnimation(.smooth) { problem = nil } },
                confirm: {
                    handedOver = true
                    // The call takes the microphone from here: stop listening
                    // first, leaving the session for the call to use.
                    meter.handOver()
                    await onConfirm(media, micTrack, cameraOn ? cameraTrack : nil, !micOn || micTrack == nil, problem)
                }
            )
        )
        .task { await load() }
        .onAppear { faces.refresh() }
        .onDisappear {
            meter.release()
            if !handedOver { media.stopAll() }
        }
    }

    private func load() async {
        let opened = await openCallMedia(video: request.isVideo, media: media)
        micTrack = opened.mic
        cameraTrack = opened.camera
        cameraOn = opened.camera != nil
        mirror = media.cameraPosition == .front
        problem = opened.problem
        readBlocked()
        cameraUnavailable = request.isVideo && opened.problem == .noCamera
        withNeonAnimation(.smooth) { loading = false }
        listen()
    }

    /// Refused in Settings, as opposed to missing: read from the permission
    /// itself, so it stays true after the notice is closed.
    private func readBlocked() {
        func refused(_ type: AVMediaType) -> Bool {
            let status = AVCaptureDevice.authorizationStatus(for: type)
            return status == .denied || status == .restricted
        }
        micBlocked = refused(.audio)
        cameraBlocked = request.isVideo && refused(.video)
    }

    /// The level meter runs on a voice call while the microphone is on.
    private func listen() {
        guard !handedOver, !loading, !request.isVideo, micTrack != nil, micOn else {
            meter.stop()
            return
        }
        meter.start()
    }

    private func toggleCamera() async {
        Haptic.selection()
        if cameraOn {
            media.stopCamera()
            cameraTrack = nil
            cameraOn = false
            return
        }
        guard await callMediaAllowed(.video) else {
            problem = micTrack == nil ? .denied : .cameraDenied
            readBlocked()
            return
        }
        if let track = try? await media.startCamera() {
            cameraTrack = track
            cameraOn = true
            cameraUnavailable = false
            mirror = media.cameraPosition == .front
            if problem == .noCamera || problem == .cameraDenied { problem = nil }
        } else {
            problem = .noCamera
            cameraUnavailable = true
        }
    }

    private func flip() async {
        Haptic.selection()
        if let track = try? await media.flipCamera() {
            cameraTrack = track
            mirror = media.cameraPosition == .front
        }
    }
}
