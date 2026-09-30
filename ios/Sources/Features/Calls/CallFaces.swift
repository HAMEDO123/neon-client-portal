import SwiftUI

// Faces on a call are the chat's faces: the colour the studio gave each
// person (the server's `color` — "purple", "cyan", "ink" for the manager), a
// group's photo, the studio's own mark for the team. They used to be a hash
// of the name, so Sally was purple in the chat list and pink the moment she
// rang. Everything here draws through the chat's own ChatAvatar,
// ChatStudioMark and ChatTint, so the two can never drift apart again.

/// Whose face stands for somebody, or for a whole call.
struct CallFace: Equatable {
    enum Kind: Equatable { case person, group, team }

    var name: String
    /// The server's colour name, or nil when it sent none.
    var color: String?
    /// A real photo, or the server's `/api/avatar?…` face (which carries the
    /// colour in its query) — read the way the chat reads it.
    var url: URL?
    var kind: Kind = .person

    static func person(_ name: String, color: String?, photo: URL? = nil) -> CallFace {
        CallFace(name: name, color: color, url: photo, kind: .person)
    }

    /// The colour family a call's stage glows in: the person's own; nil for
    /// the studio's team and for the manager's ink, whose stage is the
    /// brand's.
    var hue: NeonHue? {
        switch kind {
        case .team: return nil
        case .group: return ChatTint.hue(name: name, color: color)
        case .person: return ChatTint.hue(name: name, color: ChatFace(url: url, color: color).color)
        }
    }
}

/// A face, drawn exactly as the conversation list draws it.
struct CallFaceView: View {
    let face: CallFace
    var size: CGFloat

    var body: some View {
        switch face.kind {
        case .team:
            ChatStudioMark(size: size)
        case .group:
            ChatAvatar(url: ChatFace.isStudioIcon(face.url) ? nil : face.url, name: face.name, size: size, color: face.color, isGroup: true)
        case .person:
            ChatAvatar(url: face.url, name: face.name, size: size, color: face.color)
        }
    }
}

/// A few faces overlapping, each in its own colour with a dark edge so two
/// people with the same initial can be told apart on the dark stage.
struct CallFaceStack: View {
    let faces: [CallFace]
    var size: CGFloat = 28
    var limit = 4

    var body: some View {
        HStack(spacing: -size * 0.32) {
            ForEach(Array(faces.prefix(limit).enumerated()), id: \.offset) { index, face in
                CallFaceView(face: face, size: size)
                    .overlay(Circle().strokeBorder(Color.neonInk.opacity(0.85), lineWidth: 1.5))
                    .zIndex(Double(limit - index))
            }
            if faces.count > limit {
                Text(verbatim: "+" + NeonFormat.integer(faces.count - limit))
                    .font(.system(size: size * 0.36, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: size, height: size)
                    .background(Circle().fill(Color.neonInk))
                    .overlay(Circle().strokeBorder(Color.white.opacity(0.3), lineWidth: 1.5))
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: faces.map(\.name).joined(separator: AppLanguage.current == .arabic ? "، " : ", ")))
    }
}

// MARK: - Where the faces come from

/// The faces of the conversations calls are made in, read from the same list
/// the chat draws its own faces from (`chat/conversations`).
///
/// People in a call carry their colour on the call itself; this covers what
/// a call does not say: the colour of the person about to be rung on the
/// pre-join screen, before any call exists, and a group's photo.
@MainActor
final class CallFaceDirectory: ObservableObject {
    static let shared = CallFaceDirectory()

    struct Entry: Equatable {
        let url: URL?
        let isGroup: Bool
    }

    @Published private(set) var entries: [String: Entry] = [:]
    private var loadedAt: Date?
    private var loading = false

    /// Reads the list again unless it was read in the last two minutes.
    func refresh() {
        #if DEBUG
        if APIClient.uiTestMode { return }
        #endif
        guard !loading, APIClient.shared.token != nil else { return }
        if let loadedAt, Date().timeIntervalSince(loadedAt) < 120 { return }
        loading = true
        Task { [weak self] in
            let answer = try? await APIClient.shared.fetchConversations()
            guard let self else { return }
            self.loading = false
            guard let answer else { return }
            var next: [String: Entry] = [:]
            for conversation in answer.value.conversations {
                next[conversation.slug] = Entry(url: conversation.avatarURL, isGroup: conversation.isGroup)
            }
            self.entries = next
            self.loadedAt = Date()
        }
    }

    /// The face of a conversation, by its slug.
    func face(slug: String, title: String) -> CallFace {
        if slug == "team" { return CallFace(name: title, kind: .team) }
        let entry = entries[slug]
        if entry?.isGroup == true || slug.hasPrefix("g-") {
            return CallFace(name: title, url: entry?.url, kind: .group)
        }
        return CallFace(name: title, url: entry?.url, kind: .person)
    }

    /// The face of a call: the studio's mark for the team, the group's for a
    /// group, and otherwise the other person in it, in the colour the call
    /// itself carries for them.
    func face(for call: CallView, me: String?) -> CallFace {
        if call.conversationSlug == "team" { return CallFace(name: call.title, kind: .team) }
        if call.isGroup { return face(slug: call.conversationSlug, title: call.title) }
        let others = call.participants.filter { $0.memberKey != me }
        let other = others.first { $0.memberKey == call.startedByKey } ?? others.first
        guard let other else { return face(slug: call.conversationSlug, title: call.title) }
        // A private call somebody else was rung into is named after all of
        // them; the face stays the one person's — their photo where they
        // have one.
        return .person(other.name, color: other.color, photo: other.photoURL)
    }
}
