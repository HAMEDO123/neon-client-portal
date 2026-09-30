import Foundation
import WebRTC

// One call, on this device: the microphone and camera, a connection to each
// other person in the call, and everything the call screen shows. A direct
// port of components/calls/call-session.ts's CallSession — see that file's
// header comment for the shape of the protocol; every choice here (who
// offers first, perfect negotiation, a transceiver per role, the data
// channel's message shape, ICE restart, the 5s heartbeat) is made to match
// it exactly, so a phone and a browser can be in the same call.
//
// The sound and pictures go straight between devices (WebRTC, one connection
// per pair). The server only passes the messages two devices need to find
// each other, through APIClient's callSendSignals and the calls stream.

enum CallRole { case audio, camera, screen, receive }
enum CallPeerConnState { case connecting, connected, reconnecting }
enum CallSessionPhase { case joining, live, reconnecting, ended }

struct CallRemoteState: Equatable {
    var audioMuted = false
    var videoOff = true
    var sharing = false
    var cameraMid: String?
    var screenMid: String?
}

struct CallPersonState: Identifiable {
    let key: String
    let name: String
    let color: String?
    let audioTrack: RTCAudioTrack?
    let cameraTrack: RTCVideoTrack?
    let screenTrack: RTCVideoTrack?
    let audioMuted: Bool
    let videoOff: Bool
    let sharing: Bool
    let speaking: Bool
    let quality: CallQuality
    let connection: CallPeerConnState
    /// When this connection started trying, while it has never connected —
    /// so the screen can say plainly that it is taking long.
    let connectingSince: Date?
    var id: String { key }
}

/// One connection to one other person in the call.
private final class PeerConn {
    let key: String
    var sessionMillis: Double
    let pc: RTCPeerConnection
    let handler: PeerHandler
    let polite: Bool
    var makingOffer = false
    var ignoreOffer = false
    let channel: RTCDataChannel
    var pendingCandidates: [RTCIceCandidateJSON] = []
    var roles: [(transceiver: RTCRtpTransceiver, role: CallRole)] = []
    var remote = CallRemoteState()
    var quality: CallQuality = .unknown
    var lastPackets: (lost: Int, received: Int)?
    var connectionState: CallPeerConnState = .connecting
    var everConnected = false
    let createdAt = Date()
    var restartWork: Task<Void, Never>?
    var queue: Task<Void, Never> = Task {}

    init(key: String, sessionMillis: Double, pc: RTCPeerConnection, handler: PeerHandler, polite: Bool, channel: RTCDataChannel) {
        self.key = key
        self.sessionMillis = sessionMillis
        self.pc = pc
        self.handler = handler
        self.polite = polite
        self.channel = channel
    }

    func role(_ role: CallRole) -> RTCRtpTransceiver? { roles.first { $0.role == role }?.transceiver }
    func hasRole(_ role: CallRole) -> Bool { roles.contains { $0.role == role } }
    func setRole(_ transceiver: RTCRtpTransceiver, _ role: CallRole) {
        roles.removeAll { $0.transceiver == transceiver }
        roles.append((transceiver, role))
    }
}

/// Forwards one peer connection's delegate callbacks (fired on WebRTC's own
/// threads) onto the session, hopping to the main actor first.
private final class PeerHandler: NSObject, RTCPeerConnectionDelegate, RTCDataChannelDelegate {
    private weak var session: CallSession?
    private let key: String

    init(session: CallSession, key: String) {
        self.session = session
        self.key = key
    }

    func detach() { session = nil }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {
        let key = key
        Task { @MainActor [weak self] in self?.session?.signalingStateChanged(key: key, state: stateChanged) }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}

    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {
        let key = key
        Task { @MainActor [weak self] in self?.session?.negotiationNeeded(key: key) }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        let key = key
        Task { @MainActor [weak self] in self?.session?.addLocalCandidate(key: key, candidate: candidate) }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        let key = key
        Task { @MainActor [weak self] in self?.session?.connectionChanged(key: key, state: newState) }
    }

    func peerConnection(
        _ peerConnection: RTCPeerConnection, didAdd rtpReceiver: RTCRtpReceiver, streams mediaStreams: [RTCMediaStream]
    ) {
        let key = key
        Task { @MainActor [weak self] in self?.session?.tracksChanged(key: key) }
    }

