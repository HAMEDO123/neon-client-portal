import SwiftUI

// Pieces the Tasks area draws on more than one of its screens: the split of
// work by state, the person filter, a board step as a chip, the state picker
// the two editors share, and the period navigator. Built from the kit's
// tokens and components; named after the area so they never collide with it.

// MARK: - Colours

/// The board's states in the order the studio reads a tally: finished first,
/// then waiting on the manager, being worked on, flagged for tomorrow, pending.
let tasksStateOrder = ["DONE", "SUBMITTED", "IN_PROGRESS", "TOMORROW", "TODO"]

/// A state's colour family — the same one its `StateBadge` wears.
func tasksStateHue(_ state: String) -> NeonHue { taskStateTone(state).hue }

/// `EMPLOYEE_COLORS` in src/lib/task-board.ts (a section's or a person's
/// colour on the board) as a kit hue.
func tasksColorHue(_ name: String, fallback: NeonHue = .grey) -> NeonHue {
    switch name {
    case "cyan": return .cyan
    case "purple": return .purple
    case "pink": return .pink
    case "orange": return .orange
    default: return fallback
    }
}

/// The board colour the studio keeps for a person (`Employee.color`, one of
/// `EMPLOYEE_COLORS`, handed out in turn as people are added), as a hue.
/// Only somebody the server sends no colour for falls back to their name.
/// Prefer `TasksTeamHues`, which also keeps two people from sharing one.
func tasksPersonHue(_ color: String?, name: String) -> NeonHue {
    guard let color, !color.isEmpty else { return NeonPalette.hue(for: name) }
    // The website reads anything it doesn't know as cyan (`asColor`).
    return tasksColorHue(color, fallback: .cyan)
}

/// Somebody on the board, as far as their colour goes.
protocol TasksHuedPerson {
    var id: String { get }
    var name: String { get }
    var color: String { get }
}

extension TaskPerson: TasksHuedPerson {}
extension TaskPeopleMember: TasksHuedPerson {}
extension ProcessMember: TasksHuedPerson {}

/// Every person's colour in this area, worked out once from the board's own
/// team — active staff, in the board's order, the same list on Board, Week,
/// Team and the process settings — so a person wears the same colour on
/// every screen. The kit's `AvatarView` and `PersonChip` colour a person by
/// a hash of their name, which gave Wael one colour on Team and another on
/// Board, and gave two people the same one side by side; the area draws its
/// own faces with these instead.
///
/// The studio has only four board colours, handed out in turn, so a fifth
/// person repeats the first. Whoever holds a colour first keeps it; anybody
/// after them who would repeat it takes the next hue nobody on the team
/// wears, so no two people in one row of chips look alike.
struct TasksTeamHues {
    private var byId: [String: NeonHue] = [:]

    /// Hues a repeat can move to, after the board's own four.
    private static let spare: [NeonHue] = [.blue, .green, .amber, .indigo, .red, .cyan, .purple, .pink, .orange]

    init<P: TasksHuedPerson>(_ team: [P]) {
        var taken = Set<NeonHue>()
        var repeats: [P] = []
        for person in team {
            let own = tasksPersonHue(person.color, name: person.name)
            if taken.contains(own) {
                repeats.append(person)
            } else {
                taken.insert(own)
                byId[person.id] = own
            }
        }
        for person in repeats {
            let next = Self.spare.first { !taken.contains($0) } ?? tasksPersonHue(person.color, name: person.name)
            taken.insert(next)
            byId[person.id] = next
        }
    }

    /// The person's hue; somebody not on the team (an inactive owner, a
    /// name on an old card) wears their own board colour.
    func hue(_ id: String?, name: String, color: String?) -> NeonHue {
        id.flatMap { byId[$0] } ?? tasksPersonHue(color, name: name)
    }

    func hue<P: TasksHuedPerson>(_ person: P) -> NeonHue {
        hue(person.id, name: person.name, color: person.color)
    }
}

/// The dot a hue leaves in a legend; grey stays a quiet grey rather than
/// vanishing into the card.
private func tasksDotColor(_ hue: NeonHue) -> Color { hue == .grey ? hue.gradient[1] : hue.color }

