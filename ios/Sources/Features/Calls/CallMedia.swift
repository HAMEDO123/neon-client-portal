import AVFoundation
import CoreMedia
import UIKit
import WebRTC

// The microphone and camera, as far as this device allows — the Swift
// counterpart of openMedia() in components/calls/call-session.ts. A missing
// or refused camera still gives a call with sound; a missing or refused
// microphone still lets somebody join to listen.

enum CallMediaProblem: String {
    /// Both refused in Settings.
    case denied
    /// The microphone refused in Settings: nobody hears this phone.
    case micDenied
    /// The camera refused in Settings.
    case cameraDenied
    case noMicrophone, noCamera, unavailable

    var text: String {
        switch self {
        case .denied: return L("The microphone and camera are blocked for this app. Allow them in Settings, then try again.")
        case .micDenied: return L("The microphone is blocked for this app, so nobody can hear you. Allow it in Settings.")
        case .cameraDenied: return L("The camera is blocked for this app. You can join with sound only, or allow it in Settings.")
        case .noMicrophone: return L("No microphone was found. You can still join and listen.")
        case .noCamera: return L("The camera is not available. You can join with sound only.")
        case .unavailable: return L("This device cannot make calls.")
        }
    }

    /// A refusal the person can undo in the Settings app.
    var fixedInSettings: Bool {
        switch self {
        case .denied, .micDenied, .cameraDenied: return true
        default: return false
        }
    }
}

/// Opens this app's page in Settings, where a refused microphone or camera
/// is allowed again.
@MainActor
func openCallSettings() {
    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
    UIApplication.shared.open(url)
}

/// The one PeerConnectionFactory the app needs, built once.
enum RTCEnvironment {
    static let factory: RTCPeerConnectionFactory = {
        _ = RTCInitializeSSL()
        return RTCPeerConnectionFactory(encoderFactory: RTCDefaultVideoEncoderFactory(), decoderFactory: RTCDefaultVideoDecoderFactory())
    }()
}

/// This device's own microphone and camera for one call: acquiring them,
/// flipping the camera, and releasing them when the call ends. Whoever holds
/// it owns the camera: the pre-join screen until the call starts, then the
/// call itself — so it is handed over, never dropped, or the camera stops
/// (or keeps running with nobody able to turn it off).
@MainActor
final class LocalMedia {
    private(set) var audioTrack: RTCAudioTrack?
    private(set) var videoTrack: RTCVideoTrack?
    private(set) var cameraPosition: AVCaptureDevice.Position = .front
    private var capturer: RTCCameraVideoCapturer?
    private var source: RTCVideoSource?

    func makeMicrophone() -> RTCAudioTrack {
        if let audioTrack { return audioTrack }
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let source = RTCEnvironment.factory.audioSource(with: constraints)
        let track = RTCEnvironment.factory.audioTrack(with: source, trackId: "mic-\(UUID().uuidString)")
        audioTrack = track
        return track
    }

    /// Starts the camera, preferring the front one unless asked otherwise.
    /// Throws when this device has no camera, or the app was refused one.
    ///
    /// A running camera switches device on the same capturer and track, so
    /// flipping never changes the track the other side is receiving.
    func startCamera(position: AVCaptureDevice.Position = .front) async throws -> RTCVideoTrack {
        let devices = RTCCameraVideoCapturer.captureDevices()
        guard let device = devices.first(where: { $0.position == position }) ?? devices.first else {
            throw CallMediaProblem.noCamera
        }

        let formats = RTCCameraVideoCapturer.supportedFormats(for: device)
        // The web asks for 1280x720; the format whose area is closest wins.
        let target = 1280 * 720
        let chosen = formats.min { a, b in
            let da = CMVideoFormatDescriptionGetDimensions(a.formatDescription)
            let db = CMVideoFormatDescriptionGetDimensions(b.formatDescription)
            return abs(Int(da.width) * Int(da.height) - target) < abs(Int(db.width) * Int(db.height) - target)
        }
        guard let format = chosen else { throw CallMediaProblem.noCamera }
        let fps = Int(format.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 24)

        let videoSource = source ?? RTCEnvironment.factory.videoSource()
        let videoCapturer = capturer ?? RTCCameraVideoCapturer(delegate: videoSource)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            videoCapturer.startCapture(with: device, format: format, fps: min(max(fps, 15), 30)) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }

