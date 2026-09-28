import SwiftUI
import WebRTC

// The moment before a call: see yourself, hear that the microphone works,
// and choose to go in muted or with the camera off — the Swift counterpart
// of components/calls/pre-join.tsx. iOS has one camera to flip rather than a
// list of devices to pick from, so that replaces the web's device pickers.

struct PreJoinView: View {
    let request: PreJoinRequest
    let onCancel: () -> Void
    let onConfirm: (RTCAudioTrack?, RTCVideoTrack?, Bool, CallMediaProblem?) async -> Void

    @State private var media = LocalMedia()
    @State private var micTrack: RTCAudioTrack?
    @State private var cameraTrack: RTCVideoTrack?
    @State private var micOn = true
    @State private var cameraOn: Bool
    @State private var loading = true
    @State private var problem: CallMediaProblem?

    init(
        request: PreJoinRequest, onCancel: @escaping () -> Void,
        onConfirm: @escaping (RTCAudioTrack?, RTCVideoTrack?, Bool, CallMediaProblem?) async -> Void
    ) {
        self.request = request
        self.onCancel = onCancel
        self.onConfirm = onConfirm
        _cameraOn = State(initialValue: request.isVideo)
    }

    private var isJoin: Bool { if case .join = request { return true }; return false }
    private var primaryTitle: String {
        if isJoin { return L("Join call") }
        return request.isVideo ? L("Start video call") : L("Start call")
    }

    var body: some View {
        SheetScaffold(
            request.isVideo ? L("Video call") : L("Call"),
            subtitle: request.title,
            symbol: request.isVideo ? "video.fill" : "phone.fill",
            primaryTitle: primaryTitle
        ) {
            await onConfirm(micTrack, cameraOn ? cameraTrack : nil, !micOn, problem)
        } content: {
            preview

            if let problem {
                StatusNote(
                    symbol: "exclamationmark.triangle.fill", tone: .warning,
                    title: L("A device isn't available"), detail: problem.text
                )
            }

            HStack(spacing: NeonSpace.xl) {
                Spacer()
                IconButton(micOn ? "mic.fill" : "mic.slash.fill", label: L("Microphone"), look: micOn ? .glass : .filled, tint: micOn ? .neonInk : .neonDangerStrong, size: 52) {
                    micOn.toggle()
                    micTrack?.isEnabled = micOn
                }
                if request.isVideo {
                    IconButton(cameraOn ? "video.fill" : "video.slash.fill", label: L("Camera"), look: cameraOn ? .glass : .filled, tint: cameraOn ? .neonInk : .neonDangerStrong, size: 52) {
                        Task { await toggleCamera() }
                    }
                    IconButton("arrow.triangle.2.circlepath.camera", label: L("Flip camera"), size: 52) {
                        Task { await flip() }
                    }
                    .disabled(!cameraOn)
                }
                Spacer()
            }
        }
        .neonSheet([.large])
        .task { await load() }
        .onDisappear { media.stopAll() }
    }

    @ViewBuilder
    private var preview: some View {
        ZStack {
            RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous).fill(LinearGradient.neonInkHero)
            if let cameraTrack, cameraOn {
                CallVideoView(track: cameraTrack, mirror: media.cameraPosition == .front)
                    .clipShape(RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous))
            } else {
                VStack(spacing: NeonSpace.sm) {
                    Image(systemName: request.isVideo ? "video.slash.fill" : "waveform")
                        .font(.system(size: 36))
                        .foregroundStyle(.white.opacity(0.65))
                    if loading {
                        ProgressView().tint(.white)
                    } else if request.isVideo {
                        Text(L("Camera off")).font(.neonFootnote).foregroundStyle(.white.opacity(0.6))
                    }
                }
            }
        }
        .frame(height: 240)
        .frame(maxWidth: .infinity)
    }

    private func load() async {
        let opened = await openCallMedia(video: request.isVideo, media: media)
        micTrack = opened.mic
        cameraTrack = opened.camera
        cameraOn = opened.camera != nil
        problem = opened.problem
        loading = false
    }

    private func toggleCamera() async {
        if cameraOn {
            media.stopCamera()
            cameraTrack = nil
            cameraOn = false
        } else if let track = try? await media.startCamera() {
            cameraTrack = track
            cameraOn = true
        }
        Haptic.selection()
    }

    private func flip() async {
        if let track = try? await media.flipCamera() { cameraTrack = track }
        Haptic.selection()
    }
}
