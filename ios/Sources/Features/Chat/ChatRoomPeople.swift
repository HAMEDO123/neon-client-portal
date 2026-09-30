import SwiftUI

// Whose colour is whose, in a conversation. The chat list draws everybody on
// the colour the studio gave them (Employee.color, sent as `color` or inside
// their `/api/avatar?…&color=` face) through ChatTint, falling back to their
// name only when there is none; the room used to hash whatever name string it
// was handed through a different palette, so the same person changed colour
// between the list and the room. Here the room reads the same colours from
// `chat/people`, keyed by who the person is (the employee id, "admin" for the
// manager), and draws them through the same ChatTint and ChatAvatar the list
// uses — so Sally is the same purple in both.

/// The studio's own colour for each person the viewer can talk to.
struct ChatRoomPalette: Equatable {
    private var byKey: [String: String] = [:]
    private var byName: [String: String] = [:]

    init() {
        // The manager is "ink" everywhere the platform draws them
        // (chat-group-store.ts's chatPeople, avatarUrl("Manager", "ink")).
        byKey["admin"] = "ink"
        // The server writes the manager as "Manager" (chat.ts's viewer name).
        byName["Manager"] = "ink"
        byName[L("Manager")] = "ink"
    }

    init(people: [ChatPerson]) {
        self.init()
        for person in people {
            guard let color = person.color, !color.isEmpty else { continue }
            // An employee sees the manager as "manager"; messages and read
            // markers call them "admin".
            let key = person.id == "manager" ? "admin" : person.id
            byKey[key] = color
            byName[person.name] = color
        }
    }

    /// The colour the studio gave this person: by who they are first, then —
    /// for a pinned message, which carries only a name — by their name.
    func color(key: String?, name: String?) -> String? {
        if let key, let color = byKey[key] { return color }
        if let name, let color = byName[name] { return color }
        return nil
    }

    /// Their colour family, or nil for the manager's ink.
    func hue(key: String?, name: String) -> NeonHue? {
        ChatTint.hue(name: name, color: color(key: key, name: name))
    }

    /// The colour a person's name is written in over their messages.
    func nameColor(key: String?, name: String) -> Color {
        hue(key: key, name: name)?.deep ?? .neonInk
    }
}

private struct ChatRoomPaletteKey: EnvironmentKey {
    static let defaultValue = ChatRoomPalette()
}

extension EnvironmentValues {
    var chatRoomPalette: ChatRoomPalette {
        get { self[ChatRoomPaletteKey.self] }
        set { self[ChatRoomPaletteKey.self] = newValue }
    }
}

/// Who wrote a message, as the palette and read markers name people:
/// "admin" for the manager, the employee id otherwise, nil for the assistant.
func chatAuthorKey(authorType: String, authorId: String?) -> String? {
    switch authorType {
    case "ADMIN": return "admin"
    case "EMPLOYEE": return authorId
    default: return nil
    }
}

extension ChatMessage {
    var authorKey: String? { chatAuthorKey(authorType: authorType, authorId: authorId) }
}

/// Reads everybody's colour once and hands it to everything inside.
private struct ChatRoomPaletteLoader: ViewModifier {
    @EnvironmentObject private var api: APIClient
    @State private var palette = ChatRoomPalette()

    func body(content: Content) -> some View {
        content
            .environment(\.chatRoomPalette, palette)
            .task {
                // A failed read leaves each name on the colour ChatTint picks
                // for it — the list's own fallback, so the two still agree.
                if let people = try? await api.fetchChatPeople() {
                    palette = ChatRoomPalette(people: people)
                }
            }
    }
}

extension View {
    /// Draws the people inside on the colours the studio gave them.
    func chatRoomPalette() -> some View {
        modifier(ChatRoomPaletteLoader())
    }
}
