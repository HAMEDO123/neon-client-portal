import UIKit
import Foundation
import WebRTC

// Calls, everywhere in the app — the Swift counterpart of call-provider.tsx.
// One instance for the whole app (mounted through CallOverlay at the root),
// so a call rings on any screen and a call in progress stays up while the
// person moves around the app. It holds the calls stream open (SSE, with
// resume), rings for incoming calls, and runs the call itself (CallSession).

enum CallViewMode { case full, minimized }

enum PreJoinRequest: Identifiable {
    case start(conversation: String, kind: String, title: String)
    case join(callId: String, kind: String, title: String)

    var id: String {
        switch self {
        case .start(let conversation, _, _): return "start:\(conversation)"
        case .join(let callId, _, _): return "join:\(callId)"
        }
    }
    var title: String {
        switch self {
        case .start(_, _, let title): return title
        case .join(_, _, let title): return title
        }
    }
    var isVideo: Bool {
        switch self {
        case .start(_, let kind, _): return kind == "VIDEO"
        case .join(_, let kind, _): return kind == "VIDEO"
        }
    }
}

@MainActor
final class CallCenter: ObservableObject {
    static let shared = CallCenter()

    @Published private(set) var ready: CallReady?
    @Published private(set) var calls: [CallView] = []
    @Published var session: CallSession?
    @Published var viewMode: CallViewMode = .full
    @Published var prejoinRequest: PreJoinRequest?
    @Published var notice: String?
    @Published var answering = false
    private var dismissedCallIds: Set<String> = []

    private var streamTask: Task<Void, Never>?
    private var lastEventId = 0
    private var started = false
    /// Why the stream last failed, so a loop that retries every two seconds
    /// says each reason once rather than over and over.
    private var streamProblem: String?
    private let streamURL = URL(string: "https://clients.neonjo.com/api/mobile/calls/stream")!

    private init() {
        // Closed mid-call: say "away", not "leave" — the same grace a
        // reloading web page gets, so coming straight back rejoins the call.
        NotificationCenter.default.addObserver(forName: UIApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
            guard let callId = self?.session?.callId else { return }
            let done = DispatchSemaphore(value: 0)
            Task.detached {
                _ = try? await APIClient.shared.callAway(callId: callId)
                done.signal()
            }
            _ = done.wait(timeout: .now() + 1.5)
        }
    }

    var me: String? { ready?.me }

    /// The call ringing for this device right now, if any — not the call on
    /// screen, and not one already dismissed.
    var ringingCall: CallView? {
        guard let me else { return nil }
        return calls.first { call in
            call.id != session?.callId && call.status != "ENDED" && !dismissedCallIds.contains(call.id)
                && call.participants.contains { $0.memberKey == me && $0.state == "INVITED" }
        }
    }

    /// The call this conversation is in right now, ringing or running — for
    /// CallButtons to offer "Join call" or "Back to call".
    func ongoingCall(conversationSlug: String) -> CallView? {
        calls.first { $0.conversationSlug == conversationSlug && $0.status != "ENDED" }
    }

    // MARK: - Lifecycle

    func start() {
        guard !started else { return }
        started = true
        streamTask = Task { [weak self] in await self?.runStream() }
    }

    func stop() {
        started = false
        streamTask?.cancel()
        streamTask = nil
        ready = nil
        calls = []
        streamProblem = nil
        Task { [weak self] in await self?.session?.leave() }
        session = nil
    }

    private func runStream() async {
        while !Task.isCancelled {
            await connectOnce()
            if Task.isCancelled { return }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
    }

    /// Says why calls are not connecting — once per reason.
    ///
    /// Every one of these used to be a bare `return`: the loop outside waited
    /// two seconds and tried again, for ever, so being signed out, a route
    /// that is not there and a connection still being made all looked the same
    /// from the screen — "Calls are still connecting". That is the one thing
    /// a person cannot act on, and it is exactly what they were shown.
    private func reportStream(_ problem: String?) {
        guard streamProblem != problem else { return }
        streamProblem = problem
        if let problem { notice = problem }
    }

    private func connectOnce() async {
        guard let token = APIClient.shared.token else {
            reportStream(L("You are signed out. Sign in again to make calls."))
            return
        }
        var request = URLRequest(url: streamURL)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        if lastEventId > 0 { request.setValue(String(lastEventId), forHTTPHeaderField: "Last-Event-ID") }
        request.timeoutInterval = 300

        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            guard let http = response as? HTTPURLResponse else {
                reportStream(L("Calls could not reach the server."))
                return
            }
            guard http.statusCode == 200 else {
                // 401 is a token this server will not take any more; anything
                // else is worth showing as itself, because a 404 here means
                // this build is asking for a route the server does not have —
                // an app that needs rebuilding, which no amount of waiting
                // fixes.
                reportStream(
                    http.statusCode == 401
                        ? L("You are signed out. Sign in again to make calls.")
                        : L("Calls are unavailable (%ld). The app may need updating.", http.statusCode)
                )
                return
            }

            // Connected: whatever was wrong before is not wrong now.
            reportStream(nil)

            // serverSentEvents, not `bytes.lines`: that sequence drops the
            // empty line that ends each event, so none was ever handled.
            for try await event in bytes.serverSentEvents() {
                if Task.isCancelled { return }
                handleEvent(event.name, event.data, id: event.id.flatMap { Int($0) })
            }
        } catch {
            // A network drop; the loop above reconnects after a short delay,
            // sending the last signal id it saw so nothing is missed.
        }
    }

