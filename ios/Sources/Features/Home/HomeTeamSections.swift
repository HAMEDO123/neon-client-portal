import SwiftUI

// The team, below the studio's figures: "Right now" (home/now — who is on
// what, and for how long) and "The day" (home/day — the day board, most
// pressing first). Neither ever reads silence as idleness: somebody with no
// block and nothing in progress is "Nothing planned right now", and an
// unanswered question is counted as a question, not a verdict.

// MARK: - Right now

struct HomeRightNowCard: View {
    let now: HomeNow?
    let error: String?
    let retry: () async -> Void
    let onPerson: (String) -> Void

    var body: some View {
        SectionCard(
            L("Right now"), subtitle: L("Who is on what, and for how long"),
            symbol: "dot.radiowaves.left.and.right", hue: .green, spacing: 8
        ) {
            if let now {
                if now.people.isEmpty {
                    HomeInlineEmpty(
                        symbol: "person.2",
                        title: L("No employees yet"),
                        detail: L("Add the team, and their day appears here."),
                        hue: .green
                    )
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(now.people.enumerated()), id: \.element.id) { index, person in
                            if index > 0 { NeonDivider().padding(.leading, 58) }
                            HomeRightNowRow(person: person) { onPerson(person.id) }
                                .staggered(index)
                        }
                    }
                }
            } else if let error {
                HomeInlineError(message: error, retry: retry)
            } else {
                VStack(spacing: 14) {
                    ForEach(0..<3, id: \.self) { _ in
                        HStack(spacing: 12) {
                            Circle().fill(Color.neonInk.opacity(0.07)).frame(width: 44, height: 44)
                            VStack(alignment: .leading, spacing: 8) {
                                SkeletonBlock(height: 12).frame(maxWidth: 120)
                                SkeletonBlock(height: 10).frame(maxWidth: 190)
                            }
                            Spacer(minLength: 0)
                        }
                    }
                }
                .padding(.vertical, 6)
                .shimmer()
            }
        }
        .neonAppear()
    }
}

/// One employee, right now: the block their published day plan says they
/// are on, and/or whatever board cell or hand-assigned job they have
/// IN_PROGRESS — the two can agree, run ahead of each other, or disagree —
/// plus what is next.
struct HomeRightNowRow: View {
    let person: HomeNowPerson
    let onTap: () -> Void

    var body: some View {
        Button {
            Haptic.tap()
            onTap()
        } label: {
            HStack(alignment: .top, spacing: NeonSpace.md) {
                AvatarView(url: resolvedMediaURL(person.avatar), name: person.name, size: 44, online: person.online)
                VStack(alignment: .leading, spacing: 5) {
                    DirText(person.name, font: .neonRowTitle, fill: false, lineLimit: 1)
                    activity
                    if let next = person.next {
                        HStack(spacing: 5) {
                            Image(systemName: "arrow.turn.down.right")
                                .font(.system(.caption2, weight: .semibold))
                                .foregroundStyle(Color.neonTextFaint)
                                .flipsForRightToLeftLayoutDirection(true)
                            DirText(L("Next: %@ at %@", next.what, next.from), font: .neonMeta, color: .neonTextTertiary, fill: false, lineLimit: 2)
                        }
                    }
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.forward")
                    .font(.system(.footnote, weight: .semibold))
                    .foregroundStyle(Color.neonTextFaint)
                    .padding(.top, 4)
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressableCard)
    }

    @ViewBuilder
    private var activity: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let now = person.now {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Circle().fill(Color.neonSuccess).frame(width: 7, height: 7).neonPulse()
                    VStack(alignment: .leading, spacing: 1) {
                        DirText(now.what, font: .system(.subheadline, weight: .semibold), fill: false, lineLimit: 2)
                        Text(now.leftMinutes.map { L("%@–%@ · %@ left", now.from, now.to, describeMinutes(Double($0))) } ?? L("%@–%@", now.from, now.to))
                            .font(.neonMeta)
                            .foregroundStyle(Color.neonTextSecondary)
                    }
                }
            }

            ForEach(person.inProgress) { item in
                HStack(alignment: .top, spacing: 8) {
                    IconTile(item.kind == "job" ? "bolt.fill" : "checklist", hue: .purple, size: 24)
                    VStack(alignment: .leading, spacing: 1) {
                        DirText(
                            item.projectName.map { "\(item.title) · \($0)" } ?? item.title,
                            font: .system(.subheadline, weight: .semibold), fill: false, lineLimit: 2
                        )
                        Text(item.minutes.map { L("for %@", describeMinutes(Double($0))) } ?? L("In progress"))
                            .font(.neonMeta)
                            .foregroundStyle(Color.neonTextSecondary)
                    }
                }
            }

            if person.now == nil && person.inProgress.isEmpty {
                Text(neutralState)
                    .font(.system(.subheadline))
                    .foregroundStyle(Color.neonTextTertiary)
            }
        }
    }

    private var neutralState: String {
        if person.beforeWork { return L("The day hasn't started yet") }
        if person.afterWork { return L("Outside working hours") }
        return L("Nothing planned right now")
    }
}

