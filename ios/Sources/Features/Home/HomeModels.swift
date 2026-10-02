import SwiftUI

// What `src/lib/mobile/home-reads.ts` returns, decoded exactly as it is
// shaped there. Dates stay strings (ISO) — see ios/ARCHITECTURE.md — and are
// read with `parseISODate` / `formattedISODate` / `formattedDayKey` from Core.

// MARK: - Dashboard (home/overview, home/day)

// `DashboardStats` is already declared in Features/Projects/ProjectModels.swift
// with the same four fields (`getDashboardStats`) — reused here rather than
// redeclared.

struct HomeAdminBadges: Codable {
    let chat: Int
    let requests: Int
    let reviews: Int
    let alerts: Int
    let team: Int
}

struct HomeProject: Codable, Identifiable {
    let id: String
    let name: String
    let clientName: String
    let location: String?
    let coverImageUrl: String?
    let publishState: String
    let pipelineStatus: String
    let currentStage: String
    let completionPercent: Int
    let updatedAt: String
    let approvals: Int
    let comments: Int
}

struct HomeOverview: Codable {
    let stats: DashboardStats
    let badges: HomeAdminBadges
    let projects: [HomeProject]
}

struct NeedsManagerRow: Codable, Identifiable {
    let answer: String
    let note: String?
    let taskName: String?
    var id: String { "\(answer)-\(taskName ?? "")-\(note ?? "")" }
}

struct ContradictionRow: Codable, Identifiable {
    let taskName: String
    let said: String
    var id: String { "\(taskName)-\(said)" }
}

struct BlockedRow: Codable, Identifiable {
    let taskName: String
    let reason: String
    let who: String?
    var id: String { "\(taskName)-\(reason)" }
}

struct HomePersonDay: Codable, Identifiable {
    let employeeId: String
    let name: String
    let planned: Bool
    let plannedMinutes: Int
    let capacityMinutes: Int
    let unanswered: Int
    let started: Int
    let blocks: Int
    let needsManager: [NeedsManagerRow]
    let contradictions: [ContradictionRow]
    let blocked: [BlockedRow]
    let color: String
    let role: String?
    /// Their face, or nil for initials (`facePhotoURL`).
    let photo: String?
    let attention: Int
    let overloaded: Bool
    let overBy: Int
    /// The website's own English sentence (`describeDay`), kept as a fallback.
    let describe: String
    /// The same judgement as a code, so the app can say it in either language.
    let describeKind: String
    var id: String { employeeId }
}

struct DaySummary: Codable {
    let people: Int
    let planned: Int
    let unplanned: Int
    let overloaded: Int
    let blocked: Int
    let unanswered: Int
    let contradictions: Int
}

struct HomeDay: Codable {
    let dayKey: String
    let timezone: String
    let summary: DaySummary
    let pressing: [HomePersonDay]
    let everyone: [HomePersonDay]
}

// MARK: - Right now (home/now)

/// The block a published day plan says somebody is on, or the block due next
/// — `now`/`next` in home-now.ts, both this same shape. `leftMinutes` is only
/// ever set on `now`: a block that hasn't started yet has nothing left of it.
struct HomeNowSlot: Codable {
    let what: String
    let from: String
    let to: String
    let leftMinutes: Int?
    let entryId: String?
    let jobId: String?
}

/// A board cell or a hand-assigned job this person has IN_PROGRESS right now
/// — there can be more than one, and it can run ahead of, behind, or entirely
/// outside whatever their day plan says.
struct HomeInProgressItem: Codable, Identifiable {
    let kind: String // "cell" | "job"
    let id: String
    let title: String
    let projectName: String?
    let startedAt: String?
    /// Minutes since it started, where a start was ever recorded — null for a
    /// job moved to IN_PROGRESS before anything logged it.
    let minutes: Int?
}

struct HomeNowPerson: Codable, Identifiable {
    let id: String
    let name: String
    let color: String
    let avatar: String?
    /// Their face (`Employee.photoUrl`), or nil for initials.
    let photo: String?
    let online: Bool
    let now: HomeNowSlot?
    let next: HomeNowSlot?
    let inProgress: [HomeInProgressItem]
    let afterWork: Bool
    let beforeWork: Bool
}

struct HomeNow: Codable {
    let people: [HomeNowPerson]
}

// MARK: - Activity (home/alerts)

