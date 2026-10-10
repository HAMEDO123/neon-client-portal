import SwiftUI

// Which of somebody's tasks a list is showing, and what a task's priority
// looks like — the website's lib/task-filters.ts and
// components/tasks/priority.ts, kept to the same rules so the phone's buttons
// count the tasks the website's do and a colour means the same thing on both.
//
// The list had three answers — open, completed, all — and "open" was one
// bucket holding work nobody had started, work under way, work waiting on the
// manager and work that was late, which are four different things to do next.
// The studio asked for them apart. Read by the team's own list, the manager's
// week and the Assign view.

enum TaskFilter: String, CaseIterable, Identifiable {
    case open, progress, review, late, done, all

    var id: String { rawValue }

    /// The team's own list: "Open" is still where the tab lands — what there
    /// is to do — with the four the studio asked for beside it.
    static let mine: [TaskFilter] = [.open, .progress, .review, .late, .done, .all]
    /// The manager's week and the Assign view. "All" is the week as it always was.
    static let week: [TaskFilter] = [.all, .progress, .review, .late, .done]

    /// "Completed" on the team's own list and "Done" on the manager's, as the
    /// website words them.
    func label(mine: Bool) -> String {
        switch self {
        case .open: return L("Open")
        case .progress: return L("In progress")
        case .review: return L("Sent for review")
        case .late: return L("Late")
        case .done: return mine ? L("Completed") : L("Done")
        case .all: return L("All")
        }
    }

    /// `matchesFilter`. "Open" is what is still this person's to do: work
    /// sent for review has left their hands — it is the manager's move — so
    /// it is not open, and has a button of its own. It comes back by itself
    /// if the manager sends it back, because that returns it to in progress.
    func matches(_ item: TaskStanding) -> Bool {
        switch self {
        case .all: return true
        case .open: return item.state != "DONE" && item.state != "SUBMITTED"
        case .progress: return item.state == "IN_PROGRESS"
        case .review: return item.state == "SUBMITTED"
        case .late: return item.late
        case .done: return item.state == "DONE"
        }
    }

    /// `countByFilter`: how many tasks each filter would show, for the number
    /// on its button.
    static func counts(_ items: [TaskStanding]) -> [TaskFilter: Int] {
        var counts: [TaskFilter: Int] = [:]
        for filter in allCases {
            counts[filter] = items.reduce(0) { $0 + (filter.matches($1) ? 1 : 0) }
        }
        return counts
    }
}

extension TaskFilter {
    /// The phone API's older `?filter=` on `/tasks` and `me/jobs`: open
    /// (there it still means "not done"), completed, or all.
    var olderWord: String {
        switch self {
        case .open: return "open"
        case .done: return "completed"
        default: return "all"
        }
    }
}

/// Today in the studio's calendar, as "YYYY-MM-DD" — for a screen whose read
/// did not say which day it is there.
func studioTodayKey(_ now: Date = Date()) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: whatsAppStudioTimeZone)
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: now)
}

/// What a list needs to know about one task to place it.
struct TaskStanding {
    let state: String
    let late: Bool

    init(state: String, late: Bool) {
        self.state = state
        self.late = late
    }

    /// A job with its last day: `isLate`. Late is "the day it was due has
    /// gone and it has not been approved" — whole days in the studio's
    /// calendar, so something due today is not late however late in the day
    /// it is. Work sent for review still counts: it is late until somebody
    /// approves it. Work with no date cannot be late.
    init(state: String, dueKey: String?, todayKey: String) {
        self.state = state
        if state == "DONE" {
            late = false
        } else if let dueKey, !dueKey.isEmpty, !todayKey.isEmpty {
            late = dueKey < todayKey
        } else {
            late = false
        }
    }
}

// MARK: - The buttons

/// The row of buttons that narrows a list of tasks to one kind — in progress,
/// sent for review, late, done — each with how many there are, so "is
/// anything late" is answered before anything is pressed. Wraps rather than
/// scrolls: six buttons are two rows on a phone, and every one stays in sight.
struct TaskFilterBar: View {
    @Binding var selection: TaskFilter
    let options: [TaskFilter]
    let counts: [TaskFilter: Int]
    /// The team's own list, which says "Completed" where the manager's says "Done".
    var mine = false

