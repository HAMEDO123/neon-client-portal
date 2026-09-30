import AVFoundation
import CallKit
import Combine
import UIKit

// The iPhone's own call screen for NEON calls (CallKit): the full-screen
// incoming call with the phone's ringtone — on a locked phone, or with the
// app closed, as much as with it open — and, once a call is going, the green
// pill, the lock screen's controls and the call's claim on the sound.
//
// A call rings here when a VoIP push arrives (App/VoipPush.swift). The server
// sends no push when the ringing stops, so what stops it is the calls stream
// CallCenter holds open (CallKit keeps the app running while it rings), read
// by `reconcile`, and a local timeout for a ring that nothing resolves.
//
// Every live call on a phone goes through CallKit too — answered on its
// screen, started from the pre-join, joined from a pill, or answered on the
// app's own ringing screen (still what rings when no push came): one audio
// path for every call, and the lock screen always shows the call. The
// simulator never hands a CallKit call its sound, so there calls stay the
// app's own; CallKit's incoming screen can still be shown there, for the
// debug router's `callkit-incoming`.

@MainActor
final class CallKitCenter: NSObject {
    static let shared = CallKitCenter()

    /// Whether live calls are carried by CallKit on this device.
    let routesCalls: Bool = {
        #if targetEnvironment(simulator)
        return false
        #else
        return true
        #endif
    }()

    /// This phone is registered for VoIP pushes (VoipPush sets it), so a ring
    /// is expected to arrive as one.
    var ringsByPush = false

    /// A ring CallKit is showing that nothing has answered or ended: the
    /// server's ring stops at 45 s, but somebody rung into a group call
    /// that is already running stays asked for as long as it runs.
    private static let ringTimeoutNs: UInt64 = 60_000_000_000

    /// One call CallKit knows about.
    private final class Entry {
        let uuid = UUID()
        /// Nil for a push that named no call, and for the debug fixture.
        let callId: String?
        let title: String
        let video: Bool
        let incoming: Bool
        let reportedAt = Date()
        /// When CallKit took the report — it can take a second to answer.
        var acceptedAt: Date?
        var debug = false
        /// Answered (an incoming call), or started (an outgoing one).
        var answered = false
        /// Answered in the app while CallKit rang it: CallKit is told, and
        /// its answer joins nothing a second time.
        var answeredInApp = false
        var started = false
        var connected = false
        /// The calls stream has listed it since it began ringing.
        var seenInList = false
        /// Mute as CallKit's screen last showed it.
        var systemMuted = false
        weak var session: CallSession?
        var watchers: Set<AnyCancellable> = []
        var timeout: Task<Void, Never>?
        #if DEBUG
        /// What the debug fixture's page says happened to its call.
        var fixtureNote: ((String) -> Void)?
        #endif

        var ringing: Bool { incoming && !answered }

        init(callId: String?, title: String, video: Bool, incoming: Bool) {
            self.callId = callId
            self.title = title
            self.video = video
            self.incoming = incoming
        }
    }

    enum CallEnd {
        /// Hung up in the app.
        case hungUpHere
        /// Ended by the server or the other side, or by a failure.
        case endedThere(failed: Bool)
        /// Left to answer or start another call.
        case replaced
    }

    private let provider: CXProvider
    private let controller = CXCallController()
    private var entries: [UUID: Entry] = [:]
    /// Answered on CallKit's screen, then hung up there before the join had
    /// finished: the call is left the moment it opens.
    private var abandoned: Set<String> = []

