import AVFoundation
import PushToTalk
import SwiftUI

/// The receiving end of the studio's walkie-talkie (src/lib/walkie.ts): Apple's
/// Push to Talk channel on this phone.
///
/// Allowed once: turning it on joins the channel — which iOS remembers across
/// launches, so it stays on — and hands the server a Push to Talk token. From
/// then on, what anybody says to this phone arrives as a Push to Talk push: iOS
/// wakes the app, opens the audio, and the app plays it, locked or not. For the
/// team it is required: the app covers its screens until it is on
/// (`WalkieRequiredView`). The server speaks only from 10 AM to 4 AM.
///
/// Talking is the app's own button (`WalkieTalkieView`) — or iOS's own talk
/// button on the lock screen and in the Dynamic Island, held without opening
/// the app: that records while it is held and sends to whoever was last chosen
/// in the app (`target`), everybody until somebody is.
@MainActor
final class WalkieCenter: NSObject, ObservableObject {
    static let shared = WalkieCenter()

    enum State: Equatable {
        /// Not known yet: the channel manager is still being made.
        case checking
        /// This phone cannot do it (the simulator, an
        /// older iOS without the framework working).
        case unavailable
        case off
        case joining
        case on
    }

    @Published private(set) var state: State = .checking
    @Published var problem: String?
    /// Playing what the manager said, right now.
    @Published private(set) var playing = false

    private var manager: PTChannelManager?
    /// iOS's own talk button is held: what is said is being recorded.
    private var transmitting = false
    private var recorder: AVAudioRecorder?
    private var recordingStarted: Date?
    private let pending = PendingWalkie()
    private var token: String?

    private static let channelKey = "walkie_channel_uuid"
    private static let targetKey = "walkie_target"

    /// Who iOS's own talk button speaks to: whoever was last chosen in the app
    /// — "all", "admin", or one person's id. Not a secret, so UserDefaults.
    static var target: String {
        get { UserDefaults.standard.string(forKey: targetKey) ?? "all" }
        set { UserDefaults.standard.set(newValue, forKey: targetKey) }
    }
    private static let tokenKey = "walkie_ptt_token"

    /// One channel per phone, kept so iOS can hand it back after a relaunch.
    private var channelUUID: UUID {
        if let stored = UserDefaults.standard.string(forKey: Self.channelKey), let uuid = UUID(uuidString: stored) { return uuid }
        let uuid = UUID()
        UserDefaults.standard.set(uuid.uuidString, forKey: Self.channelKey)
        return uuid
    }

    private var descriptor: PTChannelDescriptor {
        PTChannelDescriptor(name: L("NEON walkie-talkie"), image: UIImage(named: "AppIcon"))
    }

    /// At launch, for whoever is signed in. The manager must exist before the
    /// push that woke the app is handed over, and it restores the channel
    /// iOS kept joined.
    func start() {
        guard manager == nil else { return }
        #if targetEnvironment(simulator)
        state = .unavailable
        #else
        Task {
            do {
                let made = try await PTChannelManager.channelManager(delegate: self, restorationDelegate: self)
                manager = made
                state = made.activeChannelUUID == nil ? .off : .on
            } catch {
                state = .unavailable
            }
        }
        #endif
    }

    /// Turned on, from the card. iOS shows its own confirmation of joining.
    func turnOn() {
        guard let manager else {
            problem = L("The walkie-talkie isn't available on this phone.")
            return
        }
        problem = nil
        state = .joining
        manager.requestJoinChannel(channelUUID: channelUUID, descriptor: descriptor)
    }

    /// Signing out: this phone leaves the channel and the server forgets its
    /// token, with the bearer captured before sign-out cleared it.
    func signOut(bearer: String?) async {
        let stored = token ?? UserDefaults.standard.string(forKey: Self.tokenKey)
        token = nil
        UserDefaults.standard.removeObject(forKey: Self.tokenKey)
        if let manager, let active = manager.activeChannelUUID {
            manager.leaveChannel(channelUUID: active)
        }
        state = .off
        guard let stored, let bearer else { return }
        await PushCenter.releaseDevice(token: stored, bearer: bearer)
    }

    #if DEBUG
    /// The debug router's fixtures draw each state of the card.
    func preview(_ state: State, playing: Bool = false) {
        self.state = state
        self.playing = playing
    }
    #endif

    // MARK: - The server

    private func register(_ hex: String) async {
        token = hex
        guard APIClient.shared.isLoggedIn else { return }
        var body = PushCenter.deviceBody(token: hex)
        body["kind"] = "ptt"
        do {
            _ = try await APIClient.shared.sendJSON("POST", "devices", body)
            UserDefaults.standard.set(hex, forKey: Self.tokenKey)
        } catch {
            problem = L("The walkie-talkie is on, but the server could not be told. Turn it off and on again.")
        }
    }

    private static func tellServerOff(token: String?) async {
        UserDefaults.standard.removeObject(forKey: tokenKey)
        guard APIClient.shared.isLoggedIn else { return }
        _ = try? await APIClient.shared.perform("walkie/leave", args: token.map { [$0] } ?? [])
    }

    // MARK: - Playing

    private func play() {
        guard let message = pending.take() else {
            finish()
            return
        }
        playing = true
        Task {
            do {
                // Through the radio (WalkieRadio): static, the voice in a
                // radio's band, then the roger beep.
                let (data, _) = try await URLSession.shared.data(from: message.url)
                let file = FileManager.default.temporaryDirectory.appendingPathComponent("walkie-heard.m4a")
                try data.write(to: file, options: .atomic)
                try WalkieRadio.shared.play(file: file) { [weak self] in self?.finish() }
            } catch {
                finish()
            }
        }
    }

