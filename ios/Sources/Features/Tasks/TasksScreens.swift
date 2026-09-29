#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Add every screen and sheet of this area here, so each can be checked.
enum TasksScreens {
    static let ids: [String] = []

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        default: return nil
        }
    }
}
#endif