    private override init() {
        // The name CallKit shows ("NEON Audio", "NEON Video") is the app's
        // display name, CFBundleDisplayName.
        let config = CXProviderConfiguration()
        config.supportsVideo = true
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        // Kept out of the Phone app's Recents: a NEON call there could not be
        // called back from it — the app handles no call intents, and a call
        // is placed in a conversation, not to a number.
        config.includesCallsInRecents = false
        config.iconTemplateImageData = Self.iconTemplate()
        // The studio's own ring (Resources/Sounds), the same one the app's
        // ringing screen and a caller's ringback play.
        config.ringtoneSound = "neon-ringtone.caf"
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    /// At launch, before a push that launched the app is delivered.
    func setUp() {
        CallAudioSession.prepare()
    }

    // MARK: - Ringing, from a VoIP push

    /// A VoIP push. CallKit hears about every one before `completion` runs —
    /// iOS ends an app that does not, and after a few times stops waking it
    /// for calls at all — even a push that names no call, or a call that is
    /// already over: that one is reported, then ended at once.
    func reportIncoming(callId: String?, title: String?, video: Bool, completion: @escaping () -> Void) {
        let name = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let entry = Entry(callId: callId, title: name.isEmpty ? "NEON" : name, video: video, incoming: true)
        let refusal = refusal(for: callId)
        entries[entry.uuid] = entry
        if refusal == nil, let callId {
            CallCenter.shared.systemRinging(callId, true)
            entry.timeout = ringTimeout(entry)
        }

        let uuid = entry.uuid
        provider.reportNewIncomingCall(with: uuid, update: update(for: entry)) { [weak self] error in
            Task { @MainActor in
                self?.reported(uuid, error: error, refusal: refusal)
                completion()
            }
        }

        guard refusal == nil else { return }
        CallCenter.shared.wake()
        reconcile()
    }

    private func reported(_ uuid: UUID, error: Error?, refusal: CXCallEndedReason?) {
        guard let entry = entries[uuid] else { return }
        noteFixture(entry, error.map { L("CallKit would not ring it: %@", $0.localizedDescription) } ?? L("Ringing on the phone's own call screen."))
        if error != nil {
            // Not rung: Do Not Disturb, or a call CallKit will not put beside
            // the one going on. The app's own ringing takes it from here.
            entries[uuid] = nil
            finish(entry)
            return
        }
        entry.acceptedAt = Date()
        if let refusal { end(entry, refusal) }
    }

    /// Why a push cannot ring, if it cannot.
    private func refusal(for callId: String?) -> CXCallEndedReason? {
        guard let callId, !callId.isEmpty, APIClient.shared.isLoggedIn else { return .failed }
        let center = CallCenter.shared
        if entry(for: callId) != nil || center.session?.callId == callId || center.isAnswering(callId) {
            return .answeredElsewhere
        }
        if center.wasDismissed(callId) { return .declinedElsewhere }
        if let me = center.me, let call = center.calls.first(where: { $0.id == callId }),
           let mine = call.participants.first(where: { $0.memberKey == me }), mine.state != "INVITED" {
            return reason(forState: mine.state)
        }
        return nil
    }

    private func reason(forState state: String) -> CXCallEndedReason {
        switch state {
        case "JOINED": return .answeredElsewhere
        case "DECLINED": return .declinedElsewhere
        default: return .remoteEnded
        }
    }

    private func ringTimeout(_ entry: Entry) -> Task<Void, Never> {
        Task { [weak self, weak entry] in
            try? await Task.sleep(nanoseconds: Self.ringTimeoutNs)
            guard !Task.isCancelled, let self, let entry, entry.ringing else { return }
            // Not rung again in the app either, once the phone has given up.
            if let callId = entry.callId { CallCenter.shared.dismissRing(callId) }
            self.end(entry, .unanswered)
        }
    }

    /// Every ring CallKit is showing, against the calls stream's latest list.
    /// The server sends no push when a ring stops, so this is what stops it:
    /// the call over, answered or declined on another device, or this person
    /// taken off it.
    func reconcile() {
        let center = CallCenter.shared
        // Only a list from a connection opened after the ring began can say a
        // call is missing: an older one may predate the call.
        guard let listFrom = center.listConnectionStartedAt else { return }
        for entry in Array(entries.values) where entry.ringing && !entry.debug {
            guard let callId = entry.callId else { continue }
            if let call = center.calls.first(where: { $0.id == callId }) {
                entry.seenInList = true
                guard let me = center.me else { continue }
                if call.status == "ENDED" {
                    end(entry, .remoteEnded)
                } else if let mine = call.participants.first(where: { $0.memberKey == me }) {
                    if mine.state != "INVITED" { end(entry, reason(forState: mine.state)) }
                } else {
                    end(entry, .remoteEnded)
                }
            } else if entry.seenInList || listFrom > entry.reportedAt {
                // The list leaves out ended calls: the caller hung up, or
                // nobody answered in time.
                end(entry, .remoteEnded)
            }
        }
    }

    // MARK: - Calls the app runs

    /// A call's session has started (CallCenter.begin): CallKit carries it and
    /// switches its sound on — or, where it cannot, the sound is switched on
    /// here.
    func began(_ session: CallSession, title: String, video: Bool) {
        let callId = session.callId
        if abandoned.remove(callId) != nil {
            Task { await session.leave() }
            return
        }
        guard routesCalls else {
            CallAudioSession.activate()
            return
        }

        if let entry = entry(for: callId) {
            if entry.ringing {
                // Joined in the app (a Join pill) while CallKit was ringing
                // it: CallKit answers it too, rather than ringing on.
                entry.answered = true
                entry.answeredInApp = true
                entry.timeout?.cancel()
                request(CXAnswerCallAction(call: entry.uuid)) { [weak self] failed in
                    if failed { self?.dropped(entry, session) }
                }
            }
            attach(entry, session)
            return
        }

        let entry = Entry(callId: callId, title: title, video: video, incoming: false)
        entry.answered = true
        entries[entry.uuid] = entry
        attach(entry, session)
        let start = CXStartCallAction(call: entry.uuid, handle: CXHandle(type: .generic, value: title))
        start.isVideo = video
        request(start) { [weak self] failed in
            if failed { self?.dropped(entry, session) }
        }
    }

    /// CallKit would not take the call: it goes on as the app's own.
    private func dropped(_ entry: Entry, _ session: CallSession) {
        if entries.removeValue(forKey: entry.uuid) != nil {
            finish(entry)
            // Harmless for a call CallKit never took; stops one it was ringing.
            provider.reportCall(with: entry.uuid, endedAt: nil, reason: .answeredElsewhere)
        }
        if session.phase != .ended { CallAudioSession.activate() }
    }

    /// Mute and connection, kept the same on CallKit's screen as in the app.
    private func attach(_ entry: Entry, _ session: CallSession) {
        entry.session = session
        entry.watchers.removeAll()
        // Muted on the lock screen while the call was still opening.
        if entry.systemMuted, !session.audioMuted { session.setMuted(true) }
        session.$audioMuted
            .removeDuplicates()
            .sink { [weak self, weak entry] muted in
                guard let self, let entry else { return }
                self.syncMute(entry, muted)
            }
            .store(in: &entry.watchers)
        session.$phase
            .sink { [weak self, weak entry] phase in
                guard let self, let entry, phase == .live else { return }
                self.markConnected(entry)
            }
            .store(in: &entry.watchers)
    }

    /// Tells CallKit's screen the app's mute — once CallKit knows the call:
    /// an outgoing one is synced again when its start is performed.
    private func syncMute(_ entry: Entry, _ muted: Bool) {
        guard entry.incoming || entry.started, entry.systemMuted != muted else { return }
        entry.systemMuted = muted
        request(CXSetMutedCallAction(call: entry.uuid, muted: muted))
    }

    private func markConnected(_ entry: Entry) {
        guard !entry.incoming, entry.started, !entry.connected else { return }
        entry.connected = true
        provider.reportOutgoingCall(with: entry.uuid, connectedAt: nil)
    }

    /// A call's session has ended.
    func callEnded(_ callId: String, _ how: CallEnd) {
        guard let entry = entry(for: callId) else { return }
        entries[entry.uuid] = nil
        finish(entry)
        switch how {
        case .hungUpHere:
            // As CallKit's own End button would: asked, not reported.
            request(CXEndCallAction(call: entry.uuid)) { [weak self] failed in
                if failed { self?.provider.reportCall(with: entry.uuid, endedAt: nil, reason: .remoteEnded) }
            }
        case .endedThere(let failed):
            let reason: CXCallEndedReason = failed ? .failed : (!entry.incoming && !entry.connected ? .unanswered : .remoteEnded)
            provider.reportCall(with: entry.uuid, endedAt: nil, reason: reason)
        case .replaced:
            // Reported rather than asked for, so it is over before the next
            // call is started: CallKit carries one call at a time.
            provider.reportCall(with: entry.uuid, endedAt: nil, reason: .remoteEnded)
        }
    }

    /// Answering on CallKit's screen could not join the call.
    func callFailed(_ callId: String) {
        abandoned.remove(callId)
        guard let entry = entry(for: callId) else { return }
        end(entry, .failed)
    }

    /// Signed out: nothing rings for the last person.
    func endAll() {
        for entry in Array(entries.values) { end(entry, .failed) }
        abandoned.removeAll()
    }

    // MARK: - Small pieces

    private func entry(for callId: String) -> Entry? {
        entries.values.first { $0.callId == callId }
    }

    private func end(_ entry: Entry, _ reason: CXCallEndedReason) {
        guard entries.removeValue(forKey: entry.uuid) != nil else { return }
        finish(entry)
        provider.reportCall(with: entry.uuid, endedAt: nil, reason: reason)
    }

    private func finish(_ entry: Entry) {
        entry.timeout?.cancel()
        entry.watchers.removeAll()
        entry.session = nil
        if let callId = entry.callId { CallCenter.shared.systemRinging(callId, false) }
    }

    private func update(for entry: Entry) -> CXCallUpdate {
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: entry.title)
        update.localizedCallerName = entry.title
        update.hasVideo = entry.video
        // One call at a time, with nothing to hold, merge or dial: CallKit
        // offers "End & Accept" for a second call instead of "Hold & Accept".
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsDTMF = false
        return update
    }

