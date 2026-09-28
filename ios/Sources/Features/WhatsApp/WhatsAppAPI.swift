import Foundation

// Talking to `whatsapp/*` in the registry (src/lib/mobile/registry/whatsapp.ts).
// An attachment's bytes are fetched separately, by hand, with the app's
// bearer token — see WhatsAppMediaImage.swift and WhatsAppAttachment.swift —
// since `read`/`perform` always speak JSON and a photo or a document isn't.

extension APIClient {
    func fetchWhatsAppInbox(limit: Int = 50) async throws -> Loaded<WhatsAppInboxResponse> {
        try await read("whatsapp/inbox", ["limit": String(limit)], as: WhatsAppInboxResponse.self)
    }

    func fetchWhatsAppThread(chatId: String, limit: Int = 50) async throws -> Loaded<WhatsAppThreadResponse> {
        try await read("whatsapp/messages", ["chatId": chatId, "limit": String(limit)], as: WhatsAppThreadResponse.self)
    }

    /// Answers in a conversation as the studio. Queued, not sent — the thread
    /// shows "Sending" until the account's own history hands the message back.
    @discardableResult
    func sendWhatsAppReply(chatId: String, text: String) async throws -> WhatsAppQueued? {
        try await perform("whatsapp/send", args: [chatId, text]).result(WhatsAppQueued.self)
    }

    /// Admin only (`requireAdmin`, mirrored by `whatsapp/line`).
    func fetchWhatsAppLine() async throws -> Loaded<WhatsAppLineResponse> {
        try await read("whatsapp/line", as: WhatsAppLineResponse.self)
    }

    func fetchWhatsAppLinkStatus() async throws -> WhatsAppLinkState {
        try await get("whatsapp/link-status", as: WhatsAppLinkState.self)
    }

    @discardableResult
    func startWhatsAppLink(phone: String) async throws -> WhatsAppLinkState? {
        var form: [String: Any] = [:]
        if !phone.isEmpty { form["phone"] = phone }
        return try await perform("whatsapp/link", form: form).result(WhatsAppLinkState.self)
    }

    @discardableResult
    func unlinkWhatsAppLine() async throws -> WhatsAppOutcome? {
        try await perform("whatsapp/unlink").result(WhatsAppOutcome.self)
    }

    @discardableResult
    func sendTestWhatsApp(phone: String, text: String) async throws -> WhatsAppOutcome? {
        try await perform("whatsapp/test", form: ["phone": phone, "text": text]).result(WhatsAppOutcome.self)
    }
}
