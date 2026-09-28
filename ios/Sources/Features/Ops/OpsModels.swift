import SwiftUI

// The shapes src/lib/mobile/registry/ops.ts answers with, and the studio's own
// words for the enums in them — the same rule as Core/Formatting.swift's
// taskStateLabel: one function per enum, so every screen in this area agrees
// with the website on what to call something.

// MARK: - Attendance

struct AttendanceOverview: Decodable {
    struct Device: Decodable { let ip: String; let port: Int }
    struct Clock: Decodable { let wallClock: String; let driftSeconds: Int }
    struct DeviceUser: Decodable, Identifiable {
        let uid: Int
        let deviceUserId: String
        let name: String
        let isAdmin: Bool
        var id: Int { uid }
    }
    struct Employee: Decodable, Identifiable {
        let id: String
        let name: String
        let role: String?
        let deviceUserId: String?
    }
    struct Paired: Decodable { let deviceUserId: String; let name: String; let active: Bool }

    let device: Device?
    let reachError: String?
    let clock: Clock?
    let driftBad: Bool
    let users: [DeviceUser]
    let canReach: Bool
    let employees: [Employee]
    let paired: [Paired]

    var pairedByDeviceUserId: [String: Paired] {
        Dictionary(paired.map { ($0.deviceUserId, $0) }, uniquingKeysWith: { a, _ in a })
    }
}

/// Whether the device's clock is out by more than MAX_DRIFT_SECONDS
/// (attendance-sync.ts) — repeated here only for display; the server is the
/// one place that refuses to sync on it.
let attendanceMaxDriftSeconds = 600

struct AttendanceMonth: Decodable {
    struct Day: Decodable {
        let dayKey: String
        let dayOfMonth: Int
        let weekday: Int
        let worked: Bool
        let isToday: Bool
        let isFuture: Bool
    }
    struct Entry: Decodable {
        let employeeId: String
        let dayKey: String
        let delayHours: Double
        /// Hours of the day left unworked at the end; zero when nobody clocked out.
        let earlyHours: Double?
        /// Whether a clock-out was recorded at all — a blank is not "stayed to the end".
        let clockedOut: Bool?
        let source: String
        let note: String?
    }
    struct Row: Decodable, Identifiable {
        let employeeId: String
        let name: String
        let active: Bool
        let cells: [Entry?]
        let daysRecorded: Int
        let hoursLate: Double
        var id: String { employeeId }
    }

    let monthKey: String
    let days: [Day]
    let rows: [Row]
    let thisMonth: String
    /// `AttendanceRecord.id`, keyed by `"<employeeId>|<dayKey>"` — what the
    /// correction sheet hands `opsDeleteAttendance` for a day it has open.
    let recordIds: [String: String]

    func recordId(employeeId: String, dayKey: String) -> String? {
        recordIds["\(employeeId)|\(dayKey)"]
    }
}

// MARK: - Requests

struct OpsRequests: Decodable {
    let pending: [SupplyRequest]
    let decided: [SupplyRequest]
    let team: [TeamMember]
    let reports: [DailyReportEntry]

    struct TeamMember: Decodable, Identifiable {
        let id: String
        let name: String
        let role: String?
    }

    struct DailyReportEntry: Decodable {
        let employeeId: String
        let text: String
        let updatedAt: String
    }
}

struct SupplyRequest: Decodable, Identifiable {
    struct Employee: Decodable { let id: String; let name: String; let role: String? }

    let id: String
    let item: String
    let quantity: String?
    let note: String?
    let estimatedCost: Double?
    let urgent: Bool
    let status: String
    let decisionNote: String?
    let decidedAt: String?
    let createdAt: String
    let employee: Employee
}

func supplyStatusLabel(_ status: String) -> String {
    switch status {
    case "PENDING": return L("Waiting for a decision")
    case "APPROVED": return L("Approved")
    case "REJECTED": return L("Not approved")
    case "PURCHASED": return L("Bought")
    default: return status.capitalized
    }
}

func supplyStatusTone(_ status: String) -> BadgeTone {
    switch status {
    case "PENDING": return .warning
    case "APPROVED": return .success
    case "REJECTED": return .neutral
    case "PURCHASED": return .cyan
    default: return .neutral
    }
}

// MARK: - Site visits

struct SiteVisit: Decodable, Identifiable {
    struct Employee: Decodable { let id: String; let name: String; let color: String }
    struct Project: Decodable { let id: String; let name: String; let clientName: String? }

    let id: String
    let employeeId: String
    let title: String
    let location: String?
    let purpose: String?
    let scheduledAt: String
    let state: String
    let report: String?
    let reportedAt: String?
    let employee: Employee
    let project: Project?
}

struct SiteVisitProject: Decodable, Identifiable {
    let id: String
    let name: String
    let clientName: String?
}

struct MySiteVisits: Decodable {
    let visits: [SiteVisit]
    let projects: [SiteVisitProject]
}

