import AVFoundation
import SwiftUI
import UIKit

// The chat camera's engine: one AVCaptureSession with a photo output and a
// movie output side by side, so a photo and a video are both one touch away
// (holding the shutter in PHOTO records, as WhatsApp does).
//
// Threading: everything that touches the session or a device runs on `queue`;
// everything @Published is written on the main thread only. Device rotation is
// read on the main thread at the moment of capture and handed to the queue.

/// What the shutter does.
enum ChatCameraMode: Int, CaseIterable, Identifiable {
    case video, photo, videoNote

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .video: return L("Video")
        case .photo: return L("Photo")
        case .videoNote: return L("Video note")
        }
    }

    /// The longest recording, in seconds: three minutes for a video (it has
    /// to fit the server's 50 MB for a file after it is made into an MP4), a
    /// minute for a video note.
    var maxSeconds: Double { self == .videoNote ? 60 : 180 }
}

/// The flash button's three states, in the order a tap cycles them.
enum ChatCameraFlash: CaseIterable {
    case off, on, auto

    var symbol: String {
        switch self {
        case .off: return "bolt.slash.fill"
        case .on: return "bolt.fill"
        case .auto: return "bolt.badge.automatic.fill"
        }
    }

    var label: String {
        switch self {
        case .off: return L("Flash off")
        case .on: return L("Flash on")
        case .auto: return L("Flash auto")
        }
    }

    var avMode: AVCaptureDevice.FlashMode {
        switch self {
        case .off: return .off
        case .on: return .on
        case .auto: return .auto
        }
    }
}

final class ChatCameraController: NSObject, ObservableObject, @unchecked Sendable {
    enum Access: Equatable {
        /// Not asked yet, or being set up.
        case unknown
        case granted
        /// The person said no (or a profile forbids it).
        case denied
        /// No camera at all — the simulator.
        case unavailable
    }

    // MARK: Main-thread state, for the screen

    @Published private(set) var access: Access = .unknown
    /// Another app, a call, or Split View has the camera for now.
    @Published private(set) var interrupted = false
    @Published private(set) var position: AVCaptureDevice.Position = .back
    /// The lens on now — the preview turns its picture by it.
    @Published private(set) var device: AVCaptureDevice?
    /// The back lens has a flash; the front one lights the screen instead.
    @Published private(set) var hasFlash = false
    @Published var flash: ChatCameraFlash = .off
    /// Low light: the photo is taken at the system's "quality" priority, which
    /// lets it fuse several frames — slower, and much cleaner in the dark.
    @Published var lowLight = false
    /// The zoom button's stops, as people read them (0.5×, 1×, 2×, 3×).
    @Published private(set) var zoomStops: [CGFloat] = [1]
    @Published private(set) var zoom: CGFloat = 1
    @Published private(set) var recordingSince: Date?
    /// A photo is being taken.
    @Published private(set) var busy = false
    /// The front camera's flash: the whole screen white for a moment.
    @Published private(set) var screenLight = false
    /// Bumped as the shutter fires, for the preview's blink.
    @Published private(set) var shutterCount = 0

    var isRecording: Bool { recordingSince != nil }

    let session = AVCaptureSession()

    /// The preview, for turning a tap into a point on the sensor.
    weak var previewLayer: AVCaptureVideoPreviewLayer?

    // MARK: Capture-queue state

    private let queue = DispatchQueue(label: "com.neonjo.chat-camera")
    private let photoOutput = AVCapturePhotoOutput()
    private let movieOutput = AVCaptureMovieFileOutput()
    private var videoInput: AVCaptureDeviceInput?
    private var audioInput: AVCaptureDeviceInput?
    private var configured = false
    /// The device zoom factor that reads as "1×": on a phone with an
    /// ultra-wide lens the virtual camera's 1.0 is the ultra-wide (0.5×).
    private var zoomBase: CGFloat = 1
    private var photoDelegates: [Int64: ChatPhotoCaptureDelegate] = [:]
    private var movieDone: ((URL?) -> Void)?
    /// A stop that came before the recording had started (a quick release).
    private var stopRequested = false
    private var recordings: [URL] = []

