import AVFoundation
import Speech
import SwiftUI

/// Listening to the manager say who does what, as text — Apple's own speech
/// recognition, Arabic by default (the Jordanian dialect where iOS has it).
/// What is heard is shown as it is heard, and is only ever text in a box the
/// manager can correct: nothing is sent from here.
///
/// Apple stops a recognition after about a minute; a briefing can run longer,
/// so a finished piece is kept and a new one started, until the manager stops.
@MainActor
final class TaskDictationListener: NSObject, ObservableObject {
    enum Language: String, CaseIterable, Identifiable {
        case arabic, english
        var id: String { rawValue }
        /// What it listens for, in order of preference.
        var localeIds: [String] { self == .arabic ? ["ar-JO", "ar-SA", "ar-AE", "ar"] : ["en-US", "en-GB"] }
        /// The chip names the language itself, as the web's toggle does.
        var label: String { self == .arabic ? "عربي" : "English" }
    }

    @Published private(set) var isListening = false
    /// Everything heard since the last `start()`.
    @Published private(set) var heard = ""
    /// The microphone's level, 0…1, for the button's ring.
    @Published private(set) var level: CGFloat = 0
    @Published var language: Language = .arabic
    /// Why it cannot listen, as a sentence for the screen.
    @Published var problem: String?

    private let engine = AVAudioEngine()
    private let feed = DictationFeed()
    private var recognizer: SFSpeechRecognizer?
    private var task: SFSpeechRecognitionTask?
    /// The pieces Apple has finished with.
    private var kept = ""
    private var wantsToListen = false
    private var emptyRestarts = 0

    /// Starts or stops.
    func toggle() {
        isListening ? stop() : start()
    }

    func start() {
        guard !isListening else { return }
        // A call owns the microphone and the audio session.
        if CallCenter.shared.session != nil {
            problem = L("You can't dictate during a call.")
            return
        }
        problem = nil
        SFSpeechRecognizer.requestAuthorization { status in
            Task { @MainActor in
                guard status == .authorized else {
                    self.problem = L("Allow Speech Recognition for NEON in Settings to dictate.")
                    return
                }
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    Task { @MainActor in
                        guard granted else {
                            self.problem = L("Allow the microphone for NEON in Settings to dictate.")
                            return
                        }
                        self.begin()
                    }
                }
            }
        }
    }

    func stop() {
        guard isListening else { return }
        wantsToListen = false
        isListening = false
        level = 0
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        // The last words arrive as a final result after this.
        feed.request?.endAudio()
        Haptic.soft()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func begin() {
        guard let recognizer = Self.recognizer(for: language), recognizer.isAvailable else {
            problem = L("Speech recognition isn't available right now. Type the tasks instead.")
            return
        }
        self.recognizer = recognizer
        ChatVoicePlayer.shared.stop()
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            kept = ""
            heard = ""
            emptyRestarts = 0
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.removeTap(onBus: 0)
            let feed = self.feed
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                feed.append(buffer)
                let level = DictationFeed.level(of: buffer)
                Task { @MainActor in self?.level = level }
            }
            engine.prepare()
            try engine.start()
        } catch {
            problem = L("The microphone could not start. Try again.")
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            return
        }
        wantsToListen = true
        isListening = true
        Haptic.impact(.medium)
        startPiece()
    }

    /// One recognition, until Apple ends it (about a minute) or the manager stops.
    private func startPiece() {
        guard let recognizer else { return }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        request.addsPunctuation = true
        feed.request = request
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let done = (result?.isFinal ?? false) || error != nil
            Task { @MainActor in self?.received(text, done: done) }
        }
    }

    private func received(_ text: String?, done: Bool) {
        if let text, !text.isEmpty { heard = Self.join(kept, text) }
        guard done else { return }
        if let text, !text.isEmpty {
            kept = Self.join(kept, text)
            emptyRestarts = 0
        } else {
            emptyRestarts += 1
        }
        heard = kept
        task = nil
        feed.request = nil
        // Past Apple's minute, carry on with a fresh piece — unless it keeps
        // ending with nothing heard, which is a recogniser that has stopped
        // working rather than a long briefing.
        if wantsToListen {
            if emptyRestarts >= 3 {
                stop()
                problem = L("Nothing was heard. Check the microphone, or type the tasks.")
            } else {
                startPiece()
            }
        }
    }

    private static func join(_ first: String, _ second: String) -> String {
        let a = first.trimmingCharacters(in: .whitespacesAndNewlines)
        let b = second.trimmingCharacters(in: .whitespacesAndNewlines)
        if a.isEmpty { return b }
        if b.isEmpty { return a }
        return a + " " + b
    }

    private static func recognizer(for language: Language) -> SFSpeechRecognizer? {
        let supported = Set(SFSpeechRecognizer.supportedLocales().map(\.identifier))
        for id in language.localeIds {
            let variants = [id, id.replacingOccurrences(of: "-", with: "_")]
            if variants.contains(where: supported.contains), let recognizer = SFSpeechRecognizer(locale: Locale(identifier: id)) {
                return recognizer
            }
        }
        return SFSpeechRecognizer(locale: Locale(identifier: language.localeIds[0]))
    }
}

/// The microphone's buffers, handed to whichever recognition is current. The
/// audio thread writes here; the main actor swaps the request.
final class DictationFeed: @unchecked Sendable {
    private let lock = NSLock()
    private var current: SFSpeechAudioBufferRecognitionRequest?

    var request: SFSpeechAudioBufferRecognitionRequest? {
        get { lock.lock(); defer { lock.unlock() }; return current }
        set { lock.lock(); current = newValue; lock.unlock() }
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        request?.append(buffer)
    }

    /// How loud a buffer is, 0…1, for the ring around the button.
    static func level(of buffer: AVAudioPCMBuffer) -> CGFloat {
        guard let channel = buffer.floatChannelData?[0] else { return 0 }
        let count = Int(buffer.frameLength)
        guard count > 0 else { return 0 }
        var sum: Float = 0
        for index in stride(from: 0, to: count, by: 4) {
            let sample = channel[index]
            sum += sample * sample
        }
        let rms = sqrt(sum / Float(max(1, count / 4)))
        let decibels = 20 * log10(max(rms, 0.000_01))
        return CGFloat(max(0, min(1, (decibels + 50) / 45)))
    }
}
