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
    var isVideo: Bool
    var isJoin: Bool
    var loading: Bool
    var micOn: Bool
    /// False when the microphone was refused: the toggle has nothing to switch.
    var micAvailable: Bool
    var cameraOn: Bool
    var camera: RTCVideoTrack?
    var mirror: Bool
    var problem: CallMediaProblem?
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

    private var primaryTitle: String {
        if model.isJoin { return L("Join call") }
        return model.isVideo ? L("Start video call") : L("Start call")
    }

    var body: some View {
        ZStack {
            CallBackdrop(hue: NeonPalette.hue(for: model.title))

            VStack(spacing: NeonSpace.lg) {
                header
                preview
                    .frame(maxHeight: .infinity)
                    .neonAppear(delay: 0.05)
                if let problem = model.problem {
                    CallNoticeBanner(
                        text: problem.text,
                        actionTitle: problem.fixedInSettings ? L("Open Settings") : nil,
                        action: problem.fixedInSettings ? { openCallSettings() } : nil,
                        onDismiss: actions.dismissProblem
                    )
                    .transition(.neonRise)
                }
                toggles
                    .neonAppear(delay: 0.1)
                NeonButton(primaryTitle, symbol: model.isVideo ? "video.fill" : "phone.fill", kind: .brand) {
                    await actions.confirm()
                }
                .disabled(model.loading)
                .neonAppear(delay: 0.15)
            }
            .padding(.horizontal, NeonSpace.gutter)
            .padding(.bottom, NeonSpace.sm)
        }
        .animation(NeonMotion.smooth, value: model.cameraOn)
        .animation(NeonMotion.smooth, value: model.problem)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: NeonSpace.md) {
            VStack(alignment: .leading, spacing: 3) {
                Label(model.isVideo ? L("Video call") : L("Call"), systemImage: model.isVideo ? "video.fill" : "phone.fill")
                    .font(.system(.caption, weight: .semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(.white.opacity(0.7))
                DirText(model.title, font: .neonTitle2, color: .white, fill: false, lineLimit: 2)
                Text(model.isJoin ? L("The call is already going. Check how you look and sound first.") : L("Check how you look and sound before anybody is rung."))
                    .font(.neonSubtitle)
                    .foregroundStyle(.white.opacity(0.7))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            IconButton("xmark", label: L("Cancel"), look: .glass, tint: .white, size: NeonSize.circleButton) {
                actions.cancel()
            }
        }
        .padding(.top, NeonSpace.sm)
    }

    private var preview: some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.xl, style: .continuous)
        return ZStack {
            LinearGradient(colors: [NeonPalette.hue(for: model.title).deep.opacity(0.55), Color.neonInk.opacity(0.85)], startPoint: .topLeading, endPoint: .bottomTrailing)
            if let camera = model.camera, model.cameraOn {
                CallVideoView(track: camera, mirror: model.mirror)
                    .transition(.opacity)
            } else {
                VStack(spacing: NeonSpace.md) {
                    if model.loading {
                        ProgressView().tint(.white).controlSize(.large)
                        Text(L("Opening the microphone and camera…"))
                            .font(.neonFootnote)
                            .foregroundStyle(.white.opacity(0.75))
                    } else if model.isVideo {
                        Image(systemName: "video.slash.fill")
                            .font(.system(size: 34, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.75))
                            .frame(width: 84, height: 84)
                            .background(CallGlass(shape: Circle(), strength: 0.2))
                        Text(L("Camera off"))
                            .font(.system(.subheadline, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.85))
                    } else {
                        CallHalo(name: model.title, size: 104)
                        Text(L("Voice only — no camera on this call."))
                            .font(.neonFootnote)
                            .foregroundStyle(.white.opacity(0.75))
                    }
                }
                .transition(.opacity)
            }
        }
        .clipShape(shape)
        .overlay(shape.strokeBorder(Color.white.opacity(0.14), lineWidth: 1))
        .overlay(alignment: .bottomLeading) {
            HStack(spacing: NeonSpace.sm) {
                statusChip(
                    model.micAvailable ? (model.micOn ? L("Microphone on") : L("You'll join muted")) : L("No microphone"),
                    symbol: model.micOn && model.micAvailable ? "mic.fill" : "mic.slash.fill",
                    warn: !model.micOn || !model.micAvailable
                )
                if model.isVideo {
                    statusChip(
                        model.cameraOn ? L("Camera on") : L("Camera off"),
                        symbol: model.cameraOn ? "video.fill" : "video.slash.fill",
                        warn: !model.cameraOn
                    )
                }
            }
            .padding(NeonSpace.md)
            .opacity(model.loading ? 0 : 1)
        }
        .neonShadow(.floating)
    }

    private func statusChip(_ text: String, symbol: String, warn: Bool) -> some View {
        HStack(spacing: 5) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(warn ? Color.neonDanger : Color.neonSuccess)
            Text(text)
                .font(.system(.caption, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(CallGlass(shape: Capsule(), strength: 0.35))
    }

    private var toggles: some View {
        HStack(alignment: .top, spacing: 0) {
            CallRoundButton(
                symbol: model.micOn && model.micAvailable ? "mic.fill" : "mic.slash.fill", title: L("Microphone"),
                look: model.micOn && model.micAvailable ? .glass : .active, value: model.micOn ? L("On") : L("Off"),
                action: actions.toggleMic
            )
            .disabled(!model.micAvailable || model.loading)
            .frame(maxWidth: .infinity)
            if model.isVideo {
                CallRoundButton(
                    symbol: model.cameraOn ? "video.fill" : "video.slash.fill", title: L("Camera"),
                    look: model.cameraOn ? .glass : .active, value: model.cameraOn ? L("On") : L("Off"),
                    action: actions.toggleCamera
                )
                .disabled(model.loading)
                .frame(maxWidth: .infinity)
                CallRoundButton(symbol: "arrow.triangle.2.circlepath.camera.fill", title: L("Flip camera"), action: actions.flip)
                    .disabled(!model.cameraOn || model.loading)
                    .opacity(model.cameraOn ? 1 : 0.45)
                    .frame(maxWidth: .infinity)
            }
        }
    }
}

/// The pre-join screen with the real microphone and camera behind it.
struct PreJoinView: View {
    let request: PreJoinRequest
    let onCancel: () -> Void
    let onConfirm: (LocalMedia, RTCAudioTrack?, RTCVideoTrack?, Bool, CallMediaProblem?) async -> Void

    @State private var media = LocalMedia()
    @State private var micTrack: RTCAudioTrack?
    @State private var cameraTrack: RTCVideoTrack?
    @State private var micOn = true
    @State private var cameraOn: Bool
    @State private var loading = true
    @State private var problem: CallMediaProblem?
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

    var body: some View {
        CallPreJoinStage(
            model: CallPreJoinModel(
                title: request.title, isVideo: request.isVideo, isJoin: isJoin, loading: loading,
                micOn: micOn, micAvailable: micTrack != nil, cameraOn: cameraOn, camera: cameraTrack,
                mirror: mirror, problem: problem
            ),
            actions: CallPreJoinActions(
                cancel: {
                    Haptic.tap()
                    onCancel()
                },
                toggleMic: {
                    Haptic.selection()
                    micOn.toggle()
                    micTrack?.isEnabled = micOn
                },
                toggleCamera: { Task { await toggleCamera() } },
                flip: { Task { await flip() } },
                dismissProblem: { withNeonAnimation(.smooth) { problem = nil } },
                confirm: {
                    handedOver = true
                    await onConfirm(media, micTrack, cameraOn ? cameraTrack : nil, !micOn || micTrack == nil, problem)
                }
            )
        )
        .task { await load() }
        .onDisappear { if !handedOver { media.stopAll() } }
    }

    private func load() async {
        let opened = await openCallMedia(video: request.isVideo, media: media)
        micTrack = opened.mic
        cameraTrack = opened.camera
        cameraOn = opened.camera != nil
        mirror = media.cameraPosition == .front
        problem = opened.problem
        withNeonAnimation(.smooth) { loading = false }
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
            return
        }
        if let track = try? await media.startCamera() {
            cameraTrack = track
            cameraOn = true
            mirror = media.cameraPosition == .front
            if problem == .noCamera || problem == .cameraDenied { problem = nil }
        } else {
            problem = .noCamera
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