    // MARK: Main-only

    private var observers: [NSObjectProtocol] = []
    private var lastDeviceOrientation: UIDeviceOrientation = .portrait
    /// AVCaptureDevice.RotationCoordinator on iOS 17 and later.
    private var rotation: AnyObject?
    private var savedBrightness: CGFloat?

    // MARK: Running

    /// Asks for the camera if it has not been asked, then starts it.
    @MainActor
    func start() {
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
        if observers.isEmpty { observe() }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            run()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if granted { self.run() } else { self.access = .denied }
                }
            }
        default:
            access = .denied
        }
    }

    /// Stops the session while the photo is being edited, to spare the battery.
    func pause() {
        queue.async { [session] in
            if session.isRunning { session.stopRunning() }
        }
    }

    func resume() {
        guard access == .granted else { return }
        run()
    }

    /// The screen is going: stops, lets go of the microphone and deletes the
    /// recordings it made (anything sent was read into memory first).
    @MainActor
    func stop() {
        UIDevice.current.endGeneratingDeviceOrientationNotifications()
        observers.forEach(NotificationCenter.default.removeObserver)
        observers = []
        restoreBrightness()
        queue.async { [self] in
            if movieOutput.isRecording { movieOutput.stopRecording() }
            if session.isRunning { session.stopRunning() }
            setTorch(.off)
            for url in recordings { try? FileManager.default.removeItem(at: url) }
            recordings = []
        }
    }

    private func run() {
        queue.async { [self] in
            if !configured {
                guard let camera = Self.camera(.back) ?? Self.camera(.front) else {
                    DispatchQueue.main.async { self.access = .unavailable }
                    return
                }
                configure(with: camera)
            }
            if !session.isRunning { session.startRunning() }
            DispatchQueue.main.async { self.access = .granted }
        }
    }

    private func configure(with camera: AVCaptureDevice) {
        guard let input = try? AVCaptureDeviceInput(device: camera) else { return }
        session.beginConfiguration()
        // High rather than Photo, so a recording can start the moment the
        // shutter is held; the photo output still takes a full-size photo
        // (maxPhotoDimensions, set per lens below).
        if session.canSetSessionPreset(.high) { session.sessionPreset = .high }
        if session.canAddInput(input) {
            session.addInput(input)
            videoInput = input
        }
        if session.canAddOutput(photoOutput) {
            session.addOutput(photoOutput)
            photoOutput.maxPhotoQualityPrioritization = .quality
        }
        if session.canAddOutput(movieOutput) { session.addOutput(movieOutput) }
        session.commitConfiguration()
        configured = true
        lensChanged(camera)
    }

    /// Everything that follows the lens: its zoom stops, the largest photo it
    /// takes (12 MP at most — a 48 MP photo is slow to take and to edit, and
    /// the server keeps 2400 pixels), its flash, and focus that comes back to
    /// the middle once the scene changes.
    private func lensChanged(_ camera: AVCaptureDevice) {
        let dimensions = camera.activeFormat.supportedMaxPhotoDimensions
        let fitting = dimensions.filter { Int($0.width) * Int($0.height) <= 12_600_000 }
        if let best = (fitting.isEmpty ? dimensions : fitting).max(by: { Int($0.width) * Int($0.height) < Int($1.width) * Int($1.height) }) {
            photoOutput.maxPhotoDimensions = best
        }

        let switchOvers = camera.virtualDeviceSwitchOverVideoZoomFactors.map { CGFloat(truncating: $0) }
        let kinds = camera.constituentDevices.map(\.deviceType)
        let ultraWide = kinds.contains(.builtInUltraWideCamera)
        zoomBase = ultraWide ? (switchOvers.first ?? 2) : 1
        var stops: [CGFloat] = []
        if ultraWide { stops.append((1 / zoomBase * 10).rounded() / 10) }
        stops.append(1)
        if camera.position == .back, camera.maxAvailableVideoZoomFactor >= zoomBase * 2 { stops.append(2) }
        if kinds.contains(.builtInTelephotoCamera), let tele = switchOvers.last {
            let factor = (tele / zoomBase).rounded()
            if factor > 2, !stops.contains(factor) { stops.append(factor) }
        }

        if (try? camera.lockForConfiguration()) != nil {
            camera.videoZoomFactor = max(camera.minAvailableVideoZoomFactor, min(zoomBase, camera.maxAvailableVideoZoomFactor))
            // Watched only after a tap to focus, to let go of that point.
            camera.isSubjectAreaChangeMonitoringEnabled = false
            if camera.isFocusModeSupported(.continuousAutoFocus) { camera.focusMode = .continuousAutoFocus }
            if camera.isExposureModeSupported(.continuousAutoExposure) { camera.exposureMode = .continuousAutoExposure }
            camera.unlockForConfiguration()
        }

        let flash = camera.position == .front || camera.hasFlash
        let position = camera.position
        DispatchQueue.main.async { [self] in
            self.device = camera
            self.position = position
            self.hasFlash = flash
            self.zoomStops = stops
            self.zoom = 1
            if position == .front, self.flash == .auto { self.flash = .on }
            if #available(iOS 17.0, *) {
                self.rotation = AVCaptureDevice.RotationCoordinator(device: camera, previewLayer: nil)
            }
        }
    }

    private func observe() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIDevice.orientationDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            let orientation = UIDevice.current.orientation
            if orientation.isPortrait || orientation.isLandscape { self?.lastDeviceOrientation = orientation }
        })
        observers.append(center.addObserver(forName: .AVCaptureSessionWasInterrupted, object: session, queue: .main) { [weak self] _ in
            self?.interrupted = true
        })
        observers.append(center.addObserver(forName: .AVCaptureSessionInterruptionEnded, object: session, queue: .main) { [weak self] _ in
            self?.interrupted = false
        })
        observers.append(center.addObserver(forName: .AVCaptureSessionRuntimeError, object: session, queue: .main) { [weak self] _ in
            guard let self else { return }
            // Media services were reset, or the session fell over: start it again.
            self.queue.async { [session = self.session] in
                if !session.isRunning { session.startRunning() }
            }
        })
        observers.append(center.addObserver(forName: .AVCaptureDeviceSubjectAreaDidChange, object: nil, queue: nil) { [weak self] _ in
            self?.queue.async { self?.recentre() }
        })
    }

    // MARK: Lenses and zoom

    @MainActor
    func flip() {
        guard !isRecording, access == .granted else { return }
        let target: AVCaptureDevice.Position = position == .back ? .front : .back
        Haptic.tap()
        queue.async { [self] in
            guard let camera = Self.camera(target), let input = try? AVCaptureDeviceInput(device: camera) else { return }
            session.beginConfiguration()
            if let old = videoInput { session.removeInput(old) }
            if session.canAddInput(input) {
                session.addInput(input)
                videoInput = input
            } else if let old = videoInput, session.canAddInput(old) {
                session.addInput(old)
            }
            session.commitConfiguration()
            if let current = videoInput?.device { lensChanged(current) }
        }
    }

    /// The front camera for a video note, as people expect a selfie video.
    @MainActor
    func useFront() {
        if position != .front { flip() }
    }

    /// Zoom as people read it (1× is the main lens), clamped to what the lens
    /// can do and to 10× at most.
    func setZoom(_ value: CGFloat, animated: Bool = false) {
        queue.async { [self] in
            guard let camera = videoInput?.device, (try? camera.lockForConfiguration()) != nil else { return }
            let ceiling = min(camera.maxAvailableVideoZoomFactor, zoomBase * 10)
            let factor = max(camera.minAvailableVideoZoomFactor, min(value * zoomBase, ceiling))
            if animated {
                camera.ramp(toVideoZoomFactor: factor, withRate: 12)
            } else {
                camera.videoZoomFactor = factor
            }
            camera.unlockForConfiguration()
            let shown = factor / zoomBase
            DispatchQueue.main.async { self.zoom = shown }
        }
    }

    /// The zoom button: the next stop after the one it is nearest.
    @MainActor
    func nextZoomStop() {
        guard zoomStops.count > 1 else { return }
        let nearest = zoomStops.enumerated().min { abs($0.element - zoom) < abs($1.element - zoom) }?.offset ?? 0
        let next = zoomStops[(nearest + 1) % zoomStops.count]
        Haptic.selection()
        setZoom(next, animated: true)
    }

    // MARK: Focus

    /// Focuses and exposes on a point of the preview.
    func focus(atLayerPoint point: CGPoint) {
        guard let layer = previewLayer else { return }
        let devicePoint = layer.captureDevicePointConverted(fromLayerPoint: point)
        queue.async { [self] in
            guard let camera = videoInput?.device, (try? camera.lockForConfiguration()) != nil else { return }
            if camera.isFocusPointOfInterestSupported, camera.isFocusModeSupported(.autoFocus) {
                camera.focusPointOfInterest = devicePoint
                camera.focusMode = .autoFocus
            }
            if camera.isExposurePointOfInterestSupported, camera.isExposureModeSupported(.autoExpose) {
                camera.exposurePointOfInterest = devicePoint
                camera.exposureMode = .autoExpose
            }
            camera.isSubjectAreaChangeMonitoringEnabled = true
            camera.unlockForConfiguration()
        }
    }

    /// The scene changed after a tap to focus: back to the middle, continuously.
    private func recentre() {
        guard let camera = videoInput?.device, (try? camera.lockForConfiguration()) != nil else { return }
        let middle = CGPoint(x: 0.5, y: 0.5)
        if camera.isFocusPointOfInterestSupported { camera.focusPointOfInterest = middle }
        if camera.isFocusModeSupported(.continuousAutoFocus) { camera.focusMode = .continuousAutoFocus }
        if camera.isExposurePointOfInterestSupported { camera.exposurePointOfInterest = middle }
        if camera.isExposureModeSupported(.continuousAutoExposure) { camera.exposureMode = .continuousAutoExposure }
        camera.isSubjectAreaChangeMonitoringEnabled = false
        camera.unlockForConfiguration()
    }

    // MARK: Photos

    /// Takes a photo, upright and at most 4096 pixels on its longest side,
    /// and hands it over on the main thread (nil if it failed).
    @MainActor
    func takePhoto(_ completion: @escaping (UIImage?) -> Void) {
        guard access == .granted, !busy, !isRecording else { return }
        busy = true
        let angle = captureAngle()
        let flash = flash
        let lowLight = lowLight
        let front = position == .front

        let shoot: () -> Void = { [self] in
            queue.async { [self] in
                let settings = AVCapturePhotoSettings()
                if !front, photoOutput.supportedFlashModes.contains(flash.avMode) { settings.flashMode = flash.avMode }
                settings.maxPhotoDimensions = photoOutput.maxPhotoDimensions
                let priority: AVCapturePhotoOutput.QualityPrioritization = lowLight ? .quality : .balanced
                settings.photoQualityPrioritization = priority.rawValue <= photoOutput.maxPhotoQualityPrioritization.rawValue
                    ? priority : photoOutput.maxPhotoQualityPrioritization
                if let connection = photoOutput.connection(with: .video) {
                    Self.apply(angle: angle, to: connection)
                    if connection.isVideoMirroringSupported {
                        connection.automaticallyAdjustsVideoMirroring = false
                        connection.isVideoMirrored = false
                    }
                }
                let id = settings.uniqueID
                let delegate = ChatPhotoCaptureDelegate(
                    willCapture: {
                        DispatchQueue.main.async { self.shutterCount += 1 }
                    },
                    finished: { [weak self] data in
                        let image = data.flatMap(UIImage.init(data:))?.chatUpright(maxDimension: 4096)
                        DispatchQueue.main.async {
                            guard let self else { return }
                            self.busy = false
                            self.restoreBrightness()
                            completion(image)
                        }
                        self?.queue.async { self?.photoDelegates[id] = nil }
                    }
                )
                photoDelegates[id] = delegate
                photoOutput.capturePhoto(with: settings, delegate: delegate)
            }
        }

        if front, flash != .off {
            // The front camera has no flash: the screen is the light, as the
            // system camera does it — white, at full brightness, for a moment.
            if let screen = Self.screen {
                savedBrightness = screen.brightness
                screen.brightness = 1
            }
            screenLight = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { shoot() }
        } else {
            shoot()
        }
    }

    private func restoreBrightness() {
        if screenLight { screenLight = false }
        if let savedBrightness {
            Self.screen?.brightness = savedBrightness
            self.savedBrightness = nil
        }
    }

    /// The screen the app is on (UIScreen.main is deprecated).
    private static var screen: UIScreen? {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }?.screen
    }

    // MARK: Video

    /// Starts recording. `completion` gets the finished file, or nil when it
    /// failed or was too short to be meant (a tap that brushed the shutter).
    @MainActor
    func startRecording(mode: ChatCameraMode, completion: @escaping (URL?) -> Void) {
        guard access == .granted, !isRecording, !busy else { return }
        let angle = captureAngle()
        // A call has the microphone: the video is recorded without sound
        // rather than taking it from the call.
        let inCall = CallCenter.shared.session != nil
        // The flash, for a video, is the torch: on, or on when it is dark.
        let torch: AVCaptureDevice.TorchMode = position == .front ? .off : (flash == .on ? .on : flash == .auto ? .auto : .off)
        let seconds = mode.maxSeconds

        // A stop from here on is about this recording (one left over from a
        // recording that already ended is forgotten).
        queue.async { [self] in stopRequested = false }
        withMicrophone { [self] microphone in
            queue.async { [self] in
                if stopRequested {
                    // Let go while the microphone was being asked about.
                    stopRequested = false
                    DispatchQueue.main.async { completion(nil) }
                    return
                }
                if microphone, !inCall, audioInput == nil,
                   let mic = AVCaptureDevice.default(for: .audio),
                   let input = try? AVCaptureDeviceInput(device: mic) {
                    // Added on the first recording rather than when the camera
                    // opens, so taking photos never lights the microphone dot.
                    session.beginConfiguration()
                    if session.canAddInput(input) {
                        session.addInput(input)
                        audioInput = input
                    }
                    session.commitConfiguration()
                }
                guard session.isRunning, !movieOutput.isRecording else {
                    DispatchQueue.main.async { completion(nil) }
                    return
                }
                if let connection = movieOutput.connection(with: .video) {
                    Self.apply(angle: angle, to: connection)
                    if connection.isVideoMirroringSupported {
                        connection.automaticallyAdjustsVideoMirroring = false
                        connection.isVideoMirrored = false
                    }
                    if connection.isVideoStabilizationSupported { connection.preferredVideoStabilizationMode = .auto }
                }
                movieOutput.maxRecordedDuration = CMTime(seconds: seconds, preferredTimescale: 600)
                setTorch(torch)
                let url = FileManager.default.temporaryDirectory
                    .appendingPathComponent("chat-camera-\(UUID().uuidString)")
                    .appendingPathExtension("mov")
                recordings.append(url)
                movieDone = completion
                movieOutput.startRecording(to: url, recordingDelegate: self)
            }
        }
    }

    func stopRecording() {
        queue.async { [self] in
            if movieOutput.isRecording {
                movieOutput.stopRecording()
            } else {
                // Released before the recording had begun.
                stopRequested = true
            }
        }
    }

    /// The microphone's answer, asking the first time. A recording goes on
    /// without sound when it is off.
    private func withMicrophone(_ then: @escaping (Bool) -> Void) {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: then(true)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async { then(granted) }
            }
        default: then(false)
        }
    }

    private func setTorch(_ mode: AVCaptureDevice.TorchMode) {
        guard let camera = videoInput?.device, camera.hasTorch, camera.isTorchModeSupported(mode),
              camera.torchMode != mode, (try? camera.lockForConfiguration()) != nil else { return }
        camera.torchMode = mode
        camera.unlockForConfiguration()
    }

    // MARK: Rotation

    /// How far to turn what is captured so it is level: the device's own
    /// orientation (by gravity), not the screen's.
    private func captureAngle() -> CGFloat {
        if #available(iOS 17.0, *), let coordinator = rotation as? AVCaptureDevice.RotationCoordinator {
            return coordinator.videoRotationAngleForHorizonLevelCapture
        }
        switch lastDeviceOrientation {
        case .landscapeLeft: return 0
        case .landscapeRight: return 180
        case .portraitUpsideDown: return 270
        default: return 90
        }
    }

    static func apply(angle: CGFloat, to connection: AVCaptureConnection) {
        if #available(iOS 17.0, *) {
            if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
        } else if connection.isVideoOrientationSupported {
            switch angle {
            case 0: connection.videoOrientation = .landscapeRight
            case 180: connection.videoOrientation = .landscapeLeft
            case 270: connection.videoOrientation = .portraitUpsideDown
            default: connection.videoOrientation = .portrait
            }
        }
    }

    // MARK: Lenses

    /// The best camera on a side: on the back the virtual multi-lens camera
    /// (so 0.5× and the telephoto are there), on the front the TrueDepth one.
    static func camera(_ position: AVCaptureDevice.Position) -> AVCaptureDevice? {
        let types: [AVCaptureDevice.DeviceType] = position == .back
            ? [.builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera]
            : [.builtInTrueDepthCamera, .builtInWideAngleCamera]
        let found = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: position).devices
        for type in types {
            if let device = found.first(where: { $0.deviceType == type }) { return device }
        }
        return nil
    }
}