    private func request(_ action: CXAction, then: @escaping (_ failed: Bool) -> Void = { _ in }) {
        controller.request(CXTransaction(action: action)) { error in
            Task { @MainActor in then(error != nil) }
        }
    }

    /// The studio's "N", as the monochrome mark CallKit puts on its screen.
    private static func iconTemplate() -> Data? {
        let size = CGSize(width: 40, height: 40)
        let image = UIGraphicsImageRenderer(size: size).image { _ in
            let text = NSAttributedString(string: "N", attributes: [
                .font: UIFont.systemFont(ofSize: 34, weight: .black),
                .foregroundColor: UIColor.black,
            ])
            let bounds = text.size()
            text.draw(at: CGPoint(x: (size.width - bounds.width) / 2, y: (size.height - bounds.height) / 2))
        }
        return image.pngData()
    }

    // MARK: - CallKit's actions

    private func performAnswer(_ action: CXAnswerCallAction) {
        guard let entry = entries[action.callUUID] else {
            action.fail()
            return
        }
        entry.timeout?.cancel()
        let joiningAlready = entry.answeredInApp
        entry.answered = true
        CallAudioSession.prepareForSystem()
        // Fulfilled at once: CallKit shows the call as answered and switches
        // the sound on while the join is still on its way.
        action.fulfill()
        if entry.debug {
            noteFixture(entry, L("Answered. It ends by itself in a moment."))
            endFixtureSoon(entry)
            return
        }
        guard let callId = entry.callId, !joiningAlready else { return }
        // Locked or in the background the camera cannot run, so a video call
        // is answered with sound; the call screen's camera button turns it on
        // once the phone is open.
        let video = entry.video && UIApplication.shared.applicationState == .active
        Task {
            await CallCenter.shared.answer(callId: callId, kind: entry.video ? "VIDEO" : "AUDIO", title: entry.title, video: video)
        }
    }