// MARK: - Faces

/// A person's initials on their board colour (`tasksPersonHue`): solid with
/// white initials on cards and rows, the quiet pastel in a chip.
struct TasksAvatar: View {
    let name: String
    let hue: NeonHue
    var size: CGFloat = NeonSize.avatar
    var solid = true
    var ring = false

    var body: some View {
        Text(AvatarView.initials(name, size: size))
            .font(.system(size: size * 0.4, weight: .bold))
            .foregroundStyle(solid ? Color.white : hue.deep)
            .frame(width: size, height: size)
            .background {
                Circle().fill(solid
                    ? LinearGradient(colors: [hue.color, hue.deep], startPoint: .topLeading, endPoint: .bottomTrailing)
                    : LinearGradient(colors: [hue.wash, hue.pastel], startPoint: .topLeading, endPoint: .bottomTrailing))
            }
            .overlay {
                if ring { Circle().strokeBorder(Color.white, lineWidth: max(1.5, size * 0.05)) }
            }
            .accessibilityLabel(Text(verbatim: name))
    }
}

/// A person as a capsule in the filter row: their face and name, washed in
/// their own colour when chosen.
struct TasksPersonChip: View {
    let name: String
    let hue: NeonHue
    var isSelected = false

    var body: some View {
        HStack(spacing: 7) {
            TasksAvatar(name: name, hue: hue, size: 24, solid: isSelected)
            DirText(name, font: .system(.footnote, weight: .semibold), color: isSelected ? hue.deep : .neonInk, fill: false, lineLimit: 1)
        }
        .padding(.leading, 4)
        .padding(.trailing, 12)
        .padding(.vertical, 4)
        .background(Capsule().fill(isSelected ? hue.wash : Color.white.opacity(0.9)))
        .overlay(Capsule().strokeBorder(isSelected ? hue.color.opacity(0.5) : Color.neonLine, lineWidth: isSelected ? 1.5 : 1))
        .animation(NeonMotion.snappy, value: isSelected)
    }
}

// MARK: - Where the work stands

/// One part of a tally: "12 Completed", in its state's colour.
struct TasksBreakdownPart: Identifiable, Equatable {
    let id: String
    let label: String
    let count: Int
    let hue: NeonHue
}

extension TasksBreakdownPart {
    /// Board cells (or jobs) counted by state, in the studio's order, each
    /// under its `StateBadge` word. States with nothing still appear, at 0,
    /// so the key reads the same on every card.
    static func states(_ states: [String], order: [String] = tasksStateOrder) -> [TasksBreakdownPart] {
        order.map { state in
            TasksBreakdownPart(id: state, label: taskStateLabel(state), count: states.filter { $0 == state }.count, hue: tasksStateHue(state))
        }
    }
}