struct HomeAlertEmployee: Codable {
    let name: String
    let color: String
    let photoUrl: String?
}

struct HomeAlert: Codable, Identifiable {
    let id: String
    let type: String
    let title: String
    let message: String
    let url: String
    let entryId: String?
    let employeeId: String?
    let employee: HomeAlertEmployee?
    let readAt: String?
    let createdAt: String
}

struct HomeAlerts: Codable {
    let timezone: String
    let unread: Int
    let alerts: [HomeAlert]
}

// MARK: - Reviews (home/reviews)

struct SubmissionEmployee: Codable {
    let id: String
    let name: String
    let color: String
    let photoUrl: String?
}

struct CriterionCheckRow: Codable, Identifiable {
    let id: String
    let required: String
    let evidence: String?
    let verdict: String
    let gap: String?
}

struct HomeSubmission: Codable, Identifiable {
    let id: String
    let name: String
    let projectName: String?
    let entryId: String?
    let assignedTaskId: String?
    let imageUrl: String
    let isImage: Bool
    let fileLabel: String
    let note: String?
    let createdAt: String
    let employee: SubmissionEmployee
    let outcome: String?
    let outcomeLabel: String?
    let checkedAt: String?
    let checks: [CriterionCheckRow]
}

struct HomeReviews: Codable {
    let timezone: String
    /// `var`, not `let`: the screen drops an approved/rejected submission from
    /// its local copy immediately, ahead of the confirming re-read.
    var submissions: [HomeSubmission]
}

// MARK: - Analytics (home/analytics)

/// `StateCounts`: one day's list, by where each thing on it stands.
struct DayStateCounts: Codable {
    let done: Int
    let review: Int
    let working: Int
    let pending: Int
    let total: Int
}

struct DayWorkingItem: Codable, Identifiable {
    let id: String
    let title: String
    let project: String?
}

struct DayHistoryPoint: Codable, Identifiable {
    let dayKey: String
    let done: Int
    let total: Int
    var id: String { dayKey }
}

struct DailyEmployee: Codable {
    let id: String
    let name: String
    let role: String?
    let color: String
    let active: Bool
    let photoUrl: String?
}

struct DailyProgressRow: Codable, Identifiable {
    let employee: DailyEmployee
    let counts: DayStateCounts
    let history: [DayHistoryPoint]
    let working: [DayWorkingItem]
    var id: String { employee.id }
}

struct MonthOwingPerson: Codable, Identifiable {
    let id: String
    let name: String
}

struct MonthSummary: Codable {
    let team: Int
    let average: Int
    let below: Int
    let deductionsApplied: Int
    let owing: [MonthOwingPerson]
}

/// `ProgressCounts`: a period's work, per person.
struct PeriodProgressCounts: Codable {
    let total: Int
    let completed: Int
    let awaitingReview: Int
    let inProgress: Int
    let pending: Int
    let overdue: Int
    let onTime: Int
}

struct SalaryDeduction: Codable {
    let amount: Double
    let reason: String
}

struct PeriodEmployee: Codable {
    let id: String
    let name: String
    let role: String?
    let color: String
    let active: Bool
    let photoUrl: String?
}

struct EmployeeProgressRow: Codable, Identifiable {
    let employee: PeriodEmployee
    let counts: PeriodProgressCounts
    let progress: Int
    let timeliness: Int
    let shortfall: Bool
    let deduction: SalaryDeduction?
    var id: String { employee.id }
}

struct HomeAnalytics: Codable {
    let timezone: String
    let today: String
    let day: String
    let live: Bool
    let previousDay: String
    let nextDay: String
    let period: String
    let thisMonth: String
    let previousPeriod: String
    let target: Int
    let penalty: Double
    let teamDay: DayStateCounts
    let daily: [DailyProgressRow]
    let month: MonthSummary
    let rows: [EmployeeProgressRow]
}

// MARK: - Shared reading

/// The four employee colours the studio uses, mapped to the kit's tokens.
func employeeTint(_ color: String) -> Color {
    switch color {
    case "purple": return .neonPurpleStrong
    case "pink": return .neonPinkStrong
    case "orange": return .neonOrangeStrong
    default: return .neonCyanStrong
    }
}

func employeeFill(_ color: String) -> Color {
    switch color {
    case "purple": return .neonPurple
    case "pink": return .neonPink
    case "orange": return .neonOrange
    default: return .neonCyan
    }
}

