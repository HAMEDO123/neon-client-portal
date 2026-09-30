#if DEBUG
import SwiftUI

/// The chat room and what opens from it, for the debug router
/// (App/DebugScreens.swift): `-neonScreen <id>` opens one straight from
/// launch, for screenshots. Add every screen and sheet of the room here.
///
/// - chat-room-team: the team's conversation (`-neonScroll top` for its oldest loaded messages)
/// - chat-room-direct: the first private chat in the list
/// - chat-room-group: the first group the manager made
/// - chat-room-search: the team's conversation with the search box open
/// - chat-room-cards: the newest real task and meeting cards, drawn as the room draws them
/// - chat-meetings: every meeting card (`-neonScroll coming-up`, `earlier`)
/// - chat-task-compose, chat-meeting-compose, chat-assistant: the room's sheets, as screens
enum ChatRoomScreens {
    static let ids: [String] = [
        "chat-room-team", "chat-room-direct", "chat-room-group", "chat-room-search", "chat-room-cards",
        "chat-meetings", "chat-task-compose", "chat-meeting-compose", "chat-assistant",
    ]

    private static let team = ChatRoute(slug: "team", title: "NEON Team", subtitle: nil, avatar: nil, isGroup: true)

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "chat-room-team":
            return debugPushed(ChatRoomView(route: team))
        case "chat-room-search":
            return debugPushed(ChatRoomView(route: team, startsSearching: true))
        case "chat-room-direct":
            return debugPushed(ChatRoomDebugLoad(missing: L("No private chat on the server to open")) {
                try await firstConversation { !$0.isGroup }
            })
        case "chat-room-group":
            return debugPushed(ChatRoomDebugLoad(missing: L("No group on the server to open")) {
                try await firstConversation { $0.isCustomGroup }
            })
        case "chat-room-cards":
            return debugPushed(ChatRoomCardsPreview())
        case "chat-meetings":
            return debugPushed(MeetingsView())
        case "chat-task-compose":
            return AnyView(ChatTaskComposeSheet(conversationSlug: "team"))
        case "chat-meeting-compose":
            return AnyView(ChatMeetingComposeSheet(conversationSlug: "team"))
        case "chat-assistant":
            return AnyView(ChatAssistantSheet())
        default:
            return nil
        }
    }

    @MainActor private static func firstConversation(_ matching: (ConversationSummary) -> Bool) async throws -> ConversationSummary? {
        try await APIClient.shared.fetchConversations().value.conversations.first(where: matching)
    }
}

/// A conversation that has to be found on the server first. When there is
/// none (or the read fails), it says so on the app's own page with a warning
/// tile — so a missing fixture is plain in a screenshot and never passes for
/// one of the app's screens.
private struct ChatRoomDebugLoad: View {
    let missing: String
    let load: @MainActor () async throws -> ConversationSummary?

    @State private var found: ConversationSummary?
    @State private var failure: String?

    var body: some View {
        Group {
            if let found {
                ChatRoomView(route: ChatRoute(found))
            } else if let failure {
                NeonScroll {
                    EmptyState(symbol: "exclamationmark.triangle", title: missing, detail: failure, hue: .orange, card: true)
                        .padding(.top, 80)
                }
            } else {
                NeonScroll { ChatRoomSkeleton() }
            }
        }
        .task {
            do {
                if let conversation = try await load() {
                    found = conversation
                } else {
                    failure = L("Nothing on the server to open this with.")
                }
            } catch {
                failure = error.localizedDescription
            }
        }
    }
}

/// The newest real task and meeting cards from any conversation, each drawn
/// exactly as the room draws it, on the room's wallpaper — so the cards can be
/// looked at without scrolling a conversation to find one. Read only.
private struct ChatRoomCardsPreview: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var cards = ChatCardsLoader()

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                if !cards.loaded {
                    ChatRoomSkeleton()
                } else if cards.tasks.isEmpty && cards.meetings.isEmpty {
                    EmptyState(symbol: "tray", title: L("No messages yet"), card: true)
                }
                ForEach(Array(cards.tasks.prefix(3)) + Array(cards.meetings.prefix(3))) { item in
                    let mine = item.message.isMine(api.identity)
                    ChatMessageRow(
                        message: item.message,
                        mine: mine,
                        showAuthor: item.conversation.isGroup && !mine,
                        tail: true,
                        delivery: mine ? .sent : nil,
                        viewerIdentity: api.identity,
                        tallies: [],
                        isPinned: false,
                        callSlug: item.conversation.slug,
                        inGroup: item.conversation.isGroup,
                        openImage: {},
                        sendProof: { _, _ in },
                        onReact: { _ in },
                        onPin: { _ in },
                        onDelete: nil,
                        onCardChanged: {}
                    )
                }
            }
            .padding(12)
        }
        .background { ChatRoomWallpaper().ignoresSafeArea() }
        .navigationTitle(L("Chat"))
        .navigationBarTitleDisplayMode(.inline)
        .chatRoomPalette()
        .task { await cards.load(api) }
    }
}
#endif
