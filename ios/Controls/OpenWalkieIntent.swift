import AppIntents
import Foundation

// Opening the walkie-talkie from outside the app: the lock screen's button
// (Controls/WalkieControl.swift). Compiled into the app and the controls
// extension both: iOS opens the app and runs this there, and the app shows the
// walkie-talkie screen (NeonAdminApp, `WalkieOpenRequest`).

/// The app's side of "open the walkie-talkie": a flag the app reads when it
/// comes forward, and a nudge for when it is already running.
enum WalkieOpenRequest {
    static let key = "walkie_open_requested"
    static let notification = Notification.Name("neon.walkie.open")

    static func ask() {
        UserDefaults.standard.set(true, forKey: key)
        NotificationCenter.default.post(name: notification, object: nil)
    }

    /// Whether it was asked for, once.
    static func take() -> Bool {
        let asked = UserDefaults.standard.bool(forKey: key)
        if asked { UserDefaults.standard.removeObject(forKey: key) }
        return asked
    }
}

@available(iOS 18.0, *)
struct OpenWalkieIntent: AppIntent {
    static let title: LocalizedStringResource = "Open the walkie-talkie"
    static let description = IntentDescription("Opens NEON on the walkie-talkie, ready to talk.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        WalkieOpenRequest.ask()
        return .result()
    }
}
