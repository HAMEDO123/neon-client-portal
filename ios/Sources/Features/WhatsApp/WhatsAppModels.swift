import Foundation

// Decodes exactly what src/lib/mobile/registry/whatsapp.ts returns — see
// src/lib/mobile/whatsapp-inbox.ts for the server-side shapes these mirror
// field for field. Timestamps are epoch milliseconds (plain numbers), not ISO
// strings: they come straight off the WhatsApp session, not the database.
//
// Readings shared by the inbox and the thread (what a wordless message was,
// a chat row's preview, a time in the studio's own timezone) live in
// WhatsAppHelpers.swift, so this file stays only what the server answers.

struct WhatsAppChat: Decodable, Identifiable {
    let id: String
    let name: String?
    let number: String?
    let isGroup: Bool
    let unreadCount: Int
    let archived: Bool
    let pinned: Bool
    let timestamp: Double?
    let lastMessage: LastMessage?

    struct LastMessage: Decodable {
        let body: String
        let fromMe: Bool
        let type: String
        let hasMedia: Bool
        let timestamp: Double?
    }

    /// The name a person recognizes, falling back the way the web's row does.
    var displayName: String {
        if let name, !name.isEmpty { return name }
        if let number, !number.isEmpty { return number }
        return L("Unknown")
    }
}

/// `whatsapp/inbox`.
struct WhatsAppInboxResponse: Decodable {
    let chats: [WhatsAppChat]
    /// Set when the chats could not be read — the worker's own sentence, not
    /// an empty list, which would read as "no messages".
    let error: String?
    let notLinked: Bool
    let line: LineSummary?
    let timeZone: String
    /// Whether this person may open Settings and link or unlink the number —
    /// the manager, never a ticked employee.
    let canManageLine: Bool
    let limit: Int

    struct LineSummary: Decodable {
        let status: String
        let phoneNumber: String?
    }
}

struct WhatsAppMessage: Decodable {
    let id: String?
    let body: String
    let fromMe: Bool
    let author: String?
    let type: String
    let hasMedia: Bool
    let timestamp: Double?
}

/// `whatsapp/messages`.
struct WhatsAppThreadResponse: Decodable {
    let chat: ChatInfo
    let messages: [WhatsAppMessage]
    let limit: Int

    struct ChatInfo: Decodable {
        let id: String?
        let name: String?
        let isGroup: Bool
    }
}

/// `whatsapp/send`'s result.
struct WhatsAppQueued: Decodable { let queued: Bool }

/// `whatsapp/unlink` and `whatsapp/test`'s result — and this app's own
/// fallback when the request never reached the server at all.
struct WhatsAppOutcome: Decodable {
    let ok: Bool
    let message: String
}

/// `whatsapp/line` — the manager's transport and connection detail, the way
/// Settings' "Sending" card reads it.
struct WhatsAppLineResponse: Decodable {
    let transport: String
    let workerConfigured: Bool
    let workerUrl: String?
    let lineId: String?
    let cloudPhoneNumberId: String?
    let connection: Connection?
    let link: WhatsAppLinkState?

    struct Connection: Decodable {
        let transport: String
        let ok: Bool
        let detail: String
        let number: String?
    }
}

/// `whatsapp/link` and `whatsapp/link-status` — the linking panel's state,
/// polled while a code is on screen.
struct WhatsAppLinkState: Decodable {
    let status: String
    let qrDataUrl: String?
    let pairingCode: String?
    let phoneNumber: String?
    let error: String?
}
