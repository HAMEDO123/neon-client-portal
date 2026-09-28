import AVFoundation
import WebRTC

// How a call sounds on this phone: the earpiece for a voice call unless the
// speaker is asked for, and the speaker by default once video is showing —
// the same shape a phone call takes, layered onto WebRTC's own audio session
// (which starts and stops the audio unit around the mic/speaker tracks).

@MainActor
enum CallAudioSession {
    /// Configures the session once, when a call starts.
    static func configure(video: Bool) {
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        defer { session.unlockForConfiguration() }
        do {
            var options: AVAudioSession.CategoryOptions = [.allowBluetoothHFP, .allowBluetoothA2DP]
            if video { options.insert(.defaultToSpeaker) }
            try session.setCategory(.playAndRecord, with: options)
            try session.setMode(.voiceChat)
            try session.overrideOutputAudioPort(video ? .speaker : .none)
        } catch {
            // The call still works with whatever route iOS already had.
        }
    }

    static func setSpeaker(_ on: Bool) {
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        defer { session.unlockForConfiguration() }
        try? session.overrideOutputAudioPort(on ? .speaker : .none)
    }

    /// Whether the current route is already the speaker (so a fresh call can
    /// show the right icon before anybody has touched the toggle).
    static var isOnSpeaker: Bool {
        AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .builtInSpeaker }
    }

    static func release() {
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        defer { session.unlockForConfiguration() }
        try? session.setActive(false)
    }
}