/// A bar split by state, with a key under it: a dot, the figure in bold, the
/// word. Three to a row so the studio's longer words ("Planned for tomorrow")
/// fit on a phone, where the kit's single-row legend would cut them.
struct TasksBreakdown: View {
    let parts: [TasksBreakdownPart]
    var barHeight: CGFloat = 10
    var showsKey = true
    /// How many to a row in the key: three suits five parts, four suits four.
    var columns = 3

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SegmentedProgressBar(parts.map { ProgressSegment($0.label, value: Double($0.count), hue: $0.hue, id: $0.id) }, height: barHeight)
            if showsKey {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: NeonSpace.sm, alignment: .topLeading), count: max(1, columns)),
                          alignment: .leading, spacing: NeonSpace.md) {
                    ForEach(parts) { part in
                        HStack(alignment: .top, spacing: 7) {
                            Circle()
                                .fill(tasksDotColor(part.hue))
                                .frame(width: 8, height: 8)
                                .padding(.top, 6)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(NeonFormat.integer(part.count))
                                    .font(.system(.headline, weight: .bold))
                                    .monospacedDigit()
                                    .foregroundStyle(part.count == 0 ? Color.neonTextTertiary : Color.neonInk)
                                // Words wrap onto a second line; a single
                                // word too long for its column ("Completed"
                                // on a narrow card) shrinks rather than breaks.
                                Text(part.label)
                                    .font(.neonSubtitle)
                                    .foregroundStyle(Color.neonTextSecondary)
                                    .lineLimit(part.label.contains(" ") ? 2 : 1)
                                    .minimumScaleFactor(0.75)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }
}

// MARK: - Whose work

/// "Everyone" and then each person on the board, as a sideways row of
/// chips — the person's initials on their board colour, the same one they
/// wear on every screen of the area. Bleed it to the screen edge with
/// `.padding(.horizontal, -NeonSpace.gutter)`.
struct TasksPersonFilter: View {
    @Binding var selection: String?
    let people: [TaskPerson]

    var body: some View {
        let hues = TasksTeamHues(people)
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: NeonSpace.sm) {
                    Chip(L("Everyone"), symbol: "person.3.fill", isSelected: selection == nil) {
                        withNeonAnimation(NeonMotion.snappy) { selection = nil }
                    }
                    .id("everyone")
                    ForEach(people) { person in
                        let selected = selection == person.id
                        Button {
                            Haptic.selection()
                            withNeonAnimation(NeonMotion.snappy) { selection = selected ? nil : person.id }
                            withAnimation(NeonMotion.smooth) { proxy.scrollTo(person.id, anchor: .center) }
                        } label: {
                            TasksPersonChip(name: person.name, hue: hues.hue(person), isSelected: selected)
                                .frame(minHeight: 36)
                        }
                        .buttonStyle(PressableStyle(scale: 0.95))
                        .id(person.id)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                }
                .padding(.horizontal, NeonSpace.gutter)
                .padding(.vertical, NeonSpace.xs)
            }
        }
    }
}

// MARK: - A board step

/// One cell of the board as a chip: its state's symbol and colour, the step's
/// name, a flame when it is high priority, and a red edge and mark when it is
/// blocked. Tapping it opens the cell editor.
struct TasksCellChip: View {
    let cell: BoardCell
    let name: String
    let action: () -> Void

    var body: some View {
        let tone = taskStateTone(cell.state)
        let blocked = cell.blockedReason?.isEmpty == false
        Button {
            Haptic.tap()
            action()
        } label: {
            HStack(spacing: 5) {
                if blocked {
                    Image(systemName: "exclamationmark.octagon.fill")
                        .font(.system(.caption2, weight: .bold))
                        .foregroundStyle(Color.neonDangerStrong)
                } else if let symbol = StateBadge.symbol(for: cell.state) {
                    Image(systemName: symbol).font(.system(.caption2, weight: .bold))
                } else {
                    Circle().fill(tone.color).frame(width: 7, height: 7).neonPulse(cell.state == "IN_PROGRESS")
                }
                DirText(name, font: .system(.footnote, weight: .semibold), color: tone.foreground, fill: false, lineLimit: 1)
                if cell.priority == "HIGH" {
                    Image(systemName: "flame.fill")
                        .font(.system(.caption2, weight: .bold))
                        .foregroundStyle(Color.neonPinkStrong)
                }
            }
            .foregroundStyle(tone.foreground)
            .padding(.horizontal, 11)
            .frame(minHeight: 32)
            .background(tone.background, in: Capsule())
            .overlay(Capsule().strokeBorder(blocked ? Color.neonDanger.opacity(0.7) : tone.foreground.opacity(0.12), lineWidth: blocked ? 1.4 : 1))
            .opacity(cell.excludedFromProgress ? 0.6 : 1)
            .contentShape(Capsule())
        }
        .buttonStyle(PressableStyle(scale: 0.93))
        .accessibilityLabel(Text(verbatim: name))
        .accessibilityValue(Text([taskStateLabel(cell.state), blocked ? L("Blocked") : nil, cell.priority == "HIGH" ? L("High") : nil]
            .compactMap { $0 }.joined(separator: ", ")))
    }
}

// MARK: - Picking a state

/// The states an editor can set, as tiles: the state's own symbol on its
/// pastel, its word under it. The chosen one is washed in its colour, ticked
/// and ringed in the selection colour — so a grey Pending still reads as
/// chosen. Setting a state is immediate, as the board's own tick is, so a
/// tile shows its own spinner while the change goes through, and the editor
/// says so when it lands. Completed is asked first: it is the manager's
/// approval, and it counts in the on-time and first-time figures at once.
struct TasksStatePicker: View {
    let states: [String]
    let current: String
    let set: (String) async -> Void

