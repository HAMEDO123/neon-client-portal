import SwiftUI

// What `ops/status` answers (src/lib/status.ts) and how the screen speaks
// about it. The server decides every state from a fact it saw; nothing here
// second-guesses one — the app only counts them, colours them and says them.

/// `StatusReport` in src/lib/status.ts.
struct StatusReport: Decodable, Equatable {
    let checkedAt: String
    let server: [StatusRow]
    let network: [StatusRow]

    var rows: [StatusRow] { server + network }
}

/// One thing the studio depends on: its state and the fact behind it.
struct StatusRow: Decodable, Identifiable, Equatable {
    let id: String
    /// A fixed English title from the server's `STATUS_TITLES`, translated here.
    let title: String
    let state: StatusState
    /// The server's own sentence, in English — the facts it read, as it read them.
    let detail: String
    /// The short figure on the trailing side: "3 ms", "4 min ago".
    let value: String?
}

enum StatusState: String, Decodable, Equatable {
    case up, degraded, down, unknown

    /// A state this build does not know yet reads as "unknown", never as a failure to load.
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = StatusState(rawValue: raw) ?? .unknown
    }

    /// The pill's word. Not "OK", "Down" or "Unknown": those keys already
    /// mean "Okay" (a button) and "move down" (Tasks) in the Arabic tables,
    /// and `L()` takes a key's first translation wherever it is.
    var label: String {
        switch self {
        case .up: return L("Healthy")
        case .degraded: return L("Warning")
        case .down: return L("Failing")
        case .unknown: return L("Can't tell")
        }
    }

    var tone: BadgeTone {
        switch self {
        case .up: return .success
        case .degraded: return .warning
        case .down: return .danger
        case .unknown: return .neutral
        }
    }

    var hue: NeonHue { tone.hue }

    /// A kit colour of the state's family, for the pieces that take a `Color`.
    var strong: Color {
        switch self {
        case .up: return .neonSuccessStrong
        case .degraded: return .neonWarningStrong
        case .down: return .neonDangerStrong
        case .unknown: return .neonTextSecondary
        }
    }
}

/// The hero's sentence, counted from the rows.
///
/// "Unknown" is not counted as needing attention: it is a check that could
/// not see (WhatsApp not set up, the backups folder not mounted), and calling
/// that a problem would teach the manager to ignore the hero. It is still
/// shown, as its own count, so nothing is hidden either.
struct StatusSummary: Equatable {
    let up: Int
    let degraded: Int
    let down: Int
    let unknown: Int

    init(_ rows: [StatusRow]) {
        up = rows.filter { $0.state == .up }.count
        degraded = rows.filter { $0.state == .degraded }.count
        down = rows.filter { $0.state == .down }.count
        unknown = rows.filter { $0.state == .unknown }.count
    }

    var attention: Int { degraded + down }

    var state: StatusState {
        if down > 0 { return .down }
        if degraded > 0 { return .degraded }
        return up > 0 ? .up : .unknown
    }

    var title: String {
        switch attention {
        case 0: return up > 0 ? L("Everything is running") : L("Nothing could be checked")
        case 1: return L("1 thing needs attention")
        default: return L("%d things need attention", attention)
        }
    }

    var symbol: String {
        switch state {
        case .up: return "checkmark.shield.fill"
        case .degraded: return "exclamationmark.triangle.fill"
        case .down: return "xmark.octagon.fill"
        case .unknown: return "questionmark.circle.fill"
        }
    }

    /// One badge per state that has any rows, worst first.
    var badges: [(state: StatusState, count: Int)] {
        let all: [(state: StatusState, count: Int)] = [(.down, down), (.degraded, degraded), (.up, up), (.unknown, unknown)]
        return all.filter { $0.count > 0 }
    }
}

/// The glyph for each check, by the row's id. A check this build does not
/// know yet still gets a tile.
func statusSymbol(_ id: String) -> String {
    switch id {
    case "site": return "macwindow"
    case "database": return "cylinder.split.1x2"
    case "jobs": return "clock.arrow.circlepath"
    case "meetings": return "calendar.badge.clock"
    case "backups": return "archivebox"
    case "whatsapp": return "message"
    case "apns": return "iphone.radiowaves.left.and.right"
    case "web-push": return "bell.badge"
    case "load": return "cpu"
    case "memory": return "memorychip"
    case "disk": return "internaldrive"
    case "host-disk": return "externaldrive"
    case "internet": return "globe"
    case "dns": return "signpost.right"
    case "public": return "arrow.up.arrow.down.circle"
    case "cameras": return "video"
    default: return "circle.dashed"
    }
}

/// "Checked just now", "Checked 12 sec. ago" — from when the answer reached
/// this phone, so a phone whose clock disagrees with the server's never reads
/// "checked in 3 seconds".
func statusCheckedLabel(_ receivedAt: Date, now: Date) -> String {
    let seconds = now.timeIntervalSince(receivedAt)
    if seconds < 3 { return L("Checked just now") }
    let formatter = RelativeDateTimeFormatter()
    formatter.locale = AppLanguage.current.locale
    formatter.unitsStyle = .short
    return L("Checked %@", formatter.localizedString(for: receivedAt, relativeTo: now))
}
