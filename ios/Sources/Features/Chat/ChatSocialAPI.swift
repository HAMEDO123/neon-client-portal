import Foundation

// The conversation list's newer half of the contract: per-person settings
// (pin, mute, favourite), the manager's groups, the studio's 24-hour stories
// and the presence heartbeat. Registry entries in src/lib/mobile/registry/chat.ts;
// the heartbeat is its own route, /api/mobile/presence.

extension APIClient {
    // MARK: - Per-person settings

    /// Only the fields given change. Answers the conversation's settings as
    /// they now stand for this person.
    func setChatPrefs(slug: String, pinned: Bool? = nil, muted: Bool? = nil, favorite: Bool? = nil) async throws -> ChatPrefs? {
        var change: [String: Any] = [:]
        if let pinned { change["pinned"] = pinned }
        if let muted { change["muted"] = muted }
        if let favorite { change["favorite"] = favorite }
        return try await perform("chat/prefs", args: [slug, change]).result(ChatPrefs.self)
    }

    // MARK: - People and groups

    func fetchChatPeople() async throws -> [ChatPerson] {
        struct Wrapper: Decodable { let people: [ChatPerson] }
        return try await read("chat/people", as: Wrapper.self).value.people
    }

    func fetchChatGroup(slug: String) async throws -> Loaded<ChatGroupDetail> {
        try await read("chat/groups/detail", ["slug": slug], as: ChatGroupDetail.self)
    }

    struct CreatedGroup: Decodable { let slug: String; let groupId: String }

    /// A photo forces multipart, whose fields are one string each — so the
    /// members travel comma-joined, which the contract accepts.
    func createChatGroup(name: String, members: [String], photo: UploadFile?) async throws -> CreatedGroup? {
        let outcome: ActionOutcome
        if let photo {
            outcome = try await performUpload(
                "chat/groups/create",
                fields: ["name": name, "member": members.joined(separator: ",")],
                files: [UploadFile(field: "photo", filename: photo.filename, mimeType: photo.mimeType, data: photo.data)]
            )
        } else {
            outcome = try await perform("chat/groups/create", form: ["name": name, "member": members])
        }
        return try outcome.result(CreatedGroup.self)
    }

    @discardableResult
    func updateChatGroup(id: String, name: String? = nil, photo: UploadFile? = nil) async throws -> ActionOutcome {
        var fields: [String: String] = [:]
        if let name { fields["name"] = name }
        if let photo {
            return try await performUpload(
                "chat/groups/update",
                args: [id],
                fields: fields,
                files: [UploadFile(field: "photo", filename: photo.filename, mimeType: photo.mimeType, data: photo.data)]
            )
        }
        return try await perform("chat/groups/update", args: [id], form: fields)
    }

    @discardableResult
    func setChatGroupMembers(id: String, add: [String] = [], remove: [String] = []) async throws -> ActionOutcome {
        var change: [String: Any] = [:]
        if !add.isEmpty { change["add"] = add }
        if !remove.isEmpty { change["remove"] = remove }
        return try await perform("chat/groups/members", args: [id, change])
    }

    @discardableResult
    func deleteChatGroup(id: String) async throws -> ActionOutcome {
        try await perform("chat/groups/delete", args: [id])
    }

    // MARK: - Stories

    func fetchChatStories() async throws -> Loaded<ChatStoriesResponse> {
        try await read("chat/stories", as: ChatStoriesResponse.self)
    }

    /// `media` is an image or an mp4, sent under the field name "media".
    @discardableResult
    func postChatStory(media: UploadFile, caption: String) async throws -> ActionOutcome {
        let trimmed = caption.trimmingCharacters(in: .whitespacesAndNewlines)
        return try await performUpload(
            "chat/stories/post",
            fields: trimmed.isEmpty ? [:] : ["caption": trimmed],
            files: [UploadFile(field: "media", filename: media.filename, mimeType: media.mimeType, data: media.data)]
        )
    }

    /// Idempotent on the server, so a second call for the same story is harmless.
    func markChatStoryViewed(id: String) async {
        _ = try? await perform("chat/stories/view", args: [id])
    }

    @discardableResult
    func deleteChatStory(id: String) async throws -> ActionOutcome {
        try await perform("chat/stories/delete", args: [id])
    }

    func fetchChatStoryViewers(storyId: String) async throws -> [ChatStoryViewer] {
        struct Wrapper: Decodable { let viewers: [ChatStoryViewer] }
        return try await read("chat/stories/viewers", ["storyId": storyId], as: Wrapper.self).value.viewers
    }

    // MARK: - Presence

    /// The same heartbeat the website's /api/live writes, so this phone shows
    /// as online on the web and the web as online here.
    func sendChatPresence() async {
        _ = try? await sendJSON("POST", "presence", [:])
    }
}