    @State private var working: String?
    @State private var confirmingDone = false

    var body: some View {
        HStack(spacing: NeonSpace.sm) {
            ForEach(states, id: \.self) { state in
                tile(state)
            }
        }
        .confirmationDialog(L("Mark it completed?"), isPresented: $confirmingDone, titleVisibility: .visible) {
            Button(L("Mark completed")) { run("DONE") }
            Button(L("Cancel"), role: .cancel) {}
        } message: {
            Text(L("Completed is your approval. It counts in the on-time and first-time figures straight away."))
        }
    }

    private func run(_ state: String) {
        Haptic.selection()
        working = state
        Task {
            await set(state)
            working = nil
        }
    }

    private func tile(_ state: String) -> some View {
        let hue = tasksStateHue(state)
        let selected = state == current
        let shape = RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
        return Button {
            guard !selected, working == nil else { return }
            if state == "DONE" {
                Haptic.tap()
                confirmingDone = true
            } else {
                run(state)
            }
        } label: {
            VStack(spacing: 8) {
                ZStack {
                    IconTile(tasksStateSymbol(state), hue: hue, size: 36, style: selected ? .filled : .soft)
                    if working == state {
                        ProgressView().controlSize(.small).tint(selected ? .white : hue.deep)
                    }
                }
                Text(taskStateLabel(state))
                    .font(.system(.caption, weight: selected ? .bold : .semibold))
                    .foregroundStyle(selected ? hue.deep : Color.neonInk.opacity(0.75))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .padding(.horizontal, 6)
            .background(shape.fill(selected ? hue.wash : Color.white.opacity(0.9)))
            .overlay(shape.strokeBorder(selected ? Color.neonAccent : Color.neonLine, lineWidth: selected ? 2 : 1))
            .overlay(alignment: .topTrailing) {
                if selected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(.footnote, weight: .bold))
                        .foregroundStyle(Color.neonAccent)
                        .padding(6)
                        .transition(.neonPop)
                }
            }
            .animation(NeonMotion.snappy, value: selected)
            .contentShape(shape)
        }
        .buttonStyle(PressableStyle(scale: 0.95))
        .disabled(working != nil && working != state)
        .accessibilityLabel(Text(taskStateLabel(state)))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A state's symbol for a tile: the badge's own, and a bolt for in progress
/// (whose badge carries a live dot instead).
func tasksStateSymbol(_ state: String) -> String {
    StateBadge.symbol(for: state) ?? (state == "IN_PROGRESS" ? "bolt.fill" : "circle.dashed")
}

// MARK: - Which week, which month

/// Previous and next, the period's dates between them, and under them either
/// "This week" or a way back to it. A spinner shows while a new one loads.
struct TasksPeriodNavigator: View {
    let label: String
    let isCurrent: Bool
    let currentTitle: String
    let backTitle: String
    let previousLabel: String
    let nextLabel: String
    var loading = false
    let onPrevious: () -> Void
    let onNext: () -> Void
    let onCurrent: () -> Void

    var body: some View {
        HStack(spacing: NeonSpace.md) {
            IconButton("chevron.backward", label: previousLabel, look: .tinted, tint: .neonIndigoStrong, size: 38, action: onPrevious)
            Spacer(minLength: 0)
            VStack(spacing: 3) {
                HStack(spacing: 6) {
                    Text(label)
                        .font(.system(.headline, weight: .bold))
                        .foregroundStyle(Color.neonInk)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    if loading {
                        ProgressView().controlSize(.mini)
                            .transition(.neonPop)
                    }
                }
                if isCurrent {
                    Text(currentTitle)
                        .font(.system(.caption, weight: .semibold))
                        .foregroundStyle(Color.neonIndigoStrong)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(NeonHue.indigo.wash))
                } else {
                    Button(backTitle) {
                        Haptic.tap()
                        onCurrent()
                    }
                    .font(.system(.caption, weight: .semibold))
                    .foregroundStyle(Color.neonBlueStrong)
                }
            }
            .animation(NeonMotion.snappy, value: loading)
            Spacer(minLength: 0)
            IconButton("chevron.forward", label: nextLabel, look: .tinted, tint: .neonIndigoStrong, size: 38, action: onNext)
        }
    }
}