        source = videoSource
        capturer = videoCapturer
        cameraPosition = device.position
        if let videoTrack { return videoTrack }
        let track = RTCEnvironment.factory.videoTrack(with: videoSource, trackId: "camera-\(UUID().uuidString)")
        videoTrack = track
        return track
    }

    func stopCamera() {
        capturer?.stopCapture()
        capturer = nil
        source = nil
        videoTrack = nil
    }

    /// Whether this device could plausibly show a camera preview at all
    /// (false on the simulator, which reports no capture devices).
    static var hasCamera: Bool { !RTCCameraVideoCapturer.captureDevices().isEmpty }

    func flipCamera() async throws -> RTCVideoTrack {
        try await startCamera(position: cameraPosition == .front ? .back : .front)
    }

    func stopAll() {
        audioTrack = nil
        stopCamera()
    }
}

extension CallMediaProblem: Error {}

/// The microphone (and, if asked for, the camera), opened once before a call
/// begins — mirrors `openMedia` on the web. Each is asked for on its own, so
/// a refused microphone does not also cost the picture, nor the other way.
@MainActor
func openCallMedia(video: Bool, media: LocalMedia) async -> (mic: RTCAudioTrack?, camera: RTCVideoTrack?, problem: CallMediaProblem?) {
    let micAllowed = await callMediaAllowed(.audio)
    let mic = micAllowed ? media.makeMicrophone() : nil
    let micProblem: CallMediaProblem? = micAllowed ? nil : .micDenied
    guard video else { return (mic, nil, micProblem) }

    guard await callMediaAllowed(.video) else {
        return (mic, nil, micAllowed ? .cameraDenied : .denied)
    }
    guard LocalMedia.hasCamera else { return (mic, nil, micProblem ?? .noCamera) }
    do {
        let camera = try await media.startCamera()
        return (mic, camera, micProblem)
    } catch {
        return (mic, nil, micProblem ?? .noCamera)
    }
}

/// Allowed already, or allowed when asked now.
@MainActor
func callMediaAllowed(_ mediaType: AVMediaType) async -> Bool {
    switch AVCaptureDevice.authorizationStatus(for: mediaType) {
    case .authorized: return true
    case .notDetermined:
        return await withCheckedContinuation { continuation in
            AVCaptureDevice.requestAccess(for: mediaType) { granted in continuation.resume(returning: granted) }
        }
    default: return false
    }
}

/// How loud the microphone is, for the pre-join screen to show that it hears
/// something before anybody is rung. It listens through a recorder that
/// writes nowhere (/dev/null) and reads only its meter; nothing is kept.
///
/// It never runs while a call is going — the call owns the microphone and the
/// audio session then — and it stops before the pre-join hands the
/// microphone over, so the call starts on a session nothing else is using.
@MainActor
final class CallMicLevelMonitor: ObservableObject {
    /// How many recent levels are kept for the bars.
    static let count = 14

    /// 0…1, newest last.
    @Published private(set) var levels: [Double] = []
    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    /// This monitor switched the audio session on, so it switches it off.
    private var ownsSession = false

    func start() {
        guard recorder == nil, CallCenter.shared.session == nil else { return }
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else { return }
        let session = AVAudioSession.sharedInstance()
        do {
            // The call's own category and mode, so starting the call after
            // this changes nothing about where the sound goes.
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP])
            try session.setActive(true)
            ownsSession = true
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: 16_000,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
            ]
            let recorder = try AVAudioRecorder(url: URL(fileURLWithPath: "/dev/null"), settings: settings)
            recorder.isMeteringEnabled = true
            guard recorder.record() else { return }
            self.recorder = recorder
            levels = []
            timer?.invalidate()
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.tick() }
            }
        } catch {
            recorder = nil
        }
    }

    /// Stops listening, leaving the session as it is — for handing the
    /// microphone to a call about to start, or for a switched-off microphone.
    func stop() {
        timer?.invalidate()
        timer = nil
        recorder?.stop()
        recorder = nil
        levels = []
    }

    /// Stops listening because the call is taking the microphone. Where
    /// CallKit carries calls, the session is switched off too: CallKit
    /// switches it on for the call itself, and Apple's advice is not to hand
    /// it one an app has already activated.
    func handOver() {
        stop()
        guard ownsSession, CallKitCenter.shared.routesCalls else { return }
        ownsSession = false
        try? AVAudioSession.sharedInstance().setActive(false)
    }

    /// Stops, and gives the sound back to whatever was playing before —
    /// unless a call has taken the session over in the meantime.
    func release() {
        stop()
        guard ownsSession else { return }
        ownsSession = false
        if CallCenter.shared.session == nil {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    private func tick() {
        guard let recorder else { return }
        recorder.updateMeters()
        // Decibels (−160…0) to a bar: the bottom 50 dB are silence to the ear.
        let power = Double(recorder.averagePower(forChannel: 0))
        var next = levels
        next.append(max(0, min(1, (power + 50) / 50)))
        if next.count > Self.count { next.removeFirst(next.count - Self.count) }
        levels = next
    }
}
