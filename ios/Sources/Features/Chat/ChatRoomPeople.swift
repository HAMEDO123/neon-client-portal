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

/// The studio's own colour for each person the viewer can talk to — and
/// their face, from the same read.
///
/// A message, a comment, a meeting's attendee and a read marker each carry a
/// key (and a copied name), never a picture: a face is a current fact about a
/// person, so it is looked up here once for the room — the phone's
/// `FacesProvider` — rather than copied onto every row.
struct ChatRoomPalette: Equatable {
    private var byKey: [String: String] = [:]
    private var byName: [String: String] = [:]
    private var photoByKey: [String: URL] = [:]
    private var photoByName: [String: URL] = [:]

    init() {
        // The manager is "ink" everywhere the platform draws them
        // (chat-group-store.ts's chatPeople, avatarUrl("Manager", "ink")).
        byKey["admin"] = "ink"
        // The server writes the manager as "Manager" (chat.ts's viewer name).
        byName["Manager"] = "ink"
        byName[L("Manager")] = "ink"
    }

    /// `me` is the viewer themselves — "admin" or their employee id, and
    /// their own face — whom `chat/people` leaves out, but who is on meeting
    /// cards and task cards like anybody else.
    init(people: [ChatPerson], me: (key: String, photo: URL?)? = nil) {
        self.init()
        for person in people {
            // An employee sees the manager as "manager"; messages and read
            // markers call them "admin".
            let key = person.id == "manager" ? "admin" : person.id
            // `avatar` is their photo, or the server's initials picture —
            // which `facePhotoURL` reads as "no photo".
            if let photo = facePhotoURL(person.avatar) {
                photoByKey[key] = photo
                photoByName[person.name] = photo
            }
            guard let color = person.color, !color.isEmpty else { continue }
            byKey[key] = color
            byName[person.name] = color
        }
        if let me, let photo = me.photo { photoByKey[me.key] = photo }
    }

    /// The colour the studio gave this person: by who they are first, then —
    /// for a pinned message, which carries only a name — by their name.
    func color(key: String?, name: String?) -> String? {
        if let key, let color = byKey[key] { return color }
        if let name, let color = byName[name] { return color }
        return nil
    }

    /// Their face, or nil for their initials: by who they are, and — only
    /// when there is no key at all, as on a pinned message — by name. A
    /// wrong colour is a small thing; somebody else's face is not, so a key
    /// that is known and has no photo never falls back to a name.
    func photo(key: String?, name: String? = nil) -> URL? {
        if let key { return photoByKey[key] }
        if let name { return photoByName[name] }
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

/// Reads everybody's colour and face once and hands them to everything
/// inside — again when somebody's face changes, and with the viewer's own
/// face as it stands (`APIClient.myPhoto`).
private struct ChatRoomPaletteLoader: ViewModifier {
    @EnvironmentObject private var api: APIClient
    @State private var people: [ChatPerson] = []

    func body(content: Content) -> some View {
        content
            .environment(\.chatRoomPalette, ChatRoomPalette(people: people, me: me))
            .task { await load() }
            .onReceive(NotificationCenter.default.publisher(for: .neonDataChanged)) { note in
                guard isFaceChange(note.object as? String) else { return }
                Task { await load() }
            }
    }

    private var me: (key: String, photo: URL?)? {
        guard let identity = api.identity else { return nil }
        let key = identity.side == .admin ? "admin" : identity.id
        return key.map { ($0, facePhotoURL(api.myPhoto)) }
    }

    private func load() async {
        // A failed read leaves each name on the colour ChatTint picks for it
        // — the list's own fallback, so the two still agree — and each face
        // on its initials.
        if let loaded = try? await api.fetchChatPeople() {
            people = loaded
        }
    }
}

extension View {
    /// Draws the people inside on the colours the studio gave them.
    func chatRoomPalette() -> some View {
        modifier(ChatRoomPaletteLoader())
    }
}
