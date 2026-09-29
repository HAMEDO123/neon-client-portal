#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Add every screen and sheet of this area here, so each can be checked.
enum ChatScreens {
    static let ids: [String] = ["chat-room-team", "chat-meetings"]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "chat-room-team":
            return debugPushed(ChatRoomView(route: ChatRoute(slug: "team", title: "NEON Team", subtitle: nil, avatar: nil, isGroup: true)))
        case "chat-meetings": return debugPushed(MeetingsView())
        default: return nil
        }
    }
}
#endif