/// `describeKind` in home-reads.ts → the same sentence `describeDay` would
/// print, in either language.
func describeDayKind(_ kind: String, blocked: Int, contradictions: Int, waiting: Int, unanswered: Int) -> String {
    switch kind {
    case "unplanned": return L("No plan on the day yet")
    case "blocked": return L("%d blocked", blocked)
    case "contradiction": return L("Said started, board still pending")
    case "waiting": return L("%d waiting on you", waiting)
    case "overloaded": return L("More planned than the day holds")
    case "unanswered": return L("%d unanswered", unanswered)
    case "allStarted": return L("All started")
    default: return L("On the day")
    }
}

/// The three answers an employee can give that need the manager
/// (`needsManager` in day-board.ts): "blocked", "need-info", "more-time".
func describeManagerAnswer(_ answer: String) -> String {
    switch answer {
    case "blocked": return L("blocked")
    case "need-info": return L("need info")
    case "more-time": return L("more time")
    default: return answer.replacingOccurrences(of: "-", with: " ")
    }
}

struct VerdictLook {
    let symbol: String
    let tone: Color
    let toneBackground: Color
    let label: String
}

/// `LOOK` in submission-checks.tsx: "not met" is a fault in the work (red),
/// "cannot tell" is a limit of the evidence (grey) — deliberately not the
/// same weight on screen.
func verdictLook(_ verdict: String) -> VerdictLook {
    switch verdict {
    case "met":
        return VerdictLook(symbol: "checkmark.circle.fill", tone: .neonSuccessStrong, toneBackground: .neonSuccess, label: L("Shown"))
    case "partly":
        return VerdictLook(symbol: "exclamationmark.triangle.fill", tone: .neonWarningStrong, toneBackground: .neonWarning, label: L("Partly"))
    case "not-met":
        return VerdictLook(symbol: "minus.circle.fill", tone: .neonDangerStrong, toneBackground: .neonDanger, label: L("Not done"))
    case "cannot-tell":
        return VerdictLook(symbol: "questionmark.circle.fill", tone: .neonTextSecondary, toneBackground: .neonSurfaceSunken, label: L("Evidence does not show"))
    default:
        return VerdictLook(symbol: "person.crop.circle.badge.questionmark", tone: .neonPurpleStrong, toneBackground: .neonPurple, label: L("Your call"))
    }
}

func homeAlertSymbol(_ type: String) -> String {
    switch type {
    case "TASK_SUBMITTED": return "tray.and.arrow.down.fill"
    case "TASK_STATUS_CHANGED": return "arrow.triangle.2.circlepath"
    case "TASK_OVERDUE": return "clock.badge.exclamationmark.fill"
    case "SUPPLY_REQUEST": return "shippingbox.fill"
    case "CHAT_MESSAGE": return "bubble.left.fill"
    case "ATTENDANCE": return "touchid"
    default: return "bell.fill"
    }
}

/// "2026-03-01" shifted by `days`, in UTC — the server's own day-key arithmetic
/// (`shiftDayKey` in lib/time.ts), so paging never slips a day against it.
func shiftHomeDayKey(_ key: String, by days: Int) -> String {
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = TimeZone(identifier: "UTC")!
    guard let date = NeonFormat.date(fromDayKey: key, calendar: utc),
          let shifted = utc.date(byAdding: .day, value: days, to: date)
    else { return key }
    return NeonFormat.dayKey(shifted, calendar: utc)
}

/// "YYYY-MM" → "September 2026" (`periodLabel` in lib/payroll.ts).
func homePeriodLabel(_ period: String) -> String {
    let parts = period.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2,
          let date = Calendar(identifier: .gregorian).date(from: DateComponents(year: parts[0], month: parts[1], day: 1))
    else { return period }
    var style = Date.FormatStyle(date: .long, time: .omitted, locale: AppLanguage.current.locale)
    style = style.month(.wide).year()
    return date.formatted(style)
}

/// "Thursday 10 September" — `LONG_DAY` in daily-progress.ts, in UTC so the
/// day key never slips against the studio's own reading of it.
func longDayLabel(_ dayKey: String) -> String {
    guard let date = parseISODate("\(dayKey)T00:00:00.000Z") else { return dayKey }
    var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: AppLanguage.current.locale)
    style.timeZone = TimeZone(identifier: "UTC")!
    style = style.weekday(.wide).day().month(.wide)
    return date.formatted(style)
}