// MARK: - Days

/// A studio day key ("YYYY-MM-DD") as its parts, in the app's language:
/// the short weekday, the day of the month, the short month. Read in UTC, as
/// `formattedDayKey` reads it, so a day never slips in Amman's evening.
func tasksDayParts(_ key: String) -> (weekday: String, day: String, month: String) {
    guard let date = parseISODate("\(key)T00:00:00.000Z") else { return ("", key, "") }
    let locale = AppLanguage.current.locale
    let utc = TimeZone(identifier: "UTC")!
    var weekday = Date.FormatStyle(date: .omitted, time: .omitted, locale: locale).weekday(.abbreviated)
    weekday.timeZone = utc
    var day = Date.FormatStyle(date: .omitted, time: .omitted, locale: locale).day(.defaultDigits)
    day.timeZone = utc
    var month = Date.FormatStyle(date: .omitted, time: .omitted, locale: locale).month(.abbreviated)
    month.timeZone = utc
    return (date.formatted(weekday), date.formatted(day), date.formatted(month))
}

/// A studio day, short: "Sep 29" in the year `today` falls in (this year
/// when it is not given), "Sep 29, 2025" in any other. In UTC, as above.
func tasksShortDay(_ key: String, today: String? = nil) -> String {
    guard let date = parseISODate("\(key)T00:00:00.000Z") else { return key }
    let year = (today ?? NeonFormat.dayKey(Date())).prefix(4)
    var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: AppLanguage.current.locale).month(.abbreviated).day()
    if key.prefix(4) != year { style = style.year() }
    style.timeZone = TimeZone(identifier: "UTC")!
    return date.formatted(style)
}

/// A studio day key moved by whole days: "2026-09-30" by -1 is "2026-09-29".
/// In UTC, like every day key here, so no clock change moves it twice.
func tasksShiftDay(_ key: String, by days: Int) -> String {
    guard let date = parseISODate("\(key)T00:00:00.000Z") else { return key }
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = TimeZone(identifier: "UTC")!
    guard let moved = utc.date(byAdding: .day, value: days, to: date) else { return key }
    return NeonFormat.dayKey(moved, calendar: utc)
}

/// Two studio days as one range, the year said once: "Sep 27 – Oct 3, 2026".
func tasksDayRange(_ from: String, _ to: String) -> String {
    guard let start = parseISODate("\(from)T00:00:00.000Z"),
          let end = parseISODate("\(to)T00:00:00.000Z"), start <= end
    else { return "\(formattedDayKey(from)) – \(formattedDayKey(to))" }
    let style = Date.IntervalFormatStyle(date: .abbreviated, time: .omitted, locale: AppLanguage.current.locale,
                                         calendar: Calendar(identifier: .gregorian), timeZone: TimeZone(identifier: "UTC")!)
    return (start..<end).formatted(style)
}

/// Two names joined by an arrow that points the way the words read: "→"
/// between English names, "←" between Arabic ones.
func tasksArrowJoin(_ from: String, _ to: String) -> String {
    naturalDirection(from) == .rightToLeft ? "\(from) ← \(to)" : "\(from) → \(to)"
}

/// "Sunday" for a day key, in the app's language.
func tasksWeekdayName(_ key: String) -> String {
    guard let date = parseISODate("\(key)T00:00:00.000Z") else { return key }
    var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: AppLanguage.current.locale).weekday(.wide)
    style.timeZone = TimeZone(identifier: "UTC")!
    return date.formatted(style)
}

/// "Sun, Sep 27" — a day as the area's forms write it, in the app's language.
func tasksFieldDay(_ date: Date) -> String {
    date.formatted(Date.FormatStyle(date: .omitted, time: .omitted, locale: AppLanguage.current.locale)
        .weekday(.abbreviated).month(.abbreviated).day())
}

// MARK: - Forms

