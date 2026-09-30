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
    /// The microphone's level over the last few seconds, 0…1, newest last —
    /// what the recording row draws as it listens.
    @Published private(set) var levels: [CGFloat] = []

    /// How many recent levels are kept for the live bars.
    static let levelCount = 36

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
        // A call owns the microphone and the audio session; changing the
        // category under it silences the call and its echo cancellation.
        if CallCenter.shared.session != nil {
            Toast.error(L("You can't record a voice message during a call."))
            return
        }
        ChatVoicePlayer.shared.stop()
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
            recorder.isMeteringEnabled = true
            recorder.record()
            self.recorder = recorder
            self.fileURL = url
            self.startedAt = Date()
            self.elapsed = 0
            self.levels = []
            self.isRecording = true
            Haptic.impact(.medium)
            timer?.invalidate()
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.tick() }
            }
        } catch {
            isRecording = false
        }
    }

    private func tick() {
        guard let startedAt else { return }
        elapsed = Date().timeIntervalSince(startedAt)
        guard let recorder else { return }
        recorder.updateMeters()
        // Decibels (−160…0) to a bar: the bottom 50 dB are silence to the ear.
        let power = recorder.averagePower(forChannel: 0)
        let level = CGFloat(max(0, min(1, (power + 50) / 50)))
        var next = levels
        next.append(level)
        if next.count > Self.levelCount { next.removeFirst(next.count - Self.levelCount) }
        levels = next
    }

    /// Stops and hands back the file and its length — `nil` when it never
    /// really started or ran shorter than a tap (the same 700ms floor
    /// lib/voice.ts's MIN_RECORDING_MS draws).
    func stopAndTake() -> (url: URL, seconds: Int)? {
        timer?.invalidate()
        timer = nil
        isRecording = false
        levels = []
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
        levels = []
        isRecording = false
    }
}

/// Plays one voice note at a time. Tapping a second bubble stops the first —
/// nothing here queues, which matches a chat bubble's own one-shot feel.
@MainActor
final class ChatVoicePlayer: NSObject, ObservableObject, AVAudioPlayerDelegate {
    static let shared = ChatVoicePlayer()

    @Published var playingURL: URL?
    /// Fetching the note before it can play.
    @Published var loadingURL: URL?
    @Published var progress: Double = 0

    private var player: AVAudioPlayer?
    private var timer: Timer?

    func toggle(url: URL) {
        if playingURL == url || loadingURL == url {
            stop()
            return
        }
        stop()
        loadingURL = url
        Task {
            let data = await ChatVoiceNotes.shared.data(for: url)
            // Tapped something else, or stopped, while it was on its way.
            guard loadingURL == url else { return }
            loadingURL = nil
            guard let data else {
                Toast.error(L("That voice message could not be played."))
                return
            }
            play(data: data, url: url)
        }
    }

    private func play(data: Data, url: URL) {
        // During a call the session is already playing and recording; leave
        // it as the call set it, or the call loses its microphone.
        if CallCenter.shared.session == nil {
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try? AVAudioSession.sharedInstance().setActive(true)
        }
        guard let player = try? AVAudioPlayer(data: data) else {
            Toast.error(L("That voice message could not be played."))
            return
        }
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
        loadingURL = nil
        progress = 0
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in stop() }
    }
}

// MARK: - The note's own shape

/// Voice notes fetched once, and the shape of each one's sound — read from
/// the recording itself, bucket by bucket, so the bars under a note are that
/// note and not a pattern. In memory only, like the photo cache.
@MainActor
final class ChatVoiceNotes {
    static let shared = ChatVoiceNotes()

    /// Bars under one note.
    nonisolated static let bars = 30

    private let files = NSCache<NSURL, NSData>()
    private var shapes: [String: [CGFloat]] = [:]
    /// Each note's length in seconds, read from the same file as its shape —
    /// for a note the server sent without `durationSeconds`.
    private var durations: [String: Double] = [:]
    private var inFlight: [URL: Task<Data?, Never>] = [:]

    private init() {
        files.countLimit = 40
    }

    func cachedShape(_ key: String) -> [CGFloat]? { shapes[key] }

    /// How long a note is, once its shape has been read.
    func cachedDuration(_ key: String) -> Double? { durations[key] }