// MARK: - The day

struct HomeDayCard: View {
    let day: HomeDay?
    let error: String?
    let retry: () async -> Void
    let onPerson: (String) -> Void

    var body: some View {
        SectionCard(
            L("The day"), subtitle: day.map { longDayLabel($0.dayKey) },
            symbol: "calendar.day.timeline.leading", hue: .indigo
        ) {
            if let day {
                if !day.everyone.isEmpty {
                    HomeTeamDayRow(people: day.everyone, onTap: onPerson)
                }
                HomeDaySummary(summary: day.summary)
                HomeDayPressing(days: day.pressing, dayLabel: longDayLabel(day.dayKey))
                Text(L("An unanswered question is a question, not a verdict: nobody here is marked as having done nothing."))
                    .font(.neonMeta)
                    .foregroundStyle(Color.neonTextTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let error {
                HomeInlineError(message: error, retry: retry)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    SkeletonBlock(height: 54)
                    SkeletonBlock(height: 120, radius: NeonRadius.md)
                }
                .shimmer()
            }
        }
        .neonAppear()
    }
}

/// The team's day as a row of avatars ringed by how it is going — planned
/// (quiet), blocked or a mismatch (red), waiting on the manager or
/// overloaded (amber), and unanswered (grey: a silence, never a verdict).
struct HomeTeamDayRow: View {
    let people: [HomePersonDay]
    let onTap: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: NeonSpace.sm) {
                ForEach(Array(people.enumerated()), id: \.element.id) { index, person in
                    Button {
                        Haptic.tap()
                        onTap(person.employeeId)
                    } label: {
                        VStack(spacing: 6) {
                            ZStack {
                                Circle()
                                    .stroke(homeDayTone(person.describeKind), lineWidth: 2.5)
                                    .frame(width: 56, height: 56)
                                AvatarView(url: nil, name: person.name, size: 48)
                            }
                            DirText(person.name, font: .system(.caption, weight: .semibold), fill: false, lineLimit: 1)
                                .frame(width: 76)
                            Text(describeDayKind(
                                person.describeKind,
                                blocked: person.blocked.count,
                                contradictions: person.contradictions.count,
                                waiting: person.needsManager.count,
                                unanswered: person.unanswered
                            ))
                            .font(.system(.caption2, weight: .medium))
                            .foregroundStyle(homeDayTone(person.describeKind))
                            .lineLimit(2)
                            .minimumScaleFactor(0.8)
                            .multilineTextAlignment(.center)
                            .frame(width: 76)
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.pressable)
                    .staggered(index)
                }
            }
            .padding(.horizontal, NeonSpace.card)
        }
        .padding(.horizontal, -NeonSpace.card)
    }
}

/// A colour for `describeKind` — the same judgement the pressing list and
/// `describeDayKind` read, as a ring instead of a sentence. "unanswered"
/// stays a quiet grey on purpose: it is a silence, not a fault.
func homeDayTone(_ kind: String) -> Color {
    switch kind {
    case "blocked", "contradiction": return .neonDangerStrong
    case "waiting", "overloaded", "unplanned": return .neonWarningStrong
    case "allStarted": return .neonSuccessStrong
    default: return .neonTextTertiary
    }
}

/// The day board's six counts (`summarise` in day-board.ts), three to a row.
struct HomeDaySummary: View {
    let summary: DaySummary

    private struct Tile {
        let title: String
        let value: Int
        let symbol: String
        let hue: NeonHue
        let alert: Bool
    }

