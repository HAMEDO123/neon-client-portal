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
/// The "You:" label is wrapped around the message body with Unicode
/// directional isolates (U+2068/U+2069), so an Arabic body inside the
/// English (or vice versa) label keeps its own direction without dragging
/// the label's colon and the row's own layout along with it — the bidi
/// algorithm treats everything between the isolates as one self-contained
/// run instead of reading the whole formatted string as one direction.
func whatsAppPreview(_ last: WhatsAppChat.LastMessage?) -> String {
    guard let last else { return L("No messages yet") }
    let body = last.body.trimmingCharacters(in: .whitespacesAndNewlines)
    let text = body.isEmpty ? whatsAppKindLabel(last.type) : body
    guard last.fromMe else { return text }
    return L("You: %@", "\u{2068}\(text)\u{2069}")
}

/// The web's `whenShort`: the clock for today, the date before that, read in
/// the studio's own timezone so a manager on a laptop set to somewhere else
/// sees the same times as the phone. Mirrors `ListCardRow`'s own times in
/// Chat: today's clock, "Yesterday", the weekday within the last week, else
/// a month and day with no year unless the year itself has turned over.
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
    if calendar.isDateInYesterday(date) { return L("Yesterday") }
    if let days = calendar.dateComponents([.day], from: date, to: Date()).day, days < 7, days >= 0 {
        var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: locale, timeZone: zone)
        style = style.weekday(.wide)
        return date.formatted(style)
    }
    let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: Date())
    var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: locale, timeZone: zone).month(.abbreviated).day()
    if !sameYear { style = style.year() }
    return date.formatted(style)
}

/// A bubble's own time, always the clock — never the date. Days are told
/// apart by the day pill between runs of messages, not by repeating the
/// date on every bubble.
func whatsAppBubbleClockLabel(_ ms: Double?, timeZone: String) -> String {
    guard let ms, ms > 0 else { return "" }
    let date = Date(timeIntervalSince1970: ms / 1000)
    let zone = TimeZone(identifier: timeZone) ?? .current
    let locale = AppLanguage.current.locale
    return date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: locale, timeZone: zone))
}

/// A stable key for the calendar day a message falls on, in the studio's own
/// timezone — for grouping bubbles under one day pill.
func whatsAppDayKey(_ ms: Double?, timeZone: String) -> String {
    guard let ms, ms > 0 else { return "" }
    let date = Date(timeIntervalSince1970: ms / 1000)
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: timeZone) ?? .current
    let comps = calendar.dateComponents([.year, .month, .day], from: date)
    return "\(comps.year ?? 0)-\(comps.month ?? 0)-\(comps.day ?? 0)"
}

/// The day pill's own words: "Today", "Yesterday", else a full date — never
/// a bare clock, since this is the one place a whole day is named at once.
func whatsAppDayPillLabel(_ ms: Double?, timeZone: String) -> String {
    guard let ms, ms > 0 else { return "" }
    let date = Date(timeIntervalSince1970: ms / 1000)
    let zone = TimeZone(identifier: timeZone) ?? .current
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    if calendar.isDateInToday(date) { return L("Today") }
    if calendar.isDateInYesterday(date) { return L("Yesterday") }
    let locale = AppLanguage.current.locale
    return date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: locale, timeZone: zone))
}

/// Whether a chat's own name is really a phone number wearing a name's hat —
/// what `AvatarView.initials` sees as "+" and "7" and draws as a broken
/// "+7" avatar. True when there isn't a single letter in it.
func whatsAppNameLooksLikePhoneNumber(_ name: String) -> Bool {
    !name.unicodeScalars.contains { $0.properties.isAlphabetic }
}

/// A group message's author, in place of the raw WhatsApp id
/// (`117832578793490`, a LID — not a phone number, and never a name) that
/// `whatsapp/messages` hands back today. The worker would need to resolve a
/// pushname or a saved contact per author to do better than this; until it
/// does, every member reads as one anonymous label, distinguished only by
/// the stable colour `NeonPalette.color(for:)` gives their own author id.
func whatsAppGroupAuthorLabel(_ author: String?) -> String {
    L("Group member")
}

/// "+962775880677" → "+962 7 7588 0677", the way the inbox already shows a
/// contact's own number. Jordanian mobile numbers are the one shape this
/// studio's numbers take (country code 962 + a 9-digit local number); a
/// digit string with no country code, or the wrong length, is returned with
/// just a leading "+" rather than guessed at.
func formattedWhatsAppNumber(_ raw: String) -> String {
    let digits = raw.filter(\.isNumber)
    guard digits.hasPrefix("962"), digits.count == 12 else {
        return digits.isEmpty ? raw : "+\(digits)"
    }
    let rest = digits.dropFirst(3)
    let first = rest.prefix(1)
    let mid = rest.dropFirst(1).prefix(4)
    let last = rest.dropFirst(5)
    return "+962 \(first) \(mid) \(last)"
}