    private func handleEvent(_ name: String, _ data: String, id: Int?) {
        guard let jsonData = data.data(using: .utf8) else { return }
        switch name {
        case "ready":
            // Not `try?`. That set `ready` to nil on a payload it could not
            // read — no error, no message, and the screen saying "still
            // connecting" for ever, which is the same dead end the silent
            // returns above used to produce. It also wiped a good `ready`
            // that had already arrived, so one odd payload broke calls until
            // the app was restarted.
            do {
                ready = try JSONDecoder().decode(CallReady.self, from: jsonData)
                reportStream(nil)
            } catch {
                reportStream(L("Calls cannot read what the server sent. The app may need updating."))
            }
        case "calls":
            guard let value = try? JSONDecoder().decode([CallView].self, from: jsonData) else { return }
            calls = value
            let active = session.flatMap { current in value.first { $0.id == current.callId } }
            session?.sync(active)
        case "signals":
            if let id { lastEventId = id }
            guard let value = try? JSONDecoder().decode([CallSignal].self, from: jsonData) else { return }
            session?.receive(value)
        default:
            break
        }
    }

    // MARK: - Starting, joining, answering

    func prepare(_ request: PreJoinRequest) { prejoinRequest = request }

    /// Starts or joins, with the devices chosen on the pre-join screen.
    func confirmPreJoin(mic: RTCAudioTrack?, camera: RTCVideoTrack?, audioMuted: Bool, problem: CallMediaProblem?) async {
        guard let request = prejoinRequest else { return }
        prejoinRequest = nil
        do {
            try await begin(request, mic: mic, camera: camera, audioMuted: audioMuted)
            if let problem { notice = problem.text }
        } catch {
            notice = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func cancelPreJoin() { prejoinRequest = nil }

    private func begin(_ request: PreJoinRequest, mic: RTCAudioTrack?, camera: RTCVideoTrack?, audioMuted: Bool) async throws {
        // Tapped before the stream's first event arrived (just after launch,
        // or on a slow connection): wait for it rather than refusing at once.
        if ready == nil {
            if !started { start() }
            for _ in 0..<40 where ready == nil {
                try? await Task.sleep(nanoseconds: 250_000_000)
            }
        }
        guard let ready else {
            if let streamProblem { throw CallCenterError.stream(streamProblem) }
            throw CallCenterError.notReady
        }

        if let current = session { await current.leave() }

        let callId: String
        let servers: [IceServerInfo]
        switch request {
        case .start(let conversation, let kind, _):
            let answer = try await APIClient.shared.callStart(conversation: conversation, kind: kind)
            callId = answer.callId
            servers = answer.iceServers
        case .join(let id, _, _):
            let answer = try await APIClient.shared.callJoin(callId: id)
            callId = answer.callId
            servers = answer.iceServers
        }

        let next = CallSession(
            callId: callId, me: ready.me, iceServers: servers.isEmpty ? ready.iceServers : servers,
            mic: mic, camera: camera, audioMuted: audioMuted,
            onEnded: { [weak self] problem in
                Task { @MainActor in self?.endSession(problem) }
            }
        )
        session = next
        next.start()
        viewMode = .full
    }

    private func endSession(_ problem: String?) {
        session = nil
        viewMode = .full
        if let problem { notice = problem }
    }

    func accept(_ call: CallView, video: Bool) async {
        Haptic.soft()
        answering = true
        dismissedCallIds.insert(call.id)
        let media = LocalMedia()
        let opened = await openCallMedia(video: video, media: media)
        do {
            try await begin(.join(callId: call.id, kind: call.kind, title: call.title), mic: opened.mic, camera: opened.camera, audioMuted: false)
            if let problem = opened.problem { notice = problem.text }
        } catch {
            media.stopAll()
            notice = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        answering = false
    }

    func decline(_ call: CallView) {
        dismissedCallIds.insert(call.id)
        Task { try? await APIClient.shared.callDecline(callId: call.id) }
    }

    func expand() { viewMode = .full }
    func minimize() { viewMode = .minimized }
    func dismissNotice() { notice = nil }
}

enum CallCenterError: LocalizedError {
    case notReady
    case stream(String)
    var errorDescription: String? {
        switch self {
        case .notReady: return L("Calls could not connect to the server. Check the connection and try again.")
        case .stream(let problem): return problem
        }
    }
}