    private func performStart(_ action: CXStartCallAction) {
        guard let entry = entries[action.callUUID] else {
            action.fail()
            return
        }
        CallAudioSession.prepareForSystem()
        action.fulfill()
        entry.started = true
        provider.reportOutgoingCall(with: entry.uuid, startedConnectingAt: nil)
        provider.reportCall(with: entry.uuid, updated: update(for: entry))
        if let session = entry.session {
            syncMute(entry, session.audioMuted)
            if session.phase == .live { markConnected(entry) }
        }
    }

    private func performEnd(_ action: CXEndCallAction) {
        guard let entry = entries.removeValue(forKey: action.callUUID) else {
            action.fulfill()
            return
        }
        let session = entry.session
        finish(entry)
        if entry.ringing {
            // Ended by the phone itself as soon as it was reported: iOS shows
            // an incoming call by opening its own call screen, which the
            // simulator does not have.
            noteFixture(entry, entry.acceptedAt.map { Date().timeIntervalSince($0) < 1 } ?? true
                ? L("Ended at once by the phone: it has no call screen to show it on. The simulator has none; open this on an iPhone.")
                : L("Declined."))
        }
        if !entry.debug, let callId = entry.callId {
            let center = CallCenter.shared
            if let live = session ?? center.session, live.callId == callId {
                // The phone is probably locked: the server hears it left
                // before iOS suspends the app.
                withCallBackgroundTime { await live.leave() }
            } else if entry.ringing {
                center.decline(callId: callId)
            } else if entry.incoming, !entry.answeredInApp {
                // Answered here a moment ago; the join is still on its way.
                abandoned.insert(callId)
            }
        }
        action.fulfill()
    }