extension ChatCameraController: AVCaptureFileOutputRecordingDelegate {
    func fileOutput(_ output: AVCaptureFileOutput, didStartRecordingTo fileURL: URL, from connections: [AVCaptureConnection]) {
        let started = Date()
        DispatchQueue.main.async { self.recordingSince = started }
        queue.async { [self] in
            if stopRequested {
                stopRequested = false
                movieOutput.stopRecording()
            }
        }
    }

    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL, from connections: [AVCaptureConnection], error: Error?) {
        // Reaching the longest recording ends it with an "error" that says it
        // finished well.
        var finished = error == nil
        if let error = error as NSError?, let flag = error.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool {
            finished = flag
        }
        queue.async { [self] in
            setTorch(.off)
            let done = movieDone
            movieDone = nil
            DispatchQueue.main.async {
                // Under half a second is a brushed shutter, not a video.
                let seconds = self.recordingSince.map { Date().timeIntervalSince($0) } ?? 0
                self.recordingSince = nil
                done?(finished && seconds >= 0.5 ? outputFileURL : nil)
            }
        }
    }
}

/// One photo on its way: the shutter's moment and the photo's bytes.
final class ChatPhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate {
    private let willCapture: () -> Void
    private let finished: (Data?) -> Void

    init(willCapture: @escaping () -> Void, finished: @escaping (Data?) -> Void) {
        self.willCapture = willCapture
        self.finished = finished
    }

    func photoOutput(_ output: AVCapturePhotoOutput, willCapturePhotoFor resolvedSettings: AVCaptureResolvedPhotoSettings) {
        willCapture()
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        finished(error == nil ? photo.fileDataRepresentation() : nil)
    }
}

extension UIImage {
    /// The picture turned upright (its orientation tag applied to the pixels)
    /// at one pixel per point, no larger than `maxDimension` — what the editor
    /// crops, draws on and sends.
    func chatUpright(maxDimension: CGFloat) -> UIImage {
        let pixels = CGSize(width: size.width * scale, height: size.height * scale)
        let ratio = min(1, maxDimension / max(pixels.width, pixels.height, 1))
        let target = CGSize(width: (pixels.width * ratio).rounded(), height: (pixels.height * ratio).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        format.preferredRange = .standard
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
    }
}
