import SwiftUI
import UIKit

/// While the app is in the foreground, tell the server this person is here
/// every 30 seconds (POST /api/mobile/presence) — the heartbeat the website
/// writes from /api/live, so the green dot means the same on both.
///
/// Started once, from the chat tab's root, which every signed-in person's tab
/// bar builds as soon as it appears. It beats only while the app is active
/// and somebody is signed in, and beats at once when the app comes back.
@MainActor
final class ChatPresenceHeartbeat {
    static let shared = ChatPresenceHeartbeat()

    private var loop: Task<Void, Never>?
    private var observers: [NSObjectProtocol] = []
    private let interval: UInt64 = 30 * 1_000_000_000

    private init() {}

    /// Safe to call as often as a view likes: only the first call starts it.
    nonisolated static func ensureStarted() {
        Task { @MainActor in shared.start() }
    }

    private func start() {
        guard loop == nil else { return }
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in ChatPresenceHeartbeat.shared.restart() }
        })
        observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in ChatPresenceHeartbeat.shared.pause() }
        })
        restart()
    }

    private func restart() {
        loop?.cancel()
        loop = Task { @MainActor [interval] in
            while !Task.isCancelled {
                let api = APIClient.shared
                if api.isLoggedIn, UIApplication.shared.applicationState == .active {
                    await api.sendChatPresence()
                }
                try? await Task.sleep(nanoseconds: interval)
            }
        }
    }

    private func pause() {
        loop?.cancel()
        // Keep `loop` non-nil so `start` stays a no-op; `restart` replaces it.
        loop = Task {}
    }
}
