import Foundation

// Shared readings of what the server sends: its dates, its URLs, and the
// studio's names for task states. Used by every feature area.

let portalOrigin = URL(string: "https://clients.neonjo.com")!

// The API returns some file/image paths as web-relative (e.g. "/seed-images/…"),
// which URL(string:) alone can't load — resolve those against the portal origin.
//
// Stored files live on R2, at a public `*.r2.dev` address some networks cannot
// reach at all (the photos simply never load). Those are fetched through the
// platform's own `/api/media` instead, which reads the same file from storage.
func resolvedMediaURL(_ raw: String?) -> URL? {
    guard let raw, !raw.isEmpty else { return nil }
    if let direct = URL(string: raw), let host = direct.host, host.hasSuffix(".r2.dev") {
        var components = URLComponents(url: portalOrigin.appendingPathComponent("api/media"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "u", value: raw)]
        return components?.url ?? direct
    }
    return URL(string: raw, relativeTo: portalOrigin)
}

let projectStages = [
    "CONCEPT", "DESIGN", "VISUALIZATION", "TECHNICAL_DRAWINGS",
    "BOQ", "PRICING", "APPROVAL", "HANDOVER",
]

func formattedISODate(_ iso: String?) -> String? {
    guard let iso else { return nil }
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return nil }
    // Follows the in-app language, not the phone's, so the toggle covers dates too.
    return date.formatted(
        Date.FormatStyle(date: .abbreviated, time: .shortened, locale: AppLanguage.current.locale)
    )
}

// MARK: - Task states, as the studio names them

/// `EMPLOYEE_STATE_LABEL` in src/lib/task-board.ts.
func taskStateLabel(_ state: String) -> String {
    switch state {
    case "TODO": return L("Pending")
    case "IN_PROGRESS": return L("In progress")
    case "SUBMITTED": return L("Sent for review")
    case "DONE": return L("Completed")
    case "TOMORROW": return L("Planned for tomorrow")
    default: return state.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

func taskStateTone(_ state: String) -> BadgeTone {
    switch state {
    case "IN_PROGRESS": return .cyan
    case "SUBMITTED": return .purple
    case "DONE": return .success
    case "TOMORROW": return .orange
    default: return .neutral
    }
}

func priorityLabel(_ priority: String?) -> String? {
    switch priority {
    case "HIGH": return L("High priority")
    case "LOW": return L("Low priority")
    default: return nil
    }
}

// MARK: - Dates from the server

private let isoWithFraction: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

private let isoPlain = ISO8601DateFormatter()

func parseISODate(_ iso: String?) -> Date? {
    guard let iso else { return nil }
    return isoWithFraction.date(from: iso) ?? isoPlain.date(from: iso)
}

/// A `@db.Date` column arrives as UTC midnight of the studio's day, so it is
/// read and shown in UTC — in Amman's evening it would otherwise slip a day.
func formattedDay(_ iso: String?) -> String? {
    guard let date = parseISODate(iso) else { return nil }
    var style = Date.FormatStyle(date: .abbreviated, time: .omitted, locale: AppLanguage.current.locale)
    style.timeZone = TimeZone(identifier: "UTC")!
    return date.formatted(style)
}

/// "YYYY-MM-DD", the studio's day key.
func formattedDayKey(_ key: String) -> String {
    formattedDay("\(key)T00:00:00.000Z") ?? key
}

/// Minutes as the web says them: "45m", "2h", "2h 15m".
func describeMinutes(_ minutes: Double) -> String {
    let total = Int(minutes.rounded())
    if total <= 0 { return L("no time left") }
    let hours = total / 60
    let rest = total % 60
    if hours == 0 { return L("%dm", rest) }
    return rest == 0 ? L("%dh", hours) : L("%dh %dm", hours, rest)
}

/// Relative for recent moments, a date after that — for lists.
func shortTime(_ iso: String?) -> String? {
    guard let date = parseISODate(iso) else { return nil }
    let locale = AppLanguage.current.locale
    if Calendar.current.isDateInToday(date) {
        return date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: locale))
    }
    if Calendar.current.isDateInYesterday(date) { return L("Yesterday") }
    return date.formatted(Date.FormatStyle(date: .numeric, time: .omitted, locale: locale))
}