    var body: some View {
        let tiles: [Tile] = [
            Tile(title: L("On the day"), value: summary.planned, symbol: "checkmark.circle.fill", hue: .green, alert: false),
            Tile(title: L("No plan yet"), value: summary.unplanned, symbol: "calendar.badge.exclamationmark", hue: .amber, alert: summary.unplanned > 0),
            Tile(title: L("Blocked"), value: summary.blocked, symbol: "pause.circle.fill", hue: .red, alert: summary.blocked > 0),
            Tile(title: L("Said started"), value: summary.contradictions, symbol: "exclamationmark.triangle.fill", hue: .red, alert: summary.contradictions > 0),
            Tile(title: L("Overloaded"), value: summary.overloaded, symbol: "clock.badge.exclamationmark.fill", hue: .amber, alert: summary.overloaded > 0),
            // Unanswered is never coloured as a fault.
            Tile(title: L("Unanswered"), value: summary.unanswered, symbol: "questionmark.circle.fill", hue: .grey, alert: false),
        ]
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: NeonSpace.sm), count: 3), spacing: NeonSpace.sm) {
            ForEach(Array(tiles.enumerated()), id: \.offset) { index, tile in
                VStack(alignment: .leading, spacing: 6) {
                    IconTile(tile.symbol, hue: tile.alert ? tile.hue : (tile.hue == .grey ? .grey : .indigo), size: 28, style: tile.alert ? .filled : .soft)
                    HomeCountUp(value: tile.value, font: .system(.title3, weight: .bold))
                    Text(tile.title)
                        .font(.neonMeta)
                        .foregroundStyle(Color.neonTextSecondary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(10)
                .background(
                    RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
                        .fill(tile.alert ? tile.hue.wash : NeonHue.grey.wash.opacity(0.6))
                )
                .accessibilityElement(children: .combine)
                .staggered(index)
            }
        }
    }
}

/// The people whose day needs the manager, in the day board's order.
struct HomeDayPressing: View {
    let days: [HomePersonDay]
    let dayLabel: String

    var body: some View {
        if days.isEmpty {
            HStack(spacing: 10) {
                Image(systemName: "checkmark.seal.fill")
                    .foregroundStyle(Color.neonSuccess)
                Text(L("Nothing on %@ needs you right now.", dayLabel))
                    .font(.neonLabel)
                    .foregroundStyle(Color.neonTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous).fill(NeonHue.green.wash))
        } else {
            VStack(spacing: NeonSpace.sm) {
                ForEach(days) { person in
                    HomePressingPerson(person: person)
                }
            }
        }
    }
}

struct HomePressingPerson: View {
    let person: HomePersonDay

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                HStack(spacing: 8) {
                    Circle().fill(employeeFill(person.color)).frame(width: 8, height: 8)
                    DirText(person.name, font: .neonRowTitle, fill: false, lineLimit: 1)
                }
                Spacer(minLength: 8)
                Text(describeDayKind(
                    person.describeKind,
                    blocked: person.blocked.count,
                    contradictions: person.contradictions.count,
                    waiting: person.needsManager.count,
                    unanswered: person.unanswered
                ))
                .font(.neonMeta)
                .foregroundStyle(homeDayTone(person.describeKind))
                .multilineTextAlignment(.trailing)
            }

            if person.overloaded {
                Label(
                    L("%@ more than the day holds (%@ planned, %@ available)",
                      describeMinutes(Double(person.overBy)),
                      describeMinutes(Double(person.plannedMinutes)),
                      describeMinutes(Double(person.capacityMinutes))),
                    systemImage: "clock.fill"
                )
                .font(.neonMeta)
                .foregroundStyle(Color.neonWarningStrong)
            }

            ForEach(person.blocked) { row in
                note(symbol: "pause.circle.fill", hue: .red) {
                    DirText(row.taskName, font: .system(.footnote, weight: .semibold), color: .neonDangerStrong)
                    DirText(
                        row.who.map { "\(row.reason) — \(L("%@ can clear it", $0))" } ?? row.reason,
                        font: .neonMeta, color: .neonTextSecondary
                    )
                }
            }

            ForEach(person.contradictions) { row in
                note(symbol: "exclamationmark.triangle.fill", hue: .orange) {
                    DirText(L("%@: said started, the board still says pending", row.taskName), font: .system(.footnote), color: .neonTextSecondary)
                }
            }

            ForEach(person.needsManager) { row in
                note(symbol: "exclamationmark.circle.fill", hue: .amber) {
                    DirText("\(row.taskName ?? L("Their day")) — \(describeManagerAnswer(row.answer))", font: .system(.footnote, weight: .semibold), color: .neonWarningStrong)
                    if let note = row.note {
                        DirText(note, font: .neonMeta, color: .neonTextSecondary)
                    }
                }
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
                .fill(Color.neonSurfaceSunken.opacity(0.7))
        )
        .overlay(
            RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
                .strokeBorder(Color.neonLine, lineWidth: 1)
        )
    }

    private func note<Content: View>(symbol: String, hue: NeonHue, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: symbol)
                .font(.system(.footnote, weight: .semibold))
                .foregroundStyle(hue.deep)
            VStack(alignment: .leading, spacing: 2) { content() }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous).fill(hue.wash))
    }
}