    /// The recording's bytes, fetched at most once at a time.
    func data(for url: URL) async -> Data? {
        if let cached = files.object(forKey: url as NSURL) { return cached as Data }
        let task: Task<Data?, Never>
        if let running = inFlight[url] {
            task = running
        } else {
            task = Task.detached(priority: .utility) {
                guard let (data, response) = try? await URLSession.shared.data(from: url),
                      (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true
                else { return nil }
                return data
            }
            inFlight[url] = task
        }
        let data = await task.value
        inFlight[url] = nil
        if let data { files.setObject(data as NSData, forKey: url as NSURL) }
        return data
    }

    /// The note's shape: `bars` levels, 0…1, loudest at 1. nil when the
    /// recording could not be fetched or read.
    func shape(for url: URL) async -> [CGFloat]? {
        let key = url.absoluteString
        if let cached = shapes[key] { return cached }
        guard let data = await data(for: url) else { return nil }
        return await shape(of: data, key: key)
    }

    /// The same, for a recording this phone already holds (one still sending).
    func shape(of data: Data, key: String) async -> [CGFloat]? {
        if let cached = shapes[key] { return cached }
        let read = await Task.detached(priority: .utility) { ChatVoiceNotes.analyse(data) }.value
        if let read {
            if shapes.count > 300 {
                shapes.removeAll()
                durations.removeAll()
            }
            shapes[key] = read.levels
            if read.seconds > 0 { durations[key] = read.seconds }
        }
        return read?.levels
    }

    nonisolated private static func analyse(_ data: Data) -> (levels: [CGFloat], seconds: Double)? {
        // AVAudioFile reads from a file, so the bytes go to one for a moment.
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("wave-\(UUID().uuidString).m4a")
        defer { try? FileManager.default.removeItem(at: url) }
        guard (try? data.write(to: url)) != nil,
              let file = try? AVAudioFile(forReading: url),
              file.length > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)),
              (try? file.read(into: buffer)) != nil,
              let samples = buffer.floatChannelData?[0]
        else { return nil }
        let rate = file.processingFormat.sampleRate
        let seconds = rate > 0 ? Double(file.length) / rate : 0
        let count = Int(buffer.frameLength)
        guard count > bars else { return nil }
        let size = count / bars
        var levels: [CGFloat] = []
        levels.reserveCapacity(bars)
        for bar in 0..<bars {
            var sum: Float = 0
            let start = bar * size
            // Every fourth sample is plenty for a bar's loudness.
            var index = start
            var taken = 0
            while index < start + size {
                sum += samples[index] * samples[index]
                taken += 1
                index += 4
            }
            levels.append(CGFloat(sqrt(sum / Float(max(1, taken)))))
        }
        let loudest = levels.max() ?? 0
        guard loudest > 0 else { return (Array(repeating: 0, count: bars), seconds) }
        // Square-rooted so quiet speech still shows as speech.
        return (levels.map { sqrt($0 / loudest) }, seconds)
    }
}

/// Bars for a voice note: its real shape once read, flat and quiet until
/// then (never a made-up pattern), filled up to how far it has played.
struct ChatWaveform: View {
    let levels: [CGFloat]?
    var progress: Double = 0
    var tint: Color
    var track: Color
    var height: CGFloat = 26

    var body: some View {
        let bars = levels ?? Array(repeating: 0, count: ChatVoiceNotes.bars)
        GeometryReader { geo in
            let count = max(1, bars.count)
            let gap: CGFloat = 2
            let width = max(1.5, (geo.size.width - gap * CGFloat(count - 1)) / CGFloat(count))
            HStack(alignment: .center, spacing: gap) {
                ForEach(Array(bars.enumerated()), id: \.offset) { index, level in
                    let played = Double(index) / Double(count) < progress
                    Capsule()
                        .fill(played ? tint : track)
                        .frame(width: width, height: max(3, height * (0.14 + 0.86 * level)))
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .leading)
            .animation(NeonMotion.resolved(NeonMotion.quick), value: progress)
            .animation(NeonMotion.resolved(NeonMotion.smooth), value: levels)
        }
        .frame(height: height)
        // Laid out in the reading direction, like the system's own progress
        // bars: in Arabic the note plays from the play button leftwards.
        .accessibilityHidden(true)
    }
}