    private func performMute(_ action: CXSetMutedCallAction) {
        guard let entry = entries[action.callUUID] else {
            action.fail()
            return
        }
        entry.systemMuted = action.isMuted
        if let session = entry.session, session.audioMuted != action.isMuted {
            session.setMuted(action.isMuted)
        }
        action.fulfill()
    }

    private func didReset() {
        let live = entries.values.compactMap(\.session)
        for entry in entries.values { finish(entry) }
        entries.removeAll()
        abandoned.removeAll()
        CallAudioSession.systemReset()
        for session in live { Task { await session.leave() } }
    }

    // MARK: - The debug router's fixture

    private func noteFixture(_ entry: Entry, _ text: @autoclosure () -> String) {
        #if DEBUG
        entry.fixtureNote?(text())
        #endif
    }

    #if DEBUG
    /// CallKit's incoming screen for a made-up call (`callkit-incoming`):
    /// no stream, no server. Answering shows the answered screen for a
    /// moment, then ends it. `note` hears what became of it.
    func ringFixture(title: String, video: Bool, note: @escaping (String) -> Void) {
        let entry = Entry(callId: nil, title: title, video: video, incoming: true)
        entry.debug = true
        entry.fixtureNote = note
        entries[entry.uuid] = entry
        entry.timeout = ringTimeout(entry)
        let uuid = entry.uuid
        provider.reportNewIncomingCall(with: uuid, update: update(for: entry)) { [weak self] error in
            Task { @MainActor in
                guard let error else { return }
                print("CallKit fixture was not rung:", error)
                self?.reported(uuid, error: error, refusal: nil)
            }
        }
    }
    #endif

    private func endFixtureSoon(_ entry: Entry) {
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            self?.end(entry, .remoteEnded)
        }
    }
}

extension CallKitCenter: CXProviderDelegate {
    // The delegate queue is the main queue (setDelegate(_:queue: nil)).

    nonisolated func providerDidReset(_ provider: CXProvider) {
        MainActor.assumeIsolated { didReset() }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        MainActor.assumeIsolated { performAnswer(action) }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        MainActor.assumeIsolated { performStart(action) }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        MainActor.assumeIsolated { performEnd(action) }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        MainActor.assumeIsolated { performMute(action) }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
        // Holding is not offered (supportsHolding is false).
        action.fail()
    }

    nonisolated func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        MainActor.assumeIsolated { CallAudioSession.systemDidActivate(audioSession) }
    }

    nonisolated func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        MainActor.assumeIsolated { CallAudioSession.systemDidDeactivate(audioSession) }
    }
}

/// Work that must reach the server although the phone may be locked — a
/// decline or a hang-up from CallKit's screen — before iOS suspends the app.
@MainActor
func withCallBackgroundTime(_ work: @escaping @MainActor () async -> Void) {
    let box = CallBackgroundTask()
    box.id = UIApplication.shared.beginBackgroundTask(withName: "NEON call") {
        box.end()
    }
    Task { @MainActor in
        await work()
        box.end()
    }
}

private final class CallBackgroundTask {
    var id: UIBackgroundTaskIdentifier = .invalid

    func end() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
        id = .invalid
    }
}
