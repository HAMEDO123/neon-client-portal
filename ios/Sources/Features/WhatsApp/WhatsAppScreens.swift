#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Add every screen and sheet of this area here, so each can be checked.
enum WhatsAppScreens {
    static let ids: [String] = ["whatsapp"]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "whatsapp": return debugPushed(WhatsAppRootView())
        default: return nil
        }
    }
}
#endif
