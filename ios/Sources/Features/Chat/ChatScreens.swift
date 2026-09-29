#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Every screen and sheet of the chat list is here. Nothing opened from here
/// sends or changes anything: the story viewer opens as a still that marks
/// nothing seen, and the sheets' buttons are only drawn.
///
/// Anchors for `-neonScroll`: chat-list* take `stories`, `filters`, `end`;
/// chat-group-new and chat-group-info take `members` (and `delete`).
enum ChatScreens {
    static let ids: [String] = [
        "chat-list", "chat-list-unread", "chat-list-groups", "chat-list-tasks", "chat-list-favorites", "chat-list-search",
        "chat-new", "chat-group-new", "chat-group-info", "chat-group-add-members",
        "chat-story-new", "chat-story-player", "chat-story-player-mine", "chat-story-viewers",
    ]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "chat-list": return AnyView(ChatListView())
        case "chat-list-unread": return AnyView(ChatListView(initialFilter: .unread))
        case "chat-list-groups": return AnyView(ChatListView(initialFilter: .groups))
        case "chat-list-tasks": return AnyView(ChatListView(initialFilter: .tasks))
        case "chat-list-favorites": return AnyView(ChatListView(initialFilter: .favorites))
        case "chat-list-search": return AnyView(ChatListView(startsSearching: true))
        case "chat-new": return AnyView(ChatScreensSide { isManager, _ in ChatNewConversationSheet(isManager: isManager) { _ in } })
        case "chat-group-new":
            return AnyView(ChatScreensAsync(load: { api in try await api.fetchChatPeople() }) { people in
                NavigationStack {
                    ChatGroupForm(people: people.filter { $0.id != "manager" }) { _ in }
                }
            })
        case "chat-group-info":
            return AnyView(ChatScreensAsync(load: { api in
                try await api.fetchConversations().value.conversations.first(where: \.isCustomGroup)?.slug
            }) { slug in
                ChatGroupInfoSheet(slug: slug)
            })
        case "chat-group-add-members":
            return AnyView(ChatMemberPickerSheet(excluding: []) { _ in })
        case "chat-story-new": return AnyView(ChatStoryComposer())
        case "chat-story-player":
            return AnyView(ChatScreensAsync(load: { api in
                let others = try await api.fetchChatStories().value.others
                return others.isEmpty ? nil : others
            }) { rings in
                ChatScreensSide { _, myKey in
                    ChatStoryPlayer(rings: rings, startRing: 0, myKey: myKey, isPreview: true, onMessage: { _ in })
                        .neonLanguage()
                }
            })
        case "chat-story-player-mine":
            return AnyView(ChatScreensAsync(load: { api in
                try await api.fetchChatStories().value.mine.flatMap { $0.stories.isEmpty ? nil : $0 }
            }) { mine in
                ChatScreensSide { _, myKey in
                    ChatStoryPlayer(rings: [mine], startRing: 0, myKey: myKey, isPreview: true)
                        .neonLanguage()
                }
            })
        case "chat-story-viewers":
            return AnyView(ChatScreensAsync(load: { api in
                try await api.fetchChatStories().value.mine?.stories.last?.id
            }) { storyId in
                ChatStoryViewersSheet(storyId: storyId)
            })
        default: return nil
        }
    }
}

/// Hands a screen who is signed in: the manager or not, and the key stories use.
private struct ChatScreensSide<Content: View>: View {
    @EnvironmentObject private var api: APIClient
    @ViewBuilder let content: (Bool, String) -> Content

    var body: some View {
        let isManager = api.identity?.side == .admin
        content(isManager, isManager ? "admin" : (api.identity?.id ?? ""))
    }
}

/// `DebugAsync`, with the signed-in client handed to the loader.
private struct ChatScreensAsync<Value, Content: View>: View {
    let load: @MainActor (APIClient) async throws -> Value?
    @ViewBuilder let content: (Value) -> Content

    @EnvironmentObject private var api: APIClient

    var body: some View {
        DebugAsync(load: { @MainActor in try await load(api) }, content: content)
    }
}
#endif
