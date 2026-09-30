import AVFoundation

// The sounds a call makes before anybody speaks: the ringback the caller hears
// while the other phone rings, and the ringtone of the app's own ringing
// screen (CallKit plays the same file itself — CallKitCenter's
// `ringtoneSound`). Both are Resources/Sounds, made by tools/make-call-tones.py.
//
// The ringback plays on the call's own audio session, which CallKit (or
// CallAudioSession.activate) switches on a moment after the call is placed —
// so a start that finds the session not yet live is simply retried when it
// comes up (`sessionBecameActive`).

@MainActor
enum CallTones {
    private static var ringback: AVAudioPlayer?
    private static var ringtone: AVAudioPlayer?
    private static var wantsRingback = false

    // MARK: - While my call rings somebody

    static func setRingback(_ on: Bool) {
        wantsRingback = on
        if on { startRingback() } else { stopRingback() }
    }

    /// The call's audio session came up: a ringback asked for before it could
    /// play starts now.
    static func sessionBecameActive() {
        if wantsRingback { startRingback() }
    }

    private static func startRingback() {
        if ringback?.isPlaying == true { return }
        if ringback == nil { ringback = player("neon-ringback") }
        ringback?.play()
    }

    private static func stopRingback() {
        ringback?.stop()
        ringback?.currentTime = 0
    }

    // MARK: - The app's own ringing screen

    /// Only for a call the app rings itself (no CallKit): outside a call, on a
    /// session that follows the silent switch, like a ringtone.
    static func setRingtone(_ on: Bool) {
        if on {
            if ringtone?.isPlaying == true { return }
            let session = AVAudioSession.sharedInstance()
            if session.category != .playAndRecord {
                try? session.setCategory(.soloAmbient)
                try? session.setActive(true)
            }
            if ringtone == nil { ringtone = player("neon-ringtone") }
            ringtone?.play()
        } else if ringtone?.isPlaying == true {
            ringtone?.stop()
            ringtone?.currentTime = 0
            // Let whatever the ring interrupted — music, a podcast — carry on,
            // unless a call has the session now.
            let session = AVAudioSession.sharedInstance()
            if session.category == .soloAmbient {
                try? session.setActive(false, options: .notifyOthersOnDeactivation)
            }
        }
    }

    private static func player(_ name: String) -> AVAudioPlayer? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "caf"),
              let player = try? AVAudioPlayer(contentsOf: url) else { return nil }
        player.numberOfLoops = -1
        player.prepareToPlay()
        return player
    }
}