    func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        let key = key
        let open = dataChannel.readyState == .open
        Task { @MainActor [weak self] in if open { self?.session?.channelOpened(key: key) } }
    }

    func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        let key = key
        Task { @MainActor [weak self] in self?.session?.receivedState(key: key, data: buffer.data) }
    }
}

@MainActor
final class CallSession: ObservableObject {
    let callId: String
    let me: String
    private let iceServers: [RTCIceServer]
    private let onEnded: (String?) -> Void
    private let media: LocalMedia

    @Published private(set) var phase: CallSessionPhase = .joining
    @Published var problem: String?
    @Published private(set) var micTrack: RTCAudioTrack?
    @Published private(set) var cameraTrack: RTCVideoTrack?
    @Published private(set) var audioMuted: Bool
    @Published private(set) var people: [CallPersonState] = []
    @Published var onSpeaker = false
    /// This device's own picture is shown mirrored while it is the front camera.
    @Published private(set) var mirrorSelf = true
    /// Hung up here, rather than ended by the server or the other side.
    private(set) var endedByMe = false

    var videoOff: Bool { cameraTrack == nil }

    private var peers: [String: PeerConn] = [:]
    private var peopleInfo: [String: (name: String, color: String?, joined: Bool)] = [:]
    private var mySessionMillis: Double = 0
    private var seenOnServer = false
    private var speakingKeys: Set<String> = []

    private var heartbeatTask: Task<Void, Never>?
    private var statsTask: Task<Void, Never>?
    private var outbox: [(to: String, type: String, payload: CallSignalPayload)] = []
    private var pendingCandidatesOut: [String: [RTCIceCandidateJSON]] = [:]
    private var flushTask: Task<Void, Never>?
    private var flushing = false

    /// `media` is the microphone and camera the pre-join screen (or the
    /// answer button) opened; the session owns them from here, so turning the
    /// camera off, flipping it and hanging up all reach the real capturer.
    init(
        callId: String, me: String, iceServers: [IceServerInfo], media: LocalMedia,
        mic: RTCAudioTrack?, camera: RTCVideoTrack?, audioMuted: Bool, onEnded: @escaping (String?) -> Void
    ) {
        self.callId = callId
        self.me = me
        self.iceServers = iceServers.map { RTCIceServer(urlStrings: $0.urls, username: $0.username, credential: $0.credential) }
        self.media = media
        self.micTrack = mic
        self.cameraTrack = camera
        self.audioMuted = audioMuted
        self.onEnded = onEnded
        self.mirrorSelf = media.cameraPosition == .front
        mic?.isEnabled = !audioMuted
    }