/// "Today · Thursday 10 September", "Yesterday · …", "Tomorrow · …", or the date.
func homeDayHeading(_ dayKey: String, today: String) -> String {
    let date = longDayLabel(dayKey)
    if dayKey == today { return L("Today · %@", date) }
    if dayKey == shiftHomeDayKey(today, by: -1) { return L("Yesterday · %@", date) }
    if dayKey == shiftHomeDayKey(today, by: 1) { return L("Tomorrow · %@", date) }
    return date
}

// MARK: - The Home tab's figures over time (home/pulse)

/// `homePulse()` in src/lib/mobile/home-pulse.ts: only what timestamps really
/// record. Published and Updated This Week have no history on the server, so
/// nothing here describes them — the cards draw no trend for them.
struct HomePulse: Codable {
    let timezone: String
    let today: String
    /// The manager's own row (accessRole MANAGER), when the studio has one.
    let manager: HomeManager?
    let projects: HomeProjectsTrend
    let approvals: HomeApprovalsTrend
    let month: HomeMonthMetrics
    let reviews: HomeReviewQueue
}

struct HomeManager: Codable {
    let name: String
}

struct HomeProjectsTrend: Codable {
    let createdThisMonth: Int
    /// How many projects existed at the end of each of the last six months,
    /// oldest first; the last is this month so far.
    let monthEnds: [Int]
}

struct HomeApprovalsTrend: Codable {
    /// Approvals waiting on a client at the end of each of the last six
    /// weeks, oldest first; the last is now.
    let weekEnds: [Int]
    /// Now, against a week ago.
    let change: Int
}

/// One metric of "This month" (`MonthSeries` in home-pulse-rules.ts): weeks
/// of the month from the 1st (1–7, 8–14, …), against last month's.
struct HomeMonthSeries: Codable {
    let period: String
    let previousPeriod: String
    let throughDay: Int
    let weeks: [Int]
    let previousWeeks: [Int]
    /// This month so far.
    let total: Int
    /// Last month through the same day of the month.
    let previousToDate: Int
    let previousTotal: Int
}

struct HomeMonthMetrics: Codable {
    /// Board steps and jobs marked done (only the manager can), by `completedAt`.
    let completed: HomeMonthSeries
    /// Projects by their Sold on day.
    let sold: HomeMonthSeries
    /// Projects by the day they were created.
    let created: HomeMonthSeries
}

struct HomeReviewPerson: Codable, Identifiable {
    let id: String
    let name: String
    let color: String
    let photoUrl: String?
}

struct HomeReviewQueue: Codable {
    let waiting: Int
    /// Everybody with work waiting, each once, oldest first.
    let people: [HomeReviewPerson]
}

// MARK: - Today's Tasks (home/today)

struct HomeTodayPerson: Codable {
    let id: String
    let name: String
    let color: String
    /// Their face, or nil for initials.
    let photoUrl: String?
}

/// One thing on today's calendar (`homeToday()` in home-today.ts): a board
/// cell ("cell"), a job handed out by hand ("job") or a meeting ("meeting").
struct HomeTodayItem: Codable, Identifiable {
    let kind: String
    /// The cell's, job's or meeting's own id.
    let itemId: String
    let title: String
    let projectId: String?
    let projectName: String?
    let coverImageUrl: String?
    let person: HomeTodayPerson?
    /// The board's state word; nil for a meeting, which has none.
    let state: String?
    let priority: String?
    /// When it happens or is due, when that moment is today.
    let at: String?
    let scheduled: Bool
    /// A job running past today: its last day (YYYY-MM-DD).
    let until: String?
    let durationMinutes: Int?
    let mode: String?
    let place: String?
    let attendees: Int?

    var id: String { "\(kind)-\(itemId)" }
    var isDone: Bool { state == "DONE" }

    enum CodingKeys: String, CodingKey {
        case kind, itemId = "id", title, projectId, projectName, coverImageUrl, person, state, priority
        case at, scheduled, until, durationMinutes, mode, place, attendees
    }
}

struct HomeToday: Codable {
    let timezone: String
    let dayKey: String
    let items: [HomeTodayItem]
}
