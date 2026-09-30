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
//
// Who switches the sound on. A call the iPhone's own call screen carries
// (CallKitCenter) has its session activated by CallKit, at a priority an app
// cannot ask for itself — it is what lets a call answered on the lock screen
// be heard. WebRTC is therefore in manual audio from launch: it starts its
// audio unit only when told the session is live, either by CallKit's
// activation (`systemDidActivate`) or, for a call CallKit does not carry
// (the simulator, or CallKit refusing), by `activate()` here.

@MainActor
enum CallAudioSession {
    /// CallKit has the session switched on for a call.
    private static var systemActive = false
    /// This code switched it on, for a call CallKit does not carry — so this
    /// code switches it off.
    private static var activatedHere = false
    /// Between a call's `configure` and its `release`.
    private static var inCall = false
    private static var speaker = false
    private static var routeObserver: NSObjectProtocol?

    private static var isActive: Bool { systemActive || activatedHere }

    /// Once, at launch, before any call exists.
    static func prepare() {
        let session = RTCAudioSession.sharedInstance()
        session.useManualAudio = true
        session.isAudioEnabled = false
    }

    /// A call is starting: its category and route, with the speaker on for a
    /// video call. Switches nothing on — CallKit does that, or `activate()`.
    static func configure(video: Bool) {
        inCall = true
        apply(speaker: video, activate: false)
        watchRoute()
    }

    /// For a call CallKit does not carry: switch the session and WebRTC's
    /// sound on here.
    static func activate() {
        guard !activatedHere, !systemActive else { return }
        apply(speaker: speaker, activate: true)
        activatedHere = true
        RTCAudioSession.sharedInstance().isAudioEnabled = true
        CallTones.sessionBecameActive()
    }

    /// Just before CallKit answers or starts a call: the category it will
    /// activate the session with.
    static func prepareForSystem() {
        guard !isActive else { return }
        apply(speaker: speaker, activate: false)
    }

    static func systemDidActivate(_ audioSession: AVAudioSession) {
        systemActive = true
        let session = RTCAudioSession.sharedInstance()
        session.audioSessionDidActivate(audioSession)
        session.isAudioEnabled = true
        // The speaker override only holds on an active session.
        if inCall { apply(speaker: speaker, activate: false) }
        CallTones.sessionBecameActive()
    }

    static func systemDidDeactivate(_ audioSession: AVAudioSession) {
        systemActive = false
        let session = RTCAudioSession.sharedInstance()
        session.audioSessionDidDeactivate(audioSession)
        session.isAudioEnabled = activatedHere
    }

    /// CallKit dropped every call at once (its provider was reset): whatever
    /// session it had switched on is not coming back.
    static func systemReset() {
        guard systemActive else { return }
        systemDidDeactivate(AVAudioSession.sharedInstance())
    }

    static func setSpeaker(_ on: Bool) {
        apply(speaker: on, activate: false)
    }

    /// Whether the current route is the phone's own speaker.
    static var isOnSpeaker: Bool {
        AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .builtInSpeaker }
    }

    /// The call is over: give the sound back to whatever was playing before.
    /// A CallKit call's session is CallKit's to switch off, once the call has
    /// ended there — which also keeps the sound on when one call is ended to
    /// answer the next.
    static func release() {
        if let routeObserver { NotificationCenter.default.removeObserver(routeObserver) }
        routeObserver = nil
        inCall = false
        speaker = false
        guard activatedHere else { return }
        activatedHere = false
        let session = RTCAudioSession.sharedInstance()
        session.isAudioEnabled = systemActive
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
            } else if !isActive {
                // Not live yet (CallKit has still to switch it on): the whole
                // configuration, so it is activated with the right one.
                try session.setConfiguration(config)
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
    ///
    /// Any other route change moves the call screen's speaker button to where
    /// the sound actually went: the lock screen's audio button, a headset
    /// plugged in or AirPods connecting all move it without a tap in the app.
    private static func watchRoute() {
        guard routeObserver == nil else { return }
        routeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { note in
            let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            Task { @MainActor in
                guard inCall else { return }
                if raw == AVAudioSession.RouteChangeReason.categoryChange.rawValue {
                    let current = AVAudioSession.sharedInstance()
                    if current.category != .playAndRecord || current.mode != .voiceChat {
                        apply(speaker: speaker, activate: false)
                        return
                    }
                }
                guard isActive else { return }
                let now = isOnSpeaker
                speaker = now
                CallCenter.shared.session?.routeChanged(onSpeaker: now)
            }
        }
    }
}