    /// Configures the sound but does not switch it on: CallKit does that for
    /// a call it carries, and CallKitCenter.began otherwise.
    func start() {
        CallAudioSession.configure(video: cameraTrack != nil)
        onSpeaker = cameraTrack != nil || CallAudioSession.isOnSpeaker
        heartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: HEARTBEAT_NS)
                await self?.beat()
            }
        }
        statsTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                await self?.sampleStats()
            }
        }
    }

    /// Hanging up.
    func leave() async {
        guard phase != .ended else { return }
        endedByMe = true
        // The screen closes at once; the server hears about it as soon as it
        // can (a slow network used to hold the call open for the round trip).
        let callId = callId
        teardown()
        onEnded(nil)
        _ = try? await APIClient.shared.callLeave(callId: callId)
    }

    private func end(_ problem: String?) {
        guard phase != .ended else { return }
        teardown()
        onEnded(problem)
    }

    private func teardown() {
        phase = .ended
        heartbeatTask?.cancel()
        statsTask?.cancel()
        flushTask?.cancel()
        for key in Array(peers.keys) { closePeer(key) }
        media.stopAll()
        micTrack = nil
        cameraTrack = nil
        CallAudioSession.release()
    }

    // MARK: - The people in the call

    func sync(_ call: CallView?) {
        guard phase != .ended else { return }
        guard let call else {
            if seenOnServer { end(nil) }
            return
        }
        seenOnServer = true

        if let mine = call.participants.first(where: { $0.memberKey == me }),
           mine.state == "JOINED", let millis = callSessionMillis(mine.joinedAt) {
            mySessionMillis = millis
        }

        for part in call.participants where part.memberKey != me {
            let joined = part.state == "JOINED"
            peopleInfo[part.memberKey] = (name: part.name, color: part.color, joined: joined)

            if !joined {
                if peers[part.memberKey] != nil { closePeer(part.memberKey) }
                continue
            }

            let sessionMs = callSessionMillis(part.joinedAt) ?? 0
            if let existing = peers[part.memberKey], sessionMs != 0, existing.sessionMillis != 0,
               existing.sessionMillis != sessionMs {
                closePeer(part.memberKey)
            }

            if peers[part.memberKey] == nil, mySessionMillis != 0, part.joinedAt != nil {
                let mine = (key: me, joinedAt: Date(timeIntervalSince1970: mySessionMillis / 1000))
                let other = (key: part.memberKey, joinedAt: Date(timeIntervalSince1970: sessionMs / 1000))
                if callInitiates(mine: mine, other: other) {
                    _ = createPeer(key: part.memberKey, sessionMillis: sessionMs, initiator: true)
                }
            }
        }

        let listed = Set(call.participants.map(\.memberKey))
        for key in Array(peopleInfo.keys) where !listed.contains(key) {
            peopleInfo.removeValue(forKey: key)
            closePeer(key)
        }

        if let mine = call.participants.first(where: { $0.memberKey == me }), mine.state == "JOINED",
           phase == .reconnecting, peers.values.allSatisfy({ $0.connectionState != .reconnecting }) {
            phase = peers.isEmpty ? .joining : .live
        }

        refreshPeople()
    }

    /// Messages from the other devices, as the calls stream delivers them.
    func receive(_ signals: [CallSignal]) {
        for signal in signals {
            guard signal.callId == callId, phase != .ended else { continue }
            let payload = CallSignalPayload(json: signal.payload)

            var peer = peers[signal.fromKey]
            // 0 is "not known yet" on the web (a falsy session is skipped
            // there), not a different session: treating it as one closed a
            // good connection and dropped the answer it carried.
            if let existing = peer, let payloadSession = payload.session, payloadSession != 0, existing.sessionMillis != 0,
               Double(payloadSession) != existing.sessionMillis {
                closePeer(signal.fromKey)
                peer = nil
            }
            if peer == nil {
                guard signal.type == "description", payload.description?.type == "offer" else { continue }
                peer = createPeer(key: signal.fromKey, sessionMillis: Double(payload.session ?? 0), initiator: false)
            }
            guard let target = peer else { continue }
            enqueue(target) { [weak self] in await self?.handle(target, type: signal.type, payload: payload) }
        }
    }

    /// One connection's work, one step at a time: a description being
    /// applied and an offer being made never interleave.
    private func enqueue(_ peer: PeerConn, _ work: @escaping @MainActor () async -> Void) {
        let previous = peer.queue
        peer.queue = Task { @MainActor in
            _ = await previous.value
            await work()
        }
    }

    private func handle(_ peer: PeerConn, type: String, payload: CallSignalPayload) async {
        guard peer.pc.signalingState != .closed else { return }

        if type == "description", let description = payload.description {
            let isOffer = description.type == "offer"
            let collision = isOffer && (peer.makingOffer || peer.pc.signalingState != .stable)
            peer.ignoreOffer = !peer.polite && collision
            if peer.ignoreOffer { return }

            let remote = RTCSessionDescription(type: RTCSessionDescription.type(for: description.type), sdp: description.sdp)
            do { try await setRemoteDescription(peer.pc, remote) } catch { return }

            if isOffer {
                await adopt(peer)
                if (try? await setLocalDescriptionAuto(peer.pc)) != nil, let local = peer.pc.localDescription {
                    send(
                        peer.key, "description",
                        CallSignalPayload(
                            session: Int(mySessionMillis),
                            description: RTCSessionDescriptionJSON(type: RTCSessionDescription.string(for: local.type), sdp: local.sdp)
                        )
                    )
                }
            }

            let pending = peer.pendingCandidates
            peer.pendingCandidates = []
            for candidate in pending { try? await addIceCandidate(peer.pc, candidate) }
            return
        }

        if type == "candidates", let candidates = payload.candidates {
            for candidate in candidates {
                if peer.pc.remoteDescription == nil {
                    peer.pendingCandidates.append(candidate)
                } else {
                    try? await addIceCandidate(peer.pc, candidate)
                }
            }
        }
    }

    private func createPeer(key: String, sessionMillis: Double, initiator: Bool) -> PeerConn {
        let config = RTCConfiguration()
        config.iceServers = iceServers
        config.sdpSemantics = .unifiedPlan
        config.continualGatheringPolicy = .gatherContinually
        // What a browser does on its own: the polite side, holding an offer
        // of its own when the other side's arrives, rolls its own back and
        // answers. Native WebRTC refuses that offer instead unless asked, and
        // with both sides then waiting for an answer the call never connected.
        config.enableImplicitRollback = true
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let handler = PeerHandler(session: self, key: key)
        let pc = RTCEnvironment.factory.peerConnection(with: config, constraints: constraints, delegate: handler)!

        let dcConfig = RTCDataChannelConfiguration()
        dcConfig.isNegotiated = true
        dcConfig.channelId = 0
        dcConfig.isOrdered = true
        let channel = pc.dataChannel(forLabel: "state", configuration: dcConfig)!
        channel.delegate = handler

        let peer = PeerConn(key: key, sessionMillis: sessionMillis, pc: pc, handler: handler, polite: callIsPolite(me: me, other: key), channel: channel)
        peers[key] = peer

        if initiator {
            let initObj = RTCRtpTransceiverInit()
            initObj.direction = .sendRecv

            let audioTx = micTrack.map { pc.addTransceiver(with: $0, init: initObj) } ?? pc.addTransceiver(of: .audio, init: initObj)
            if let audioTx { peer.setRole(audioTx, .audio) }

            let videoTx = cameraTrack.map { pc.addTransceiver(with: $0, init: initObj) } ?? pc.addTransceiver(of: .video, init: initObj)
            if let videoTx { peer.setRole(videoTx, .camera) }
        }

        refreshPeople()
        return peer
    }

    /// On receiving an offer: take on the other side's transceivers, sending
    /// this device's tracks on them — mirrors call-session.ts's `adopt`.
    private func adopt(_ peer: PeerConn) async {
        for transceiver in peer.pc.transceivers {
            if peer.roles.contains(where: { $0.transceiver == transceiver }) { continue }
            if transceiver.isStopped { continue }
            guard let track = transceiver.receiver.track else { continue }

            var role: CallRole = .receive
            if track.kind == kRTCMediaStreamTrackKindAudio, !peer.hasRole(.audio) { role = .audio }
            else if track.kind == kRTCMediaStreamTrackKindVideo, !peer.hasRole(.camera) { role = .camera }
            peer.setRole(transceiver, role)

            let sendTrack: RTCMediaStreamTrack? = role == .audio ? micTrack : role == .camera ? cameraTrack : nil
            setTransceiverDirection(transceiver, role == .receive ? .recvOnly : .sendRecv)
            transceiver.sender.track = sendTrack
        }
    }

    func connectionChanged(key: String, state: RTCPeerConnectionState) {
        guard let peer = peers[key] else { return }
        peer.restartWork?.cancel()

        switch state {
        case .connected:
            peer.connectionState = .connected
            peer.everConnected = true
            if phase != .ended { phase = .live }
        case .disconnected:
            peer.connectionState = .reconnecting
            peer.restartWork = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard let self, let p = self.peers[key], p.pc.connectionState != .connected, p.pc.signalingState != .closed else { return }
                p.pc.restartIce()
            }
        case .failed:
            peer.connectionState = .reconnecting
            peer.pc.restartIce()
        default:
            break
        }

        if phase == .live, peers.values.contains(where: { $0.connectionState == .reconnecting }) { phase = .reconnecting }
        refreshPeople()
    }

    /// WebRTC's native "negotiation needed" fires as soon as something
    /// changes — even while an offer from the other side is still being
    /// applied, which a browser never does. So the offer waits its turn in
    /// the connection's queue, and is only made from a settled state; WebRTC
    /// asks again once it is back there if an offer is still owed.
    func negotiationNeeded(key: String) {
        guard let peer = peers[key] else { return }
        enqueue(peer) { [weak self] in await self?.makeOffer(peer) }
    }

    private func makeOffer(_ peer: PeerConn) async {
        guard phase != .ended, peers[peer.key] === peer, peer.pc.signalingState == .stable else { return }
        peer.makingOffer = true
        defer { peer.makingOffer = false }
        do {
            try await setLocalDescriptionAuto(peer.pc)
            if let local = peer.pc.localDescription {
                send(
                    peer.key, "description",
                    CallSignalPayload(
                        session: Int(mySessionMillis),
                        description: RTCSessionDescriptionJSON(type: RTCSessionDescription.string(for: local.type), sdp: local.sdp)
                    )
                )
            }
        } catch {
            // Closed while offering.
        }
    }

    func addLocalCandidate(key: String, candidate: RTCIceCandidate) {
        let json = RTCIceCandidateJSON(candidate: candidate.sdp, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex)
        pendingCandidatesOut[key, default: []].append(json)
        flushSoon(150)
    }

    func signalingStateChanged(key: String, state: RTCSignalingState) {
        guard state == .stable, let peer = peers[key] else { return }
        sendState(peer)
    }

    func channelOpened(key: String) {
        guard let peer = peers[key] else { return }
        sendState(peer)
    }

    func receivedState(key: String, data: Data) {
        guard let peer = peers[key], let decoded = try? JSONDecoder().decode(CallDataChannelState.self, from: data) else { return }
        peer.remote = CallRemoteState(
            audioMuted: decoded.audioMuted, videoOff: decoded.videoOff, sharing: decoded.sharing,
            cameraMid: decoded.mids.camera, screenMid: decoded.mids.screen
        )
        refreshPeople()
    }

    func tracksChanged(key: String) {
        refreshPeople()
    }

    private func closePeer(_ key: String) {
        guard let peer = peers.removeValue(forKey: key) else { return }
        peer.restartWork?.cancel()
        peer.handler.detach()
        peer.pc.close()
        pendingCandidatesOut.removeValue(forKey: key)
        speakingKeys.remove(key)
        refreshPeople()
    }

    private func sendState(_ peer: PeerConn) {
        guard peer.channel.readyState == .open else { return }
        var state = CallDataChannelState()
        state.audioMuted = audioMuted || micTrack == nil
        state.videoOff = cameraTrack == nil
        state.sharing = false
        state.mids.camera = peer.role(.camera)?.mid
        state.mids.screen = nil
        guard let data = try? JSONEncoder().encode(state) else { return }
        _ = peer.channel.sendData(RTCDataBuffer(data: data, isBinary: false))
    }

    private func broadcastState() { for peer in peers.values { sendState(peer) } }

    private func refreshPeople() {
        var list: [CallPersonState] = []
        for (key, info) in peopleInfo where info.joined {
            let peer = peers[key]
            let transceivers = peer?.pc.transceivers ?? []
            let remote = peer?.remote ?? CallRemoteState()

            func videoTrack(forMid mid: String?) -> RTCVideoTrack? {
                guard let mid else { return nil }
                return transceivers.first { $0.mid == mid }?.receiver.track as? RTCVideoTrack
            }
            let firstVideo = transceivers.first { $0.receiver.track?.kind == kRTCMediaStreamTrackKindVideo }?.receiver.track as? RTCVideoTrack
            let cameraTrack = videoTrack(forMid: remote.cameraMid) ?? (remote.cameraMid == nil ? firstVideo : nil)
            let screenTrack = remote.sharing ? videoTrack(forMid: remote.screenMid) : nil
            let audioTrack = transceivers.first { $0.receiver.track?.kind == kRTCMediaStreamTrackKindAudio }?.receiver.track as? RTCAudioTrack

            list.append(
                CallPersonState(
                    key: key, name: info.name, color: info.color,
                    audioTrack: audioTrack, cameraTrack: cameraTrack, screenTrack: screenTrack,
                    audioMuted: remote.audioMuted, videoOff: remote.videoOff, sharing: remote.sharing,
                    speaking: speakingKeys.contains(key),
                    quality: peer?.quality ?? .unknown,
                    connection: peer?.connectionState ?? .connecting,
                    connectingSince: peer.flatMap { $0.everConnected ? nil : $0.createdAt }
                )
            )
        }
        people = list.sorted { $0.name < $1.name }
    }

    // MARK: - The messages between devices

    private func send(_ to: String, _ type: String, _ payload: CallSignalPayload) {
        outbox.append((to: to, type: type, payload: payload))
        flushSoon(0)
    }

    private func flushSoon(_ delayMs: Int) {
        if flushTask != nil, delayMs > 0 { return }
        flushTask?.cancel()
        flushTask = Task { [weak self] in
            if delayMs > 0 { try? await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000) }
            await self?.flush()
        }
    }

    private func flush() async {
        flushTask = nil
        if flushing { flushSoon(100); return }

        for (to, list) in pendingCandidatesOut where !list.isEmpty {
            outbox.append((to: to, type: "candidates", payload: CallSignalPayload(session: Int(mySessionMillis), candidates: list)))
        }
        pendingCandidatesOut.removeAll()
        guard !outbox.isEmpty, phase != .ended else { return }

        let batch = Array(outbox.prefix(40))
        outbox.removeFirst(min(batch.count, outbox.count))
        flushing = true
        do {
            let signals = batch.map { JSONValue.object(["to": .string($0.to), "type": .string($0.type), "payload": $0.payload.toJSON()]) }
            try await APIClient.shared.callSendSignals(callId: callId, signals: signals)
        } catch APIError.refused, APIError.unauthorized {
            // The server said no (this device is not in the call any more):
            // sending the same batch again every second would not change
            // that. The web drops it too; the heartbeat rejoins if it can.
        } catch {
            outbox.insert(contentsOf: batch, at: 0)
            flushing = false
            flushSoon(1000)
            return
        }
        flushing = false
        if !outbox.isEmpty || !pendingCandidatesOut.isEmpty { flushSoon(0) }
    }

    // MARK: - What this device sends

    func setMuted(_ muted: Bool) {
        audioMuted = muted
        micTrack?.isEnabled = !muted
        broadcastState()
    }

    func toggleSpeaker() {
        onSpeaker.toggle()
        CallAudioSession.setSpeaker(onSpeaker)
    }

    /// The sound moved without a tap here — the lock screen's audio button,
    /// a headset — so the speaker button says where it went.
    func routeChanged(onSpeaker now: Bool) {
        guard phase != .ended, onSpeaker != now else { return }
        onSpeaker = now
    }

    func setCameraEnabled(_ on: Bool) async {
        if !on {
            media.stopCamera()
            cameraTrack = nil
            await swap(.camera, track: nil)
        } else {
            guard await callMediaAllowed(.video) else {
                problem = CallMediaProblem.cameraDenied.text
                return
            }
            do {
                let track = try await media.startCamera(position: .front)
                cameraTrack = track
                mirrorSelf = media.cameraPosition == .front
                if !onSpeaker {
                    onSpeaker = true
                    CallAudioSession.setSpeaker(true)
                }
                await swap(.camera, track: track)
            } catch {
                problem = (error as? CallMediaProblem)?.text ?? L("The camera is not available.")
            }
        }
        broadcastState()
    }

    func flipCamera() async {
        guard cameraTrack != nil else { return }
        do {
            let track = try await media.flipCamera()
            mirrorSelf = media.cameraPosition == .front
            if track !== cameraTrack {
                cameraTrack = track
                await swap(.camera, track: track)
            }
            broadcastState()
        } catch {
            problem = L("The camera could not be switched.")
        }
    }

    private func swap(_ role: CallRole, track: RTCMediaStreamTrack?) async {
        for peer in peers.values {
            if let existing = peer.role(role) {
                if track != nil { setTransceiverDirection(existing, .sendRecv) }
                existing.sender.track = track
            } else if let track {
                let initObj = RTCRtpTransceiverInit()
                initObj.direction = .sendRecv
                if let tx = peer.pc.addTransceiver(with: track, init: initObj) { peer.setRole(tx, role) }
            }
        }
        refreshPeople()
    }

    // MARK: - Connection quality and who is speaking

    private func sampleStats() async {
        for (key, peer) in peers {
            guard let report = try? await statistics(peer.pc) else { continue }
            var rttMs: Double?
            var jitterMs: Double?
            var lost = 0
            var received = 0
            var audioLevel: Double?

            for stat in report.statistics.values {
                if stat.type == "candidate-pair",
                   (stat.values["state"] as? String) == "succeeded",
                   ((stat.values["nominated"] as? Bool) ?? false) || ((stat.values["selected"] as? Bool) ?? false),
                   let rtt = stat.values["currentRoundTripTime"] as? Double {
                    rttMs = rtt * 1000
                }
                if stat.type == "inbound-rtp" {
                    if let value = stat.values["packetsLost"] as? Double { lost += Int(value) }
                    if let value = stat.values["packetsReceived"] as? Double { received += Int(value) }
                    if let value = stat.values["jitter"] as? Double { jitterMs = max(jitterMs ?? 0, value * 1000) }
                    if let value = stat.values["audioLevel"] as? Double, value > 0 { audioLevel = value }
                }
            }

            let before = peer.lastPackets
            peer.lastPackets = (lost, received)
            let newLost = before.map { lost - $0.lost } ?? 0
            let newReceived = before.map { received - $0.received } ?? 0
            let lossRatio: Double? = before != nil && newLost + newReceived > 0 ? max(0, Double(newLost)) / Double(newLost + newReceived) : nil
            peer.quality = callQualityOf(CallStatsSample(rttMs: rttMs, lossRatio: lossRatio, jitterMs: jitterMs))

            let wasSpeaking = speakingKeys.contains(key)
            let speaking = !peer.remote.audioMuted && (audioLevel.map { callIsSpeaking(level: $0, wasSpeaking: wasSpeaking) } ?? false)
            if speaking { speakingKeys.insert(key) } else { speakingKeys.remove(key) }
        }
        refreshPeople()
    }

    private func statistics(_ pc: RTCPeerConnection) async throws -> RTCStatisticsReport {
        await withCheckedContinuation { continuation in
            pc.statistics { report in continuation.resume(returning: report) }
        }
    }

    // MARK: - Still here

    private func beat() async {
        guard phase != .ended else { return }
        do {
            let inCall = try await APIClient.shared.callHeartbeat(callId: callId)
            if inCall { return }
            phase = .reconnecting
            do {
                _ = try await APIClient.shared.callJoin(callId: callId)
            } catch APIError.refused(let message) {
                end(message)
            } catch APIError.unauthorized {
                end(APIError.unauthorized.errorDescription)
            } catch {
                // No network (the very gap that made the server count this
                // device as gone): not a refusal, so the call is not ended —
                // the next beat tries again, as the web's does.
            }
        } catch {
            if phase != .ended { phase = .reconnecting }
        }
    }

    // MARK: - Small async wrappers over WebRTC's completion-handler API

    private func setRemoteDescription(_ pc: RTCPeerConnection, _ sdp: RTCSessionDescription) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            pc.setRemoteDescription(sdp) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    private func setLocalDescriptionAuto(_ pc: RTCPeerConnection) async throws {
        // WebRTC's Objective-C `-setLocalDescriptionWithCompletionHandler:`
        // (no session description: it creates an offer or answer itself,
        // exactly like the web's no-argument `pc.setLocalDescription()`)
        // bridges straight to this throwing async call.
        try await pc.setLocalDescription()
    }

    private func addIceCandidate(_ pc: RTCPeerConnection, _ json: RTCIceCandidateJSON) async throws {
        let candidate = RTCIceCandidate(sdp: json.candidate, sdpMLineIndex: json.sdpMLineIndex ?? 0, sdpMid: json.sdpMid)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            pc.add(candidate) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }
}

private let HEARTBEAT_NS: UInt64 = 5_000_000_000

/// When somebody joined, in whole milliseconds — the number the web sends as
/// a message's `session` (`Date.getTime()`). Rounded, not truncated: a
/// parsed ".123" can land a hair under 123 ms, and a session that is out by
/// one looks like a different one, which closed the connection and dropped
/// the other side's answer.
func callSessionMillis(_ iso: String?) -> Double? {
    guard let date = parseISODate(iso) else { return nil }
    return (date.timeIntervalSince1970 * 1000).rounded()
}

/// `RTCRtpTransceiver.setDirection(_:error:)` takes an `NSError**`, so a
/// small wrapper is worth it at every call site above.
private func setTransceiverDirection(_ transceiver: RTCRtpTransceiver, _ direction: RTCRtpTransceiverDirection) {
    var error: NSError?
    transceiver.setDirection(direction, error: &error)
}
