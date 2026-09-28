import Foundation

// Small pure readings shared by the inbox and the thread — kept here so
// WhatsAppModels.swift stays only what the server answers.

/// `describeType(type)` on the web (whatsapp-inbox.tsx): what a message
/// without words actually is, in the reader's terms.
func whatsAppKindLabel(_ type: String) -> String {
    switch type {
    case "image": return L("Photo")
    case "video": return L("Video")
    case "audio": return L("Audio")
    case "ptt": return L("Voice note")
    case "document": return L("Document")
    case "sticker": return L("Sticker")
    case "location": return L("Location")
    case "vcard", "multi_vcard": return L("Contact card")
    case "revoked": return L("Message deleted")
    case "e2e_notification": return L("Encryption notice")
    case "notification_template": return L("Notice")
    case "call_log": return L("Call")
    default: return L("Attachment")
    }
}

func whatsAppSymbol(for type: String) -> String {
    switch type {
    case "video": return "video.fill"
    case "audio", "ptt": return "waveform.circle.fill"
    case "image", "sticker": return "photo.fill"
    case "location": return "mappin.circle.fill"
    default: return "doc.fill"
    }
}

/// The web's `preview(last)`: what a chat row shows for its last message.
func whatsAppPreview(_ last: WhatsAppChat.LastMessage?) -> String {
    guard let last else { return L("No messages yet") }
    let body = last.body.trimmingCharacters(in: .whitespacesAndNewlines)
    let text = body.isEmpty ? whatsAppKindLabel(last.type) : body
    return last.fromMe ? L("You: %@", text) : text
}

/// The web's `whenShort`: the clock for today, the date before that, read in
/// the studio's own timezone so a manager on a laptop set to somewhere else
/// sees the same times as the phone.
func whatsAppTimeLabel(_ ms: Double?, timeZone: String) -> String {
    guard let ms, ms > 0 else { return "" }
    let date = Date(timeIntervalSince1970: ms / 1000)
    let zone = TimeZone(identifier: timeZone) ?? .current
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    let locale = AppLanguage.current.locale
    if calendar.isDateInToday(date) {
        return date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: locale, timeZone: zone))
    }
    return date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: locale, timeZone: zone))
}
