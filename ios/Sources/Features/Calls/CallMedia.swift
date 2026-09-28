import AVFoundation
import CoreMedia
import WebRTC

// The microphone and camera, as far as this device allows — the Swift
// counterpart of openMedia() in components/calls/call-session.ts. A missing
// or refused camera still gives a call with sound; a missing or refused
// microphone still lets somebody join to listen.

enum CallMediaProblem: String {
    case denied, noMicrophone, noCamera, unavailable

    var text: String {
        switch self {
        case .denied: return L("The microphone and camera are blocked for this app. Allow them in Settings, then try again.")
        case .noMicrophone: return L("No microphone was found. You can still join and listen.")
        case .noCamera: return L("The camera is not available. You can join with sound only.")
        case .unavailable: return L("This device cannot make calls.")
        }
    }
}

/// The one PeerConnectionFactory the app needs, built once.
enum RTCEnvironment {
    static let factory: RTCPeerConnectionFactory = {
        RTCPeerConnectionFactory(encoderFactory: RTCDefaultVideoEncoderFactory(), decoderFactory: RTCDefaultVideoDecoderFactory())
    }()
}

/// This device's own microphone and camera for one call: acquiring them,
/// flipping the camera, and releasing them when the call ends.
@MainActor
final class LocalMedia {
    private(set) var audioTrack: RTCAudioTrack?
    private(set) var videoTrack: RTCVideoTrack?
    private(set) var cameraPosition: AVCaptureDevice.Position = .front
    private var capturer: RTCCameraVideoCapturer?

    func makeMicrophone() -> RTCAudioTrack {
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let source = RTCEnvironment.factory.audioSource(with: constraints)
        let track = RTCEnvironment.factory.audioTrack(with: source, trackId: "mic-\(UUID().uuidString)")
        audioTrack = track
        return track
    }

    /// Starts the camera, preferring the front one unless asked otherwise.
    /// Throws when this device has no camera, or the app was refused one.
    func startCamera(position: AVCaptureDevice.Position = .front) async throws -> RTCVideoTrack {
        let devices = RTCCameraVideoCapturer.captureDevices()
        guard let device = devices.first(where: { $0.position == position }) ?? devices.first else {
            throw CallMediaProblem.noCamera
        }

        let formats = RTCCameraVideoCapturer.supportedFormats(for: device)
        let target = formats.max { a, b in
            let da = CMVideoFormatDescriptionGetDimensions(a.formatDescription)
            let db = CMVideoFormatDescriptionGetDimensions(b.formatDescription)
            // The web asks for 1280x720; the closest format at or below that
            // is picked here by scoring how close each format's area is to it.
            let target = 1280 * 720
            let scoreA = -abs(Int(da.width) * Int(da.height) - target)
            let scoreB = -abs(Int(db.width) * Int(db.height) - target)
            return scoreA < scoreB
        }
        guard let format = target else { throw CallMediaProblem.noCamera }
        let fps = Int(format.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 24)

        let source = RTCEnvironment.factory.videoSource()
        let newCapturer = RTCCameraVideoCapturer(delegate: source)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            newCapturer.startCapture(with: device, format: format, fps: min(max(fps, 15), 30)) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }

        capturer?.stopCapture(completionHandler: nil)
        capturer = newCapturer
        let track = RTCEnvironment.factory.videoTrack(with: source, trackId: "camera-\(UUID().uuidString)")
        videoTrack = track
        cameraPosition = position
        return track
    }

    func stopCamera() {
        capturer?.stopCapture(completionHandler: nil)
        capturer = nil
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
/// begins — mirrors `openMedia` on the web.
@MainActor
func openCallMedia(video: Bool, media: LocalMedia) async -> (mic: RTCAudioTrack?, camera: RTCVideoTrack?, problem: CallMediaProblem?) {
    let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
    if micStatus == .denied || micStatus == .restricted {
        return (nil, nil, .denied)
    }
    let micGranted = await requestAccess(for: .audio)
    guard micGranted else { return (nil, nil, .denied) }

    let mic = media.makeMicrophone()
    guard video else { return (mic, nil, nil) }

    let cameraStatus = AVCaptureDevice.authorizationStatus(for: .video)
    if cameraStatus == .denied || cameraStatus == .restricted { return (mic, nil, .noCamera) }
    let cameraGranted = await requestAccess(for: .video)
    guard cameraGranted, LocalMedia.hasCamera else { return (mic, nil, .noCamera) }

    do {
        let camera = try await media.startCamera()
        return (mic, camera, nil)
    } catch {
        return (mic, nil, .noCamera)
    }
}

private func requestAccess(for mediaType: AVMediaType) async -> Bool {
    await withCheckedContinuation { continuation in
        AVCaptureDevice.requestAccess(for: mediaType) { granted in continuation.resume(returning: granted) }
    }
}