    // MARK: - Talking from iOS's own button

    private var recordingFile: URL { FileManager.default.temporaryDirectory.appendingPathComponent("walkie-held.m4a") }

    /// The audio is open for this phone to talk: record until the button is let go.
    private func startRecording(_ session: AVAudioSession) {
        try? FileManager.default.removeItem(at: recordingFile)
        do {
            let recorder = try AVAudioRecorder(url: recordingFile, settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 22_050,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
            ])
            guard recorder.record(forDuration: 60) else { return }
            self.recorder = recorder
            recordingStarted = Date()
        } catch {
            recorder = nil
        }
    }

    /// Let go: sends what was said, to the last one chosen. It runs with the
    /// app in the background, so it asks iOS for the time to finish.
    private func sendHeld() {
        guard let recorder else { return }
        let seconds = recorder.currentTime > 0 ? recorder.currentTime : Date().timeIntervalSince(recordingStarted ?? Date())
        recorder.stop()
        self.recorder = nil
        guard seconds >= 0.6, let data = try? Data(contentsOf: recordingFile), !data.isEmpty else { return }
        let target = Self.target
        var background = UIBackgroundTaskIdentifier.invalid
        background = UIApplication.shared.beginBackgroundTask { UIApplication.shared.endBackgroundTask(background) }
        Task {
            _ = try? await APIClient.shared.sendWalkie(to: target, audio: data, seconds: seconds)
            UIApplication.shared.endBackgroundTask(background)
        }
    }

    private func finish() {
        playing = false
        guard let manager, let active = manager.activeChannelUUID else { return }
        // Nobody is talking any more: iOS closes the audio.
        Task { try? await manager.setActiveRemoteParticipant(nil, channelUUID: active) }
    }
}

// MARK: - Apple's side

extension WalkieCenter: PTChannelManagerDelegate, PTChannelRestorationDelegate {
    nonisolated func channelManager(_ channelManager: PTChannelManager, didJoinChannel channelUUID: UUID, reason: PTChannelJoinReason) {
        Task { @MainActor in self.state = .on }
    }

    nonisolated func channelManager(_ channelManager: PTChannelManager, didLeaveChannel channelUUID: UUID, reason: PTChannelLeaveReason) {
        Task { @MainActor in
            self.state = .off
            await Self.tellServerOff(token: self.token ?? UserDefaults.standard.string(forKey: Self.tokenKey))
            self.token = nil
        }
    }

    nonisolated func channelManager(_ channelManager: PTChannelManager, failedToJoinChannel channelUUID: UUID, error: Error) {
        Task { @MainActor in
            self.state = .off
            self.problem = L("The walkie-talkie could not be turned on: %@", error.localizedDescription)
        }
    }

    nonisolated func channelManager(_ channelManager: PTChannelManager, receivedEphemeralPushToken pushToken: Data) {
        let hex = pushToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in await self.register(hex) }
    }

    /// The manager said something. Answered at once — iOS waits on it — with
    /// who is talking; the audio opens next, and playing waits for it.
    nonisolated func incomingPushResult(channelManager: PTChannelManager, channelUUID: UUID, pushPayload: [String: Any]) -> PTPushResult {
        let neon = pushPayload["neon"] as? [String: Any]
        // "The manager" is the server's own words, said in the phone's language.
        let from = L((neon?["from"] as? String) ?? (pushPayload["activeSpeaker"] as? String) ?? "The manager")
        if let raw = neon?["audioUrl"] as? String, let url = resolvedMediaURL(raw) {
            pending.put(PendingWalkie.Message(url: url))
        }
        return .activeRemoteParticipant(PTParticipant(name: from, image: nil))
    }

    /// The audio is open: to talk, if the button is held; otherwise to hear.
    nonisolated func channelManager(_ channelManager: PTChannelManager, didActivate audioSession: AVAudioSession) {
        Task { @MainActor in
            if self.transmitting {
                self.startRecording(audioSession)
            } else {
                self.play()
            }
        }
    }

    nonisolated func channelManager(_ channelManager: PTChannelManager, didDeactivate audioSession: AVAudioSession) {
        Task { @MainActor in
            WalkieRadio.shared.stop()
            self.playing = false
        }
    }

    /// iOS's own talk button is pressed (the lock screen, the Dynamic Island).
    /// Outside working hours the server refuses it, and says so in the app.
    nonisolated func channelManager(_ channelManager: PTChannelManager, channelUUID: UUID, didBeginTransmittingFrom source: PTChannelTransmitRequestSource) {
        Task { @MainActor in
            WalkieRadio.shared.stop()
            self.transmitting = true
        }
    }

    nonisolated func channelManager(_ channelManager: PTChannelManager, channelUUID: UUID, didEndTransmittingFrom source: PTChannelTransmitRequestSource) {
        Task { @MainActor in
            self.transmitting = false
            self.sendHeld()
        }
    }

    nonisolated func channelDescriptor(restoredChannelUUID channelUUID: UUID) -> PTChannelDescriptor {
        PTChannelDescriptor(name: L("NEON walkie-talkie"), image: nil)
    }
}

/// What the last push said to play, between the push (on Apple's queue) and
/// the audio opening (later, on another).
final class PendingWalkie: @unchecked Sendable {
    struct Message { let url: URL }
    private let lock = NSLock()
    private var message: Message?

    func put(_ value: Message) { lock.lock(); message = value; lock.unlock() }
    func take() -> Message? { lock.lock(); defer { message = nil; lock.unlock() }; return message }
}
