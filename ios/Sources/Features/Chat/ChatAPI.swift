import Foundation

// Everything chat needs from the server beyond the original handful of
// routes (fetchConversations, fetchMessages, sendMessage, sendAttachment,
// markConversationRead, in Core/APIClient.swift): the registry entries in
// src/lib/mobile/registry/chat.ts, and the voice-note upload, which — like
// sendAttachment — posts straight to the dedicated /chat/messages route
// rather than through the action registry.

extension APIClient {
    // MARK: - Tagging a message to a project
    //
    // `sendMessage`/`sendAttachment` in Core/APIClient.swift carry no
    // projectId — the composer's project picker is this area's, not Core's —
    // but the route they both already post to (api/mobile/chat/messages)
    // reads one on every path. These overloads add it from here rather than
    // touching Core, and fall through to the plain ones when there is none.

    func fetchChatProjects() async throws -> [ChatMessage.ProjectTag] {
        struct Wrapper: Decodable { let projects: [ChatMessage.ProjectTag] }
        return try await read("chat/projects", as: Wrapper.self).value.projects
    }

    @discardableResult
    func sendMessage(conversation: String, text: String, projectId: String?) async throws -> ChatMessage {
        guard let projectId, !projectId.isEmpty else { return try await sendMessage(conversation: conversation, text: text) }
        let data = try await post("chat/messages", json: ["conversation": conversation, "body": text, "projectId": projectId])
        return try JSONDecoder().decode(APIClient.SentMessage.self, from: data).message
    }

    @discardableResult
    func sendAttachment(conversation: String, text: String, file: UploadFile, projectId: String?) async throws -> ChatMessage {
        guard let projectId, !projectId.isEmpty else { return try await sendAttachment(conversation: conversation, text: text, file: file) }
        var fields = ["conversation": conversation, "projectId": projectId]
        if !text.isEmpty { fields["body"] = text }
        let data = try await postMultipart("chat/messages", fields: fields, files: [file])
        return try JSONDecoder().decode(APIClient.SentMessage.self, from: data).message
    }

    // MARK: - Voice notes

    /// A recording, exactly as the web chat box's own field name and duration
    /// are read by readChatAttachment: "voice" plus "durationSeconds".
    @discardableResult
    func sendVoice(conversation: String, file: UploadFile, durationSeconds: Int, projectId: String? = nil) async throws -> ChatMessage {
        var fields = ["conversation": conversation, "durationSeconds": String(durationSeconds)]
        if let projectId, !projectId.isEmpty { fields["projectId"] = projectId }
        let data = try await postMultipart("chat/messages", fields: fields, files: [file])
        return try JSONDecoder().decode(APIClient.SentMessage.self, from: data).message
    }

    // MARK: - Tasks and meetings lists

    func fetchChatTasks() async throws -> Loaded<[ChatTaskListItem]> {
        struct Wrapper: Decodable { let tasks: [ChatTaskListItem] }
        let loaded = try await read("chat/tasks", as: Wrapper.self)
        return Loaded(value: loaded.value.tasks, cachedAt: loaded.cachedAt)
    }

    func fetchChatMeetings() async throws -> Loaded<[ChatMeetingListItem]> {
        struct Wrapper: Decodable { let meetings: [ChatMeetingListItem] }
        let loaded = try await read("chat/meetings", as: Wrapper.self)
        return Loaded(value: loaded.value.meetings, cachedAt: loaded.cachedAt)
    }

    func fetchChatMembers(conversation: String) async throws -> ChatMembers {
        try await read("chat/members", ["conversation": conversation], as: ChatMembers.self).value
    }

    func fetchChatReactions(conversation: String) async throws -> ChatReactionSnapshot {
        try await read("chat/reactions", ["conversation": conversation], as: ChatReactionSnapshot.self).value
    }

    // MARK: - Reactions and pins

    @discardableResult
    func toggleChatReaction(messageId: String, emoji: String) async throws -> ActionOutcome {
        try await perform("chat/reactions/toggle", args: [messageId, emoji])
    }

    @discardableResult
    func setChatPinned(messageId: String, pin: Bool) async throws -> ActionOutcome {
        try await perform("chat/pins/set", args: [messageId, pin])
    }

    // MARK: - Typing

