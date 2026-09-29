import AVFoundation
import WebRTC

// How a call sounds on this phone: the earpiece for a voice call unless the
// speaker is asked for, and the speaker by default once video is showing —
// the same shape a phone call takes.
//
// WebRTC runs its own audio session (RTCAudioSession): when the first audio
// track starts it re-applies *its* configuration, which used to be its
// default (voice chat, Bluetooth, no speaker) — so whatever was set here
// before the call connected was undone the moment sound began, and a video
// call played through the earpiece while the button said "speaker". The
// configuration is now handed to WebRTC itself, so both agree.

@MainActor
enum CallAudioSession {
    private static var activated = false
    private static var speaker = false
    private static var routeObserver: NSObjectProtocol?

    /// Configures and activates the session when a call starts, with the
    /// speaker on for a video call.
    static func configure(video: Bool) {
        apply(speaker: video, activate: !activated)
        activated = true
        watchCategory()
    }

    static func setSpeaker(_ on: Bool) {
        apply(speaker: on, activate: false)
    }

    /// Whether the current route is the phone's own speaker.
    static var isOnSpeaker: Bool {
        AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .builtInSpeaker }
    }

    /// The call is over: give the sound back to whatever was playing before.
    static func release() {
        if let routeObserver { NotificationCenter.default.removeObserver(routeObserver) }
        routeObserver = nil
        guard activated else { return }
        activated = false
        speaker = false
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        defer { session.unlockForConfiguration() }
        do {
            try session.setActive(false)
        } catch {
            // Still running audio (WebRTC stops its unit on its own thread);
            // it deactivates the session itself once it has.
        }
    }

    private static func configuration(speaker: Bool) -> RTCAudioSessionConfiguration {
        let config = RTCAudioSessionConfiguration.webRTC()
        config.category = AVAudioSession.Category.playAndRecord.rawValue
        var options: AVAudioSession.CategoryOptions = [.allowBluetoothHFP, .allowBluetoothA2DP]
        if speaker { options.insert(.defaultToSpeaker) }
        config.categoryOptions = options
        config.mode = AVAudioSession.Mode.voiceChat.rawValue
        return config
    }

    private static func apply(speaker on: Bool, activate: Bool) {
        speaker = on
        let config = configuration(speaker: on)
        // What WebRTC applies whenever it (re)starts its audio unit.
        RTCAudioSessionConfiguration.setWebRTC(config)

        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        defer { session.unlockForConfiguration() }
        do {
            if activate {
                try session.setConfiguration(config, active: true)
            } else {
                // Mid-call only the category moves: re-applying the whole
                // configuration would also re-ask for WebRTC's sample rate,
                // which on a Bluetooth headset reroutes the sound for nothing.
                try session.setCategory(.playAndRecord, mode: .voiceChat, options: config.categoryOptions)
            }
        } catch {
            // The call still works on whatever route iOS already had; WebRTC
            // tries the same configuration again when its audio starts.
        }
        // An override only holds on an active session and until the next
        // route change, so it is set after the category, every time.
        try? session.overrideOutputAudioPort(on ? .speaker : .none)
    }

    /// Something else in the app (a voice note playing in a chat while the
    /// call is minimised) can switch the shared session to playback only,
    /// which silences this phone's microphone for the rest of the call. Put
    /// the call's configuration back whenever that happens.
    private static func watchCategory() {
        guard routeObserver == nil else { return }
        routeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { note in
            let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            guard raw == AVAudioSession.RouteChangeReason.categoryChange.rawValue else { return }
            Task { @MainActor in
                guard activated else { return }
                let current = AVAudioSession.sharedInstance()
                if current.category != .playAndRecord || current.mode != .voiceChat {
                    apply(speaker: speaker, activate: false)
                }
            }
        }
    }
}
