import Foundation

// The call behind the status screen. Contract: ios/ARCHITECTURE.md §2 — "Put
// these calls in an extension APIClient in your own folder."

extension APIClient {
    /// `ops/status` (src/lib/mobile/registry/ops.ts), the manager's only.
    ///
    /// Always the server's answer, never the on-disk copy: a status saved
    /// while everything was running, shown under an "Offline" banner while
    /// the PC is down, would say the opposite of the truth at exactly the
    /// moment somebody opened this screen to find out. Unreachable is itself
    /// the answer then, and the screen says so.
    func opsStatus() async throws -> StatusReport {
        try await readFresh("ops/status", as: StatusReport.self)
    }
}