    /// A conversation's slug to say this person is writing in it, or `nil` to
    /// say they have stopped, wherever they were.
    func sendChatTyping(conversation: String?) async {
        let arg: Any = conversation.map { $0 as Any } ?? NSNull()
        _ = try? await perform("chat/typing", args: [arg])
    }

    // MARK: - Task cards

    /// `attachment` mirrors what the web task sheet offers: one optional file,
    /// posted under the same field name `createChatTask` (chat-task-actions.ts)
    /// reads with `formData.get("attachment")`. Carrying one forces multipart,
    /// whose fields are one string per key — so every assignee id travels
    /// joined by commas, and registry/chat.ts's `expandAssignees` splits it
    /// back out server-side before the website's own action ever sees it.
    @discardableResult
    func createChatTask(
        conversation: String,
        title: String,
        description: String,
        priority: String,
        assignees: [String],
        due: Date,
        attachment: UploadFile? = nil
    ) async throws -> ActionOutcome {
        if let attachment {
            let file = UploadFile(field: "attachment", filename: attachment.filename, mimeType: attachment.mimeType, data: attachment.data)
            return try await performUpload(
                "chat/tasks/create",
                fields: [
                    "conversation": conversation,
                    "title": title,
                    "description": description,
                    "priority": priority,
                    "assignee": assignees.joined(separator: ","),
                    "dueDay": NeonFormat.dayKey(due),
                    "dueTime": timeKey(due),
                ],
                files: [file]
            )
        }
        return try await perform("chat/tasks/create", form: [
            "conversation": conversation,
            "title": title,
            "description": description,
            "priority": priority,
            "assignee": assignees,
            "dueDay": NeonFormat.dayKey(due),
            "dueTime": timeKey(due),
        ])
    }

    @discardableResult
    func deleteChatTask(id: String) async throws -> ActionOutcome {
        try await perform("chat/tasks/delete", args: [id])
    }

    @discardableResult
    func addChatTaskComment(taskId: String, body: String) async throws -> ActionOutcome {
        try await perform("chat/tasks/comment", form: ["taskId": taskId, "body": body])
    }

    @discardableResult
    func approveChatSubmission(id: String, note: String) async throws -> ActionOutcome {
        var form: [String: Any] = [:]
        if !note.isEmpty { form["reviewNote"] = note }
        return try await perform("chat/tasks/approve", args: [id], form: form)
    }

    @discardableResult
    func rejectChatSubmission(id: String, note: String) async throws -> ActionOutcome {
        var form: [String: Any] = [:]
        if !note.isEmpty { form["reviewNote"] = note }
        return try await perform("chat/tasks/reject", args: [id], form: form)
    }

    // MARK: - Meeting cards

    func createChatMeeting(
        conversation: String,
        title: String,
        agenda: String,
        mode: String,
        place: String,
        attendees: [String],
        when: Date,
        durationMinutes: Int,
        remindMinutes: Int
    ) async throws -> ActionOutcome {
        try await perform("chat/meetings/create", form: [
            "conversation": conversation,
            "title": title,
            "agenda": agenda,
            "mode": mode,
            "place": place,
            "attendee": attendees,
            "day": NeonFormat.dayKey(when),
            "time": timeKey(when),
            "duration": String(durationMinutes),
            "remind": String(remindMinutes),
        ])
    }

    @discardableResult
    func cancelChatMeeting(id: String) async throws -> ActionOutcome {
        try await perform("chat/meetings/cancel", args: [id])
    }

    @discardableResult
    func setChatMeetingRsvp(meetingId: String, rsvp: String) async throws -> ActionOutcome {
        try await perform("chat/meetings/rsvp", form: ["meetingId": meetingId, "rsvp": rsvp])
    }

    // MARK: - The manager's assistant

    @discardableResult
    func askChatAssistant(question: String) async throws -> ActionOutcome {
        try await perform("chat/assistant/ask", form: ["question": question])
    }
}

/// Minutes since midnight as "HH:MM", the way lib/work-hours.ts's `timeOf` and
/// `minutesOf` read and write it — the device's own wall clock, which is the
/// studio's, since everyone plans a day from where they stand.
func timeKey(_ date: Date) -> String {
    let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
    return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
}
