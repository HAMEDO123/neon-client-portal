import AVFoundation

/// What makes it sound like a walkie-talkie: the police radio's data burst —
/// the "brrrt" of a Motorola radio — before and after the voice, and the voice
/// itself as it was said, with no filter on it.
///
/// The studio chose it by ear on 2026-10-25, from real recordings, after
/// hearing several made here from tones and noise and wanting none of them.
/// It is `Resources/Sounds/walkie-burst.caf`: Freesound's "MDC1200 Echo" by
/// mbelew (freesound.org/s/785695), released as CC0 — free to use, nothing owed.
///
/// The same burst sounds on the speaker's own phone as they press (before the
/// microphone opens, so it is not recorded) and as they let go.
@MainActor
final class WalkieRadio: NSObject, AVAudioPlayerDelegate {
    static let shared = WalkieRadio()

    private static let burstURL = Bundle.main.url(forResource: "walkie-burst", withExtension: "caf")

    /// How long the burst lasts, with a breath after it — the recording starts then.
    static let chirpSeconds = 0.42

    private var queue: [AVAudioPlayer] = []
    private var current: AVAudioPlayer?
    private var done: (@MainActor () -> Void)?

    /// What somebody said, between two bursts. `done` runs once it has all played.
    func play(file url: URL, done: @escaping @MainActor () -> Void) throws {
        let voice = try AVAudioPlayer(contentsOf: url)
        stop()
        queue = [Self.burst(), voice, Self.burst()].compactMap { $0 }
        self.done = done
        next()
    }

    /// The burst alone, on the speaker's own phone: as they press, and as they let go.
    func chirp() {
        guard let burst = Self.burst() else { return }
        stop()
        queue = [burst]
        next()
    }

    func squelch() { chirp() }

    func stop() {
        current?.stop()
        current = nil
        queue = []
        done = nil
    }

    private func next() {
        guard !queue.isEmpty else {
            current = nil
            let finished = done
            done = nil
            finished?()
            return
        }
        let player = queue.removeFirst()
        player.delegate = self
        current = player
        player.prepareToPlay()
        if !player.play() { next() }
    }

    private static func burst() -> AVAudioPlayer? {
        guard let url = burstURL else { return nil }
        return try? AVAudioPlayer(contentsOf: url)
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.next() }
    }
}
