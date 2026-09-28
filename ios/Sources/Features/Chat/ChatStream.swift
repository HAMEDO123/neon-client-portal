import Foundation

// The live half of a conversation: one open connection, read as
// Server-Sent Events exactly as the web's /api/chat/stream is, mirrored at
// /api/mobile/chat/stream with the app's bearer token. It carries three kinds
// of news a conversation screen wants sooner than its own poll would notice:
// `messages` (a new one, the moment it is sent), `reactions` (what people gave
// a message and what is pinned) and `people` (who is writing, and how far
// each person has read). Card freshness (a task's part moving, a meeting
// answered) is left to the screen's own poll of `/chat/messages`, which
// already re-reads every card fresh each time — a second live channel for
// exactly the same data the poll already refreshes would be duplication, not
// speed.
//
// Falls back to nothing itself: a screen that starts this task keeps its own
// poll running underneath regardless, so a proxy that buffers or a network
// that refuses a long-lived request costs only the poll's own interval.

enum ChatStreamEvent {
    case messages([ChatMessage])
    case reactions(ChatReactionSnapshot)
    case people(ChatPeopleSnapshot)
    case connected
}

enum ChatStream {
    // The same host APIClient talks to; Core/APIClient.swift keeps its own
    // copy private, so this is not sharing a constant, it is the one other
    // place the app's address is written down.
    private static let base = URL(string: "https://clients.neonjo.com/api/mobile")!

    /// Stays open until cancelled or the connection drops, calling `onEvent`
    /// for each one read. Reconnects with a short backoff on its own, resuming
    /// from the last message it saw so nothing is repeated or skipped — the
    /// caller only needs to run this inside a `.task` and cancel it on
    /// disappear.
    static func listen(conversation: String, token: String, onEvent: @escaping (ChatStreamEvent) -> Void) async {
        var since = Date()
        var backoff: UInt64 = 1
        while !Task.isCancelled {
            let connectedAt = Date()
            let sawMessage = await open(conversation: conversation, since: since, token: token) { event in
                if case .messages(let batch) = event, let last = batch.last, let at = parseISODate(last.createdAt) {
                    since = at
                }
                onEvent(event)
            }
            if Task.isCancelled { break }
            // A connection that stayed up a while failing is a network blip,
            // not a broken stream — try again quickly. One that never opened
            // (a proxy that refuses it outright) backs off so a hostile
            // network is not hammered every second.
            let stayedUp = Date().timeIntervalSince(connectedAt) > 5
            backoff = stayedUp || !sawMessage ? 1 : min(backoff * 2, 30)
            try? await Task.sleep(nanoseconds: backoff * 1_000_000_000)
        }
    }

    /// One connection attempt. Returns whether it ever reached the server at
    /// all, which is what tells `listen` whether to back off.
    private static func open(
        conversation: String,
        since: Date,
        token: String,
        onEvent: @escaping (ChatStreamEvent) -> Void
    ) async -> Bool {
        var components = URLComponents(url: base.appendingPathComponent("chat/stream"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "with", value: conversation),
            URLQueryItem(name: "since", value: ISO8601DateFormatter().string(from: since)),
        ]
        guard let url = components.url else { return false }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 300

        var reached = false
        var eventName = "message"
        var dataLines: [String] = []

        func flush() {
            guard !dataLines.isEmpty else { return }
            defer { dataLines = [] }
            let payload = Data(dataLines.joined(separator: "\n").utf8)
            switch eventName {
            case "messages":
                if let batch = try? JSONDecoder().decode([ChatMessage].self, from: payload) {
                    onEvent(.messages(batch))
                }
            case "reactions":
                if let snapshot = try? JSONDecoder().decode(ChatReactionSnapshot.self, from: payload) {
                    onEvent(.reactions(snapshot))
                }
            case "people":
                if let snapshot = try? JSONDecoder().decode(ChatPeopleSnapshot.self, from: payload) {
                    onEvent(.people(snapshot))
                }
            case "ready":
                onEvent(.connected)
            default:
                break
            }
        }

        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return false }
            reached = true
            for try await line in bytes.lines {
                if Task.isCancelled { break }
                if line.isEmpty {
                    eventName = "message"
                    flush()
                    continue
                }
                if line.hasPrefix("event:") {
                    eventName = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                } else if line.hasPrefix("data:") {
                    dataLines.append(String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces))
                }
                // Anything else (the ": keep-alive" comment) is only there to
                // hold the connection open and carries no event of its own.
            }
        } catch {
            // A dropped connection or a cancel — `listen` reconnects, or the
            // caller's own poll keeps the screen current either way.
        }
        return reached
    }
}
