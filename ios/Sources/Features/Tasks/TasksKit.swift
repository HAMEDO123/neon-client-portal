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

/// The dot a hue leaves in a legend; grey stays a quiet grey rather than
/// vanishing into the card.
private func tasksDotColor(_ hue: NeonHue) -> Color { hue == .grey ? hue.gradient[1] : hue.color }

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
                                Text(part.label)
                                    .font(.neonSubtitle)
                                    .foregroundStyle(Color.neonTextSecondary)
                                    .lineLimit(2)
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
/// chips — the person's initials on their own colour, as everywhere else in
/// the app. Bleed it to the screen edge with `.padding(.horizontal, -NeonSpace.gutter)`.
struct TasksPersonFilter: View {
    @Binding var selection: String?
    let people: [TaskPerson]

    var body: some View {
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
                            PersonChip(name: person.name, subtitle: nil, isSelected: selected)
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
/// pastel, its word under it. The chosen one is washed in its colour and
/// ticked. Setting a state is immediate — it is not part of the form's Save —
/// so a tile shows its own spinner while the change goes through.
struct TasksStatePicker: View {
    let states: [String]
    let current: String
    let set: (String) async -> Void

    @State private var working: String?

    var body: some View {
        HStack(spacing: NeonSpace.sm) {
            ForEach(states, id: \.self) { state in
                tile(state)
            }
        }
    }

    private func tile(_ state: String) -> some View {
        let hue = tasksStateHue(state)
        let selected = state == current
        let shape = RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
        return Button {
            guard !selected, working == nil else { return }
            Haptic.selection()
            working = state
            Task {
                await set(state)
                working = nil
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
            .overlay(shape.strokeBorder(selected ? hue.color.opacity(0.45) : Color.neonLine, lineWidth: selected ? 1.5 : 1))
            .overlay(alignment: .topTrailing) {
                if selected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(.footnote, weight: .bold))
                        .foregroundStyle(hue.deep)
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

/// "Sunday" for a day key, in the app's language.
func tasksWeekdayName(_ key: String) -> String {
    guard let date = parseISODate("\(key)T00:00:00.000Z") else { return key }
    var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: AppLanguage.current.locale).weekday(.wide)
    style.timeZone = TimeZone(identifier: "UTC")!
    return date.formatted(style)
}

// MARK: - Adding

/// The last row of a list in the process settings: a dashed card that adds
/// one more.
struct TasksAddRow: View {
    let title: String
    var hue: NeonHue = .indigo

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous)
        HStack(spacing: 10) {
            Image(systemName: "plus")
                .font(.system(.subheadline, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(Circle().fill(hue.fill))
            Text(title)
                .font(.system(.subheadline, weight: .semibold))
                .foregroundStyle(hue.deep)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 52)
        .background(shape.fill(hue.wash.opacity(0.7)))
        .overlay(shape.strokeBorder(hue.color.opacity(0.35), style: StrokeStyle(lineWidth: 1.2, dash: [5, 4])))
        .contentShape(shape)
    }
}
