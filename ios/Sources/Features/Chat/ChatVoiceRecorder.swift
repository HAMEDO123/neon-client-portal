import AVFoundation
import SwiftUI

// Recording a voice note. mp4/AAC, the format lib/voice.ts prefers first
// because it plays on an iPhone and in Chrome alike — an iPhone only records
// that format anyway, so there is no choice to make here the way the web's
// pickAudioType has to.

@MainActor
final class ChatVoiceRecorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published private(set) var isRecording = false
    @Published private(set) var elapsed: TimeInterval = 0
    @Published var permissionDenied = false

    private var recorder: AVAudioRecorder?
    private var startedAt: Date?
    private var timer: Timer?
    private var fileURL: URL?

    /// Asks for the microphone if needed, then starts. Does nothing if
    /// already recording or the person has refused the microphone.
    func start() {
        guard !isRecording else { return }
        let session = AVAudioSession.sharedInstance()
        switch session.recordPermission {
        case .granted:
            beginRecording()
        case .denied:
            permissionDenied = true
        case .undetermined:
            session.requestRecordPermission { [weak self] granted in
                Task { @MainActor in
                    if granted { self?.beginRecording() } else { self?.permissionDenied = true }
                }
            }
        @unknown default:
            permissionDenied = true
        }
    }

    private func beginRecording() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
            ]
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).m4a")
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.delegate = self
            recorder.record()
            self.recorder = recorder
            self.fileURL = url
            self.startedAt = Date()
            self.elapsed = 0
            self.isRecording = true
            Haptic.impact(.medium)
            timer?.invalidate()
            timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self, let startedAt = self.startedAt else { return }
                    self.elapsed = Date().timeIntervalSince(startedAt)
                }
            }
        } catch {
            isRecording = false
        }
    }

    /// Stops and hands back the file and its length — `nil` when it never
    /// really started or ran shorter than a tap (the same 700ms floor
    /// lib/voice.ts's MIN_RECORDING_MS draws).
    func stopAndTake() -> (url: URL, seconds: Int)? {
        timer?.invalidate()
        timer = nil
        isRecording = false
        guard let recorder, let startedAt, let fileURL else { return nil }
        recorder.stop()
        self.recorder = nil
        let length = Date().timeIntervalSince(startedAt)
        guard length >= 0.7 else {
            try? FileManager.default.removeItem(at: fileURL)
            return nil
        }
        return (fileURL, max(1, Int(length.rounded())))
    }

    func cancel() {
        timer?.invalidate()
        timer = nil
        recorder?.stop()
        if let fileURL { try? FileManager.default.removeItem(at: fileURL) }
        recorder = nil
        isRecording = false
    }
}

/// Plays one voice note at a time. Tapping a second bubble stops the first —
/// nothing here queues, which matches a chat bubble's own one-shot feel.
@MainActor
final class ChatVoicePlayer: NSObject, ObservableObject, AVAudioPlayerDelegate {
    static let shared = ChatVoicePlayer()

    @Published var playingURL: URL?
    @Published var progress: Double = 0

    private var player: AVAudioPlayer?
    private var timer: Timer?

    func toggle(url: URL) {
        if playingURL == url {
            stop()
            return
        }
        stop()
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self, let data else { return }
            Task { @MainActor in self.play(data: data, url: url) }
        }.resume()
    }

    private func play(data: Data, url: URL) {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)
        guard let player = try? AVAudioPlayer(data: data) else { return }
        player.delegate = self
        player.play()
        self.player = player
        self.playingURL = url
        self.progress = 0
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let player = self.player, player.duration > 0 else { return }
                self.progress = player.currentTime / player.duration
            }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        player?.stop()
        player = nil
        playingURL = nil
        progress = 0
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in stop() }
    }
}
