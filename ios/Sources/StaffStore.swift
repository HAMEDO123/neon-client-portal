import SwiftUI

/// What the employee's tabs share: who they are, the two badge counts, and the
/// warnings pinned to the top of their day. All of it is `/me`, re-read on
/// launch, on returning to the app, and every half minute while it is open —
/// there is no push to the app yet, so this is how a badge moves.
@MainActor
final class StaffStore: ObservableObject {
    @Published private(set) var badges = Badges(unread: 0, unreadChat: 0)
    @Published private(set) var warnings: [StaffWarning] = []
    @Published private(set) var loadedOnce = false

    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    func refresh() async {
        guard let me = try? await api.fetchMe() else { return }
        if let badges = me.badges { self.badges = badges }
        warnings = me.warnings ?? []
        loadedOnce = true
    }

    /// Keeps the counts current while the app is in front of somebody.
    func poll() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(nanoseconds: 30 * 1_000_000_000)
        }
    }
}