    var body: some View {
        FlowRow(spacing: 8) {
            ForEach(options) { option in
                let selected = option == selection
                let count = counts[option] ?? 0
                // Something is late: the one button that should be seen
                // without looking for it.
                let alarm = option == .late && count > 0 && !selected
                Button {
                    guard !selected else { return }
                    Haptic.selection()
                    withNeonAnimation(NeonMotion.snappy) { selection = option }
                } label: {
                    HStack(spacing: 6) {
                        Text(option.label(mine: mine))
                            .lineLimit(1)
                        Text(NeonFormat.integer(count))
                            .font(.system(size: 11, weight: .bold))
                            .monospacedDigit()
                            .lineLimit(1)
                            .fixedSize()
                            .padding(.horizontal, 6)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(Capsule().fill(
                                selected ? Color.white.opacity(0.24) : (alarm ? Color.neonDanger.opacity(0.16) : Color.neonInk.opacity(0.07))
                            ))
                    }
                    .font(.system(.subheadline, weight: selected ? .semibold : .medium))
                    .foregroundStyle(selected ? Color.white : (alarm ? Color.neonDangerStrong : Color.neonInk.opacity(0.78)))
                    // Its own width, always: a chip squeezed by the row
                    // breaks its number onto a second line.
                    .fixedSize()
                    .padding(.horizontal, 13)
                    .frame(minHeight: 36)
                    .background {
                        if selected {
                            Capsule()
                                .fill(LinearGradient.neonAccent)
                                .shadow(color: Color.neonAccent.opacity(0.26), radius: 4, x: 0, y: 2)
                        } else if alarm {
                            Capsule()
                                .fill(Color.neonDanger.opacity(0.1))
                                .overlay(Capsule().strokeBorder(Color.neonDanger.opacity(0.35), lineWidth: 1))
                        } else {
                            Capsule()
                                .fill(Color.white.opacity(0.94))
                                .overlay(Capsule().strokeBorder(Color.neonLine, lineWidth: 1))
                        }
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(PressableStyle(scale: 0.95))
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityValue(Text(NeonFormat.integer(count)))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
}

// MARK: - Priority

/// What a task's priority looks like, wherever a task is drawn.
///
/// The studio asked for the whole task to wear its priority, not only the
/// word: a high priority is red from across the room. It was one small pink
/// chip on a row otherwise identical to every other, which is the one thing
/// on the screen that is supposed to be noticed first.
///
/// Medium is deliberately not a colour. It is what a task is when nobody
/// chose, which is nearly all of them, and a list where every row is tinted
/// is a list where the red ones stop standing out.
enum TaskPriorityLook {
    case high, low, plain

    /// The whole card wears its priority until the work is finished:
    /// something done is no longer urgent, whatever it was.
    init(priority: String?, state: String) {
        if state == "DONE" {
            self = .plain
        } else if priority == "HIGH" {
            self = .high
        } else if priority == "LOW" {
            self = .low
        } else {
            self = .plain
        }
    }

    /// The red of a high priority (the website's red-600).
    static let red = Color(hex: 0xDC2626)

    var wash: LinearGradient? {
        switch self {
        case .high:
            return LinearGradient(colors: [Color(hex: 0xFEE2E2), Color(hex: 0xFECACA).opacity(0.86)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .low:
            return LinearGradient(colors: [Color(hex: 0xF1F5F9), Color(hex: 0xE2E8F0).opacity(0.8)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .plain:
            return nil
        }
    }

    var border: Color {
        switch self {
        case .high: return Self.red.opacity(0.5)
        case .low: return Color(hex: 0x64748B).opacity(0.24)
        case .plain: return .clear
        }
    }
}

private struct TaskPriorityWash: ViewModifier {
    let look: TaskPriorityLook
    let radius: CGFloat
    let inset: CGFloat

    func body(content: Content) -> some View {
        if let wash = look.wash {
            let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
            content
                .padding(inset)
                .background(shape.fill(wash))
                .overlay(shape.strokeBorder(look.border, lineWidth: 1))
                .shadow(color: look == .high ? TaskPriorityLook.red.opacity(0.16) : .clear, radius: 8, x: 0, y: 4)
                // The row's own words stay in line with the rows around it.
                .padding(.horizontal, -inset)
        } else {
            content
        }
    }
}

private struct TaskPrioritySurface: ViewModifier {
    let look: TaskPriorityLook
    let radius: CGFloat

    func body(content: Content) -> some View {
        if let wash = look.wash {
            let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
            content
                .background(shape.fill(wash))
                .overlay(shape.strokeBorder(look.border, lineWidth: 1))
                .shadow(color: look == .high ? TaskPriorityLook.red.opacity(0.18) : Color.neonShadowTint.opacity(0.06), radius: 10, x: 0, y: 5)
        } else {
            content.neonSurface(.glass, radius: radius)
        }
    }
}

extension View {
    /// A task's own card: the kit's glass, or its priority's colour in place
    /// of it. (A wash laid behind the glass would not show through it.)
    func taskPrioritySurface(_ priority: String?, state: String, radius: CGFloat = NeonRadius.lg) -> some View {
        modifier(TaskPrioritySurface(look: TaskPriorityLook(priority: priority, state: state), radius: radius))
    }

    /// A task's row washed in its priority's colour — red for high, a quiet
    /// grey for low, untouched for medium or once it is done.
    func taskPriorityWash(_ priority: String?, state: String, radius: CGFloat = NeonRadius.md, inset: CGFloat = 10) -> some View {
        modifier(TaskPriorityWash(look: TaskPriorityLook(priority: priority, state: state), radius: radius, inset: inset))
    }
}

/// The word itself, on a row that is already coloured: solid red, so it reads
/// on the red wash.
struct TaskHighChip: View {
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "flame.fill").font(.system(size: 9, weight: .bold))
            Text(L("High").uppercased())
                .lineLimit(1)
        }
        .font(.system(size: 11, weight: .bold))
        .tracking(0.4)
        .padding(.horizontal, 9)
        .padding(.vertical, 4.5)
        .background(TaskPriorityLook.red, in: Capsule())
        .foregroundStyle(.white)
    }
}