/// The heights a short form opens at — two or three fields: half the screen,
/// with the rest there to pull up to, rather than a full-height sheet that
/// is mostly empty.
let tasksShortSheet: Set<PresentationDetent> = [.medium, .large]

/// A day in a form: the calendar mark, then the day written out ("Sun, Sep
/// 27") right after it, and the whole field opens a calendar under itself.
/// The system's compact picker put a grey "9/27/26" capsule in the middle of
/// the field instead — two controls in one box, in a date style the rest of
/// the app never uses.
struct TasksDayField: View {
    let label: String
    @Binding var date: Date
    var range: ClosedRange<Date>?
    var hint: String?
    @Binding var isOpen: Bool

    init(_ label: String, date: Binding<Date>, in range: ClosedRange<Date>? = nil, hint: String? = nil, isOpen: Binding<Bool>) {
        self.label = label
        self._date = date
        self.range = range
        self.hint = hint
        self._isOpen = isOpen
    }

    var body: some View {
        FormField(label, hint: hint) {
            VStack(spacing: NeonSpace.sm) {
                Button {
                    Haptic.selection()
                    withNeonAnimation(NeonMotion.smooth) { isOpen.toggle() }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "calendar")
                            .font(.system(.subheadline, weight: .medium))
                            .foregroundStyle(Color.neonPurpleStrong.opacity(0.8))
                            .frame(width: 20)
                        Text(tasksFieldDay(date))
                            .font(.system(.body))
                            .foregroundStyle(Color.neonInk)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.down")
                            .font(.system(.caption, weight: .semibold))
                            .foregroundStyle(Color.neonTextTertiary)
                            .rotationEffect(.degrees(isOpen ? 180 : 0))
                    }
                    .fieldChrome(focused: isOpen)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressableStyle(scale: 0.99))
                .accessibilityLabel(Text(label))
                .accessibilityValue(Text(tasksFieldDay(date)))

                if isOpen {
                    picker
                        .datePickerStyle(.graphical)
                        .labelsHidden()
                        .tint(.neonPurpleStrong)
                        .padding(.horizontal, 4)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
        }
    }

    @ViewBuilder
    private var picker: some View {
        if let range {
            DatePicker(label, selection: $date, in: range, displayedComponents: .date)
        } else {
            DatePicker(label, selection: $date, displayedComponents: .date)
        }
    }
}

/// A text box's limit, shown only once the text is near it: a "0 / 2,000"
/// under every empty box is noise, a counter at 1,700 is useful.
func tasksLimit(_ text: String, _ limit: Int) -> Int? {
    Double(text.count) >= Double(limit) * 0.8 ? limit : nil
}

// MARK: - Work waiting on the manager

/// Work sent for review is settled in Reviews, where the proof and its checks
/// are — never by a state tile that would approve it unseen. An editor shows
/// this in place of its state tiles while the work waits there.
struct TasksSentForReview: View {
    @State private var reviewing = false

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.md) {
            StatusNote(symbol: "paperplane.fill", tone: .purple, title: L("Sent for review"),
                       detail: L("The proof waits in Reviews, with what it was checked against. Approve it or send it back there."))
            NeonButton(L("Open in Reviews"), symbol: "checkmark.seal", kind: .tinted(.neonPurpleStrong), size: .medium, fullWidth: true) {
                reviewing = true
            }
        }
        .sheet(isPresented: $reviewing) {
            TasksReviewsSheet()
        }
    }
}

/// Reviews (the home area's screen) in a sheet of its own, for an editor
/// that is itself a sheet.
struct TasksReviewsSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ReviewsRootView()
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(L("Close")) { dismiss() }
                    }
                }
        }
        .neonSheet([.large])
    }
}

// MARK: - Rows

/// A row's title — a job, a step — laid out in its own writing direction and
/// kept against the row's leading edge, beside the face or tile before it.
/// An Arabic title in an English row (or the other way round) that runs to
/// two lines lines up on the row's side too, so the words start where the
/// row's subtitle and badges start instead of leaving a gap after the face.
struct TasksRowTitle: View {
    let text: String
    var font: Font = .neonRowTitle
    var color: Color = .neonInk
    var lineLimit: Int? = 2

