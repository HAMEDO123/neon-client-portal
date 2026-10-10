import SwiftUI

// Small pieces shared across this area's own screens (Today, Tasks, Assign,
// jobs handed out by hand). Kept local rather than in Core/Formatting.swift,
// which every area reads from — see the note on `meTaskStateLabel` below.

/// `taskStateLabel` in Core/Formatting.swift is shared by every area and says
/// "Pending"/"Completed" — the project board's own words. A job or task's own
/// screen needs the studio's actual vocabulary for the two states people
/// confuse: TODO is work nobody has touched yet ("To do"), and DONE only ever
/// means the manager approved it ("Approved" — never "Completed", which read
/// as though the *work*, not the *review*, were finished). Everything else
/// already matches the studio's words, so it falls back to the shared label.
func meTaskStateLabel(_ state: String) -> String {
    switch state {
    case "TODO": return L("To do")
    case "DONE": return L("Approved")
    default: return taskStateLabel(state)
    }
}

/// The kit's `StateBadge` shape (dot or symbol, pulsing while in progress)
/// with this area's corrected wording, since `StateBadge(state:)` reads
/// straight from the shared `taskStateLabel`.
func meStateBadge(_ state: String) -> StateBadge {
    StateBadge(meTaskStateLabel(state), tone: taskStateTone(state), symbol: StateBadge.symbol(for: state), pulsing: state == "IN_PROGRESS")
}

/// A priority chip only when it is worth a second chip on the card — HIGH.
/// LOW and MEDIUM said nothing worth a whole badge for every row. Solid red:
/// the row it sits on is washed red too (`taskPriorityWash`), and the word
/// has to read on it.
@ViewBuilder
func priorityChip(_ priority: String?) -> some View {
    if priority == "HIGH" {
        TaskHighChip()
    }
}

/// "Late" on exactly the rows the Late button lists: the day it was due has
/// gone and it has not been approved (the server's `isLate`).
@ViewBuilder
func lateBadge(_ late: Bool?) -> some View {
    if late == true {
        BadgeView(text: L("Late"), tone: .danger, symbol: "clock.badge.exclamationmark.fill")
    }
}

/// A job's days, the same start–end formatting `JobRow` and the week cards use.
func jobDateRange(startKey: String, endKey: String) -> String {
    let from = formattedDayKey(startKey)
    let to = formattedDayKey(endKey)
    return startKey == endKey ? from : "\(from) – \(to)"
}

/// True when a job has nothing written under "counts as done when" — the one
/// thing that sends it back from review with nothing to check it against.
func jobHasNoAcceptance(_ job: MyAssignedJob) -> Bool {
    (job.acceptance ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
}