/// `STATE_LABEL` in src/lib/site-visits.ts.
func siteVisitStateLabel(_ state: String) -> String {
    switch state {
    case "PLANNED": return L("Planned")
    case "VISITED": return L("Went")
    case "MISSED": return L("Did not go")
    case "CANCELLED": return L("Called off")
    default: return state.capitalized
    }
}

/// `STATE_TONE` in src/lib/site-visits.ts.
func siteVisitStateTone(_ state: String) -> BadgeTone {
    switch state {
    case "PLANNED": return .cyan
    case "VISITED": return .success
    case "MISSED": return .danger
    case "CANCELLED": return .neutral
    default: return .neutral
    }
}

/// `awaitingReport` in src/lib/site-visits.ts: planned, and its time has passed.
func siteVisitAwaitingReport(_ visit: SiteVisit) -> Bool {
    guard visit.state == "PLANNED", let at = parseISODate(visit.scheduledAt) else { return false }
    return at <= Date()
}

/// `isUpcoming` in src/lib/site-visits.ts: planned, and not yet due.
func siteVisitUpcoming(_ visit: SiteVisit) -> Bool {
    guard visit.state == "PLANNED", let at = parseISODate(visit.scheduledAt) else { return false }
    return at > Date()
}

/// `needsReport` in src/lib/site-visits.ts.
func siteVisitNeedsReport(_ state: String) -> Bool {
    state == "VISITED" || state == "MISSED"
}

// MARK: - Settings

struct OpsWorkHours: Decodable {
    let days: [Int]
    let start: String
    let end: String
    let lunchMinutes: Int
    let lunchAt: String
    let bufferMinutes: Int
    let graceMinutes: Int
}

struct OpsSettings: Decodable {
    struct WhatsApp: Decodable {
        let transport: String
        let connected: Bool
        let detail: String?
        let number: String?
    }

    let timezone: String
    let timezoneOptions: [String]
    let planningNotes: String
    let workHours: OpsWorkHours
    let dayLengthMinutes: Int
    let capacityMinutes: Int
    let onTimeUntil: String
    let automationRules: [AutomationRule]
    let automationSwitchedOn: Bool
    let pushHealth: PushHealth
    let managerPaired: Bool
    let managerDevices: Int
    let whatsapp: WhatsApp
    let aiConfigured: Bool
}

struct PushHealth: Decodable {
    struct Device: Decodable, Identifiable {
        let employeeId: String
        let name: String
        let active: Int
        let retired: Int
        let lastUsedAt: String?
        var id: String { employeeId }
    }
    struct Delivery: Decodable, Identifiable {
        let at: String
        let status: String
        let channel: String
        let detail: String?
        let employee: String?
        var id: String { at + status + (employee ?? "") }
    }

    let configured: Bool
    let source: String?
    let devices: [Device]
    let activeTotal: Int
    let recent: [Delivery]
}

struct AutomationRule: Decodable, Identifiable {
    let id: String
    let name: String
    let trigger: String
    let atLeast: Int
    let action: String
    let recipient: String
    let graceMinutes: Int
    let cooldownMinutes: Int
    let escalateAfterMinutes: Int?
    let enabled: Bool
}

struct AutomationPreview: Decodable {
    let rules: Int
    let considered: Int
    let sent: Int
    let quiet: Int
    let preview: Bool
    let lines: [String]
}

let automationTriggers = ["no-plan", "overloaded", "blocked", "contradiction", "waiting-on-manager", "unanswered"]
let automationActions = ["ask", "tell", "escalate"]
let automationRecipients = ["the-person", "the-manager"]

/// `TRIGGER_LABEL` in src/lib/automation.ts.
func automationTriggerLabel(_ trigger: String) -> String {
    switch trigger {
    case "no-plan": return L("No plan on their day")
    case "overloaded": return L("More planned than the day holds")
    case "blocked": return L("Work waiting on somebody else")
    case "contradiction": return L("Said started, board still pending")
    case "waiting-on-manager": return L("An answer waiting on the manager")
    case "unanswered": return L("Questions nobody has answered")
    default: return trigger
    }
}

func automationActionLabel(_ action: String) -> String {
    switch action {
    case "ask": return L("Ask")
    case "tell": return L("Tell")
    case "escalate": return L("Escalate")
    default: return action
    }
}

func automationRecipientLabel(_ recipient: String) -> String {
    switch recipient {
    case "the-person": return L("The person")
    case "the-manager": return L("The manager")
    default: return recipient
    }
}

/// Minutes as "HH:MM" → minutes since midnight, mirroring work-hours.ts `minutesOf`.
func minutesOfTime(_ time: String) -> Int? {
    let parts = time.split(separator: ":").compactMap { Int($0) }
    guard parts.count == 2 else { return nil }
    return parts[0] * 60 + parts[1]
}

/// Computed rather than a stored global, so it re-reads L() on every call —
/// a `let` at file scope evaluates once and would freeze at whichever
/// language was current the first time this file was touched.
func workingDayNames() -> [String] {
    [L("Sunday"), L("Monday"), L("Tuesday"), L("Wednesday"), L("Thursday"), L("Friday"), L("Saturday")]
}