    init(_ text: String, font: Font = .neonRowTitle, color: Color = .neonInk, lineLimit: Int? = 2) {
        self.text = text
        self.font = font
        self.color = color
        self.lineLimit = lineLimit
    }

    var body: some View {
        let row = AppLanguage.current.layoutDirection
        let own = naturalDirection(text) ?? row
        Text(verbatim: text)
            .font(font)
            .foregroundStyle(color)
            .lineLimit(lineLimit)
            // Lines hug the row's leading side, whichever way the words run.
            .multilineTextAlignment(own == row ? .leading : .trailing)
            .environment(\.layoutDirection, own)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A run of rows drawn as one card in a `List`, so each row keeps its own
/// swipe actions: the first rounds the top corners, the last the bottom,
/// and a hairline sits between them.
enum TasksGroupPosition {
    case only, first, middle, last

    static func of(_ index: Int, in count: Int) -> TasksGroupPosition {
        if count <= 1 { return .only }
        if index == 0 { return .first }
        return index == count - 1 ? .last : .middle
    }

    var roundsTop: Bool { self == .only || self == .first }
    var roundsBottom: Bool { self == .only || self == .last }
}

/// A rectangle with only some corners rounded (iOS 16 has no
/// `UnevenRoundedRectangle`); it needs no mirroring, top and bottom being
/// the same in either direction.
struct TasksGroupShape: Shape {
    let position: TasksGroupPosition
    var radius: CGFloat = NeonRadius.lg

    func path(in rect: CGRect) -> Path {
        var corners: UIRectCorner = []
        if position.roundsTop { corners.formUnion([.topLeft, .topRight]) }
        if position.roundsBottom { corners.formUnion([.bottomLeft, .bottomRight]) }
        return Path(UIBezierPath(roundedRect: rect, byRoundingCorners: corners,
                                 cornerRadii: CGSize(width: radius, height: radius)).cgPath)
    }
}

extension View {
    /// One row of a card made of several `List` rows (`TasksGroupPosition`):
    /// the white card's slice, and a hairline above every row but the first.
    func tasksGroupedRow(_ position: TasksGroupPosition, dividerInset: CGFloat = 64) -> some View {
        self
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(TasksGroupShape(position: position).fill(Color.white.opacity(0.92)))
            .overlay(alignment: .top) {
                if !position.roundsTop {
                    NeonDivider().padding(.leading, dividerInset)
                }
            }
            .contentShape(TasksGroupShape(position: position))
    }
}

// MARK: - The header's account button

/// The kit's account menu (language, sign out) behind a face the size of the
/// header's other round buttons — 44 pt, as on Home — rather than the kit's
/// 30 pt one, which sat smaller and lower than its neighbours and below the
/// touch target.
struct TasksAccountMenu: View {
    @EnvironmentObject var api: APIClient
    @State private var confirmSignOut = false

    var body: some View {
        Menu {
            if let identity = api.identity {
                Section(identity.side == .admin ? L("Manager") : identity.name) {}
            }
            Button {
                Haptic.tap()
                AppLanguage.toggle()
            } label: {
                Label(AppLanguage.current == .arabic ? "English" : "العربية", systemImage: "globe")
            }
            Button(role: .destructive) {
                confirmSignOut = true
            } label: {
                Label(L("Sign Out"), systemImage: "rectangle.portrait.and.arrow.right")
            }
        } label: {
            AvatarView(url: facePhotoURL(api.myPhoto), name: accountName, size: NeonSize.circleButton, ring: true)
                .neonShadow(.low)
                .frame(width: NeonSize.touch, height: NeonSize.touch)
                .contentShape(Circle())
        }
        .accessibilityLabel(L("Account"))
        .confirmationDialog(L("Sign out of NEON?"), isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button(L("Sign Out"), role: .destructive) { api.logout() }
            Button(L("Cancel"), role: .cancel) {}
        }
    }

    /// Their own initials for somebody on the team; the studio's "N" for the manager.
    private var accountName: String {
        guard let identity = api.identity, identity.side == .employee, !identity.name.isEmpty else { return "NEON" }
        return identity.name
    }
}
