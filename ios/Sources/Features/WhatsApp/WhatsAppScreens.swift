#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Add every screen and sheet of this area here, so each can be checked.
enum WhatsAppScreens {
    static let ids: [String] = ["whatsapp", "whatsapp-settings", "whatsapp-thread"]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "whatsapp": return debugPushed(WhatsAppRootView())
        case "whatsapp-settings": return debugPushed(WhatsAppSettingsView())
        case "whatsapp-thread":
            return debugPushed(DebugAsync(load: { () async throws -> (WhatsAppChat, String)? in
                let inbox = try await APIClient.shared.fetchWhatsAppInbox().value
                guard let chat = inbox.chats.first else { return nil }
                return (chat, inbox.timeZone)
            }) { pair in
                WhatsAppThreadView(chat: pair.0, timeZone: pair.1)
            })
        default: return nil
        }
    }
}
#endif
