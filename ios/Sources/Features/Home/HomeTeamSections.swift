import SwiftUI

// The team, below the studio's figures: one card that holds what used to be
// two ("Right now" and "The day"). A single row of people — each ringed by
// how their day is going (home/day), with the one thing they are on under
// their name (home/now) — then the day board's counts that aren't zero, the
// notes that need the manager, and the footnote when a question is unanswered.
// Neither half ever reads silence as idleness: somebody with no block and
// nothing in progress is "Nothing planned right now", and an unanswered
// question is counted as a question, not a verdict.

// MARK: - One person, from both reads

/// Somebody on the team as the card draws them: what home/now says they are
/// on and how home/day judges their day. Either half can be missing while it
/// loads or when its read failed.
struct HomeTeamMember: Identifiable {
    let id: String
    let name: String
    let now: HomeNowPerson?
    let day: HomePersonDay?

    var online: Bool { now?.online ?? false }
    var kind: String? { day?.describeKind }
    /// Their face from either read, or nil for initials.
    var photo: URL? { facePhotoURL(now?.photo ?? day?.photo) }
    /// Only home/now knows whether the working day has begun; unknown reads
    /// as "it has", so nothing is hidden while that read is missing.
    var beforeWork: Bool { now?.beforeWork ?? false }

    /// Their IN_PROGRESS work, the most recently started first; work whose
    /// start was never recorded goes last.
    var inProgress: [HomeInProgressItem] {
        (now?.inProgress ?? []).sorted { first, second in
            switch (parseISODate(first.startedAt), parseISODate(second.startedAt)) {
            case let (a?, b?): return a > b
            case (.some, .none): return true
            default: return false
            }
        }
    }
}

/// Everybody in either read, in the day board's order (the order the manager
/// set), and anyone home/now has that the board doesn't, after them.
func homeTeamMembers(now: HomeNow?, day: HomeDay?) -> [HomeTeamMember] {
    let nowById = Dictionary((now?.people ?? []).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    let dayById = Dictionary((day?.everyone ?? []).map { ($0.employeeId, $0) }, uniquingKeysWith: { first, _ in first })
    var ids: [String] = []
    for person in day?.everyone ?? [] where !ids.contains(person.employeeId) { ids.append(person.employeeId) }
    for person in now?.people ?? [] where !ids.contains(person.id) { ids.append(person.id) }
    return ids.map { id in
        HomeTeamMember(id: id, name: nowById[id]?.name ?? dayById[id]?.name ?? "", now: nowById[id], day: dayById[id])
    }
}

// MARK: - The card

struct HomeTeamCard: View {
    let now: HomeNow?
    let nowError: String?
    let day: HomeDay?
    let dayError: String?
    /// The studio's timezone, for "since Thu 10 Sep".
    let timezone: String?
    let retryNow: () async -> Void
    let retryDay: () async -> Void
    let onPerson: (String) -> Void

    private var members: [HomeTeamMember] { homeTeamMembers(now: now, day: day) }

    var body: some View {
        SectionCard(
            L("Right now"), subtitle: L("What each person is on"),
            symbol: "dot.radiowaves.left.and.right", hue: .green
        ) {
            let members = self.members
            if now == nil && day == nil {
                if let error = nowError ?? dayError {
                    HomeInlineError(message: error) {
                        async let nowTask: Void = retryNow()
                        async let dayTask: Void = retryDay()
                        _ = await (nowTask, dayTask)
                    }
                } else {
                    skeleton
                }
            } else if members.isEmpty {
                HomeInlineEmpty(
                    symbol: "person.2",
                    title: L("No employees yet"),
                    detail: L("Add the team, and their day appears here."),
                    hue: .green
                )
            } else {
                HomeTeamRow(
                    members: members,
                    uniformKind: uniformKind(members),
                    timezone: timezone,
                    onTap: onPerson
                )
                if let nowError, now == nil {
                    HomeInlineError(message: nowError, retry: retryNow)
                }
                if let day {
                    HomeDayFooter(day: day, members: members, uniformKind: uniformKind(members))
                        .id("day")
                } else if let dayError {
                    HomeInlineError(message: dayError, retry: retryDay)
                }
            }
        }
        .neonAppear()
    }

    /// The one judgement everybody's day shares, when it is the same for all
    /// of them — said once under the row instead of under every face.
    private func uniformKind(_ members: [HomeTeamMember]) -> String? {
        let kinds = members.compactMap(\.kind)
        guard members.count > 1, kinds.count == members.count, let first = kinds.first,
              kinds.allSatisfy({ $0 == first })
        else { return nil }
        return first
    }

    private var skeleton: some View {
        HStack(alignment: .top, spacing: NeonSpace.sm) {
            ForEach(0..<4, id: \.self) { _ in
                VStack(spacing: 8) {
                    Circle().fill(Color.neonInk.opacity(0.07)).frame(width: 52, height: 52)
                    SkeletonBlock(height: 10).frame(maxWidth: 50)
                    SkeletonBlock(height: 8).frame(maxWidth: 64)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.vertical, 6)
        .shimmer()
    }
}

// MARK: - The row of people

/// The team as one row: a ringed avatar each, the name, the day's judgement
/// when it differs between people, and the one thing each person is on.
/// Four or fewer share the card's width; more scroll sideways.
struct HomeTeamRow: View {
    let members: [HomeTeamMember]
    let uniformKind: String?
    let timezone: String?
    let onTap: (String) -> Void

    var body: some View {
        if members.count <= 4 {
            HStack(alignment: .top, spacing: NeonSpace.sm) {
                columns(width: nil)
            }
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: NeonSpace.sm) {
                    columns(width: 86)
                }
                .padding(.horizontal, NeonSpace.card)
            }
            .padding(.horizontal, -NeonSpace.card)
        }
    }

    private func columns(width: CGFloat?) -> some View {
        ForEach(Array(members.enumerated()), id: \.element.id) { index, member in
            Button {
                Haptic.tap()
                onTap(member.id)
            } label: {
                HomeTeamColumn(member: member, showsKind: showsKind(member), timezone: timezone)
                    .frame(width: width)
                    .frame(maxWidth: width == nil ? .infinity : nil, alignment: .top)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.pressable)
            .staggered(index)
        }
    }

    /// The calm default says nothing; a judgement everybody shares is said
    /// once, under the row.
    private func showsKind(_ member: HomeTeamMember) -> Bool {
        guard let kind = member.kind, kind != "onTheDay" else { return false }
        if let uniformKind, uniformKind == "unplanned" || uniformKind == "onTheDay" { return false }
        return true
    }
}

/// One person in the row. At most two lines of what they are on: their plan's
/// current block (with its pulsing dot) or the work they most recently
/// started, and a count of the rest.
struct HomeTeamColumn: View {
    let member: HomeTeamMember
    let showsKind: Bool
    let timezone: String?

    private var kindText: String? {
        guard showsKind, let day = member.day else { return nil }
        return describeDayKind(
            day.describeKind,
            blocked: day.blocked.count,
            contradictions: day.contradictions.count,
            waiting: day.needsManager.count,
            unanswered: day.unanswered
        )
    }

    var body: some View {
        VStack(spacing: 5) {
            ZStack {
                Circle()
                    .strokeBorder(homeDayRing(member.kind, beforeWork: member.beforeWork), lineWidth: 2.5)
                    .frame(width: 56, height: 56)
                AvatarView(url: member.photo, name: member.name, size: 46, online: member.online)
            }
            .padding(.bottom, 1)

            DirText(member.name, font: .system(.caption, weight: .semibold), fill: false, lineLimit: 1)

            if let kindText {
                Text(kindText)
                    .font(.system(.caption2, weight: .semibold))
                    .foregroundStyle(homeDayText(member.kind, beforeWork: member.beforeWork))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                    .fixedSize(horizontal: false, vertical: true)
            }

            activity
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .padding(.vertical, 2)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: member.name))
        .accessibilityValue(Text(spoken))
        .accessibilityAddTraits(.isButton)
    }

    // MARK: What they are on

    @ViewBuilder
    private var activity: some View {
        if let now = member.now {
            let work = member.inProgress
            if let block = now.now {
                title(block.what, color: .neonInk)
                HStack(spacing: 4) {
                    Circle().fill(Color.neonSuccess).frame(width: 6, height: 6).neonPulse()
                    meta(L("until %@", block.to))
                }
                // Everything in progress is "more" beside the plan's block:
                // the same capsule, the same words, as everybody else's.
                if !work.isEmpty {
                    more(L("+%d more", work.count), spoken: L("%d more in progress", work.count))
                }
            } else if let first = work.first {
                title(first.projectName.map { "\(first.title) · \($0)" } ?? first.title, color: .neonInk)
                meta(homeElapsed(first, timezone: timezone))
                if work.count > 1 {
                    more(L("+%d more", work.count - 1), spoken: L("%d more in progress", work.count - 1))
                }
            } else {
                title(neutralState(now), color: .neonTextTertiary, lines: 3)
                if let next = now.next {
                    meta(L("Next at %@", next.from))
                }
            }
        }
    }

    private func title(_ text: String, color: Color, lines: Int = 2) -> some View {
        Text(verbatim: text)
            .font(.system(.caption, weight: .medium))
            .foregroundStyle(color)
            .multilineTextAlignment(.center)
            .lineLimit(lines)
            .fixedSize(horizontal: false, vertical: true)
            // Somebody's Arabic title in the English app (or the reverse)
            // wraps in its own direction; centred, it sits the same either way.
            .environment(\.layoutDirection, naturalDirection(text) ?? AppLanguage.current.layoutDirection)
    }

    private func meta(_ text: String) -> some View {
        Text(text)
            .font(.system(.caption2))
            .foregroundStyle(Color.neonTextTertiary)
            .multilineTextAlignment(.center)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
    }

    /// The rest of their in-progress work, as one small capsule — the same
    /// look as Today's Tasks' "N more today". The whole column opens their page.
    private func more(_ text: String, spoken: String) -> some View {
        Text(text)
            .font(.system(.caption2, weight: .semibold))
            .foregroundStyle(Color.neonPurpleStrong)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(NeonHue.purple.wash))
            .padding(.top, 2)
            .accessibilityLabel(Text(spoken))
    }

    private func neutralState(_ now: HomeNowPerson) -> String {
        if now.beforeWork { return L("The day hasn't started yet") }
        if now.afterWork { return L("Outside working hours") }
        return L("Nothing planned right now")
    }

    private var spoken: String {
        var parts: [String] = []
        if let kindText { parts.append(kindText) }
        if let now = member.now {
            let work = member.inProgress
            if let block = now.now {
                parts.append(block.what)
                parts.append(L("until %@", block.to))
                if !work.isEmpty { parts.append(L("%d more in progress", work.count)) }
            } else if let first = work.first {
                parts.append(first.projectName.map { "\(first.title) · \($0)" } ?? first.title)
                parts.append(homeElapsed(first, timezone: timezone))
                if work.count > 1 { parts.append(L("%d more in progress", work.count - 1)) }
            } else {
                parts.append(neutralState(now))
            }
        }
        return parts.joined(separator: ", ")
    }
}

/// How long something has been in progress. Within a working day that is the
/// time since it started ("for 3h 12m"); past a day, a count of hours reads
/// as somebody working non-stop, so it becomes the day it started
/// ("since Thu 10 Sep").
func homeElapsed(_ item: HomeInProgressItem, timezone: String?) -> String {
    guard let minutes = item.minutes else { return L("In progress") }
    if minutes >= 24 * 60, let started = homeShortDate(item.startedAt, timezone: timezone) {
        return L("since %@", started)
    }
    return L("for %@", describeMinutes(Double(minutes)))
}

/// "Thu 10 Sep" for a moment, on the studio's calendar.
func homeShortDate(_ iso: String?, timezone: String?) -> String? {
    guard let date = parseISODate(iso) else { return nil }
    var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: AppLanguage.current.locale)
    style.timeZone = timezone.flatMap(TimeZone.init(identifier:)) ?? .current
    style = style.weekday(.abbreviated).day().month(.abbreviated)
    return date.formatted(style)
}

// MARK: - The day, under the row

/// What the day board adds under the people: its counts that aren't zero,
/// the one sentence everybody shares, the notes that need the manager, and
/// — only when a question is unanswered — the reminder that silence is not
/// a verdict.
struct HomeDayFooter: View {
    let day: HomeDay
    let members: [HomeTeamMember]
    let uniformKind: String?

    private var everyoneBeforeWork: Bool { !members.isEmpty && members.allSatisfy(\.beforeWork) }

    /// People whose day carries something to act on — not only "no plan",
    /// which the row and the line under it already say.
    private var notes: [HomePersonDay] {
        day.pressing.filter { !$0.blocked.isEmpty || !$0.contradictions.isEmpty || !$0.needsManager.isEmpty || $0.overloaded }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.md) {
            if uniformKind == "unplanned" {
                HStack(spacing: 8) {
                    Image(systemName: "calendar.badge.clock")
                        .font(.system(.subheadline, weight: .semibold))
                        .foregroundStyle(everyoneBeforeWork ? Color.neonTextTertiary : NeonHue.amber.deep)
                    Text(L("No plan published for today yet"))
                        .font(.neonLabel)
                        .foregroundStyle(Color.neonTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
            }

            HomeDaySummary(summary: day.summary, saidAbove: uniformKind == "unplanned" ? ["unplanned"] : [])

            if !notes.isEmpty {
                VStack(spacing: NeonSpace.sm) {
                    ForEach(notes) { person in
                        HomePressingPerson(person: person)
                    }
                }
            } else if day.pressing.isEmpty {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(Color.neonSuccess)
                    Text(L("Nothing on %@ needs you right now.", longDayLabel(day.dayKey)))
                        .font(.neonLabel)
                        .foregroundStyle(Color.neonTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous).fill(NeonHue.green.wash))
            }

            if day.summary.unanswered > 0 {
                Text(L("An unanswered question is a question, not a verdict: nobody here is marked as having done nothing."))
                    .font(.neonMeta)
                    .foregroundStyle(Color.neonTextTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// The ring round a person's face: the day's judgement in the plain token
/// (fills in plain, text in Strong). No plan before the working day starts
/// is the manager's to-do, not the person's fault, so it stays quiet then.
func homeDayRing(_ kind: String?, beforeWork: Bool) -> Color {
    switch kind {
    case "blocked", "contradiction": return .neonDanger
    case "waiting", "overloaded": return .neonWarning
    case "unplanned": return beforeWork ? Color.neonTextTertiary.opacity(0.45) : .neonWarning
    case "allStarted": return .neonSuccess
    default: return Color.neonTextTertiary.opacity(0.45)
    }
}

/// The same judgement as words: the Strong token. "unanswered" stays a
/// quiet grey on purpose — it is a silence, not a fault.
func homeDayText(_ kind: String?, beforeWork: Bool) -> Color {
    switch kind {
    case "blocked", "contradiction": return .neonDangerStrong
    case "waiting", "overloaded": return .neonWarningStrong
    case "unplanned": return beforeWork ? .neonTextTertiary : .neonWarningStrong
    case "allStarted": return .neonSuccessStrong
    default: return .neonTextTertiary
    }
}

/// The day board's six counts (`summarise` in day-board.ts) — only the ones
/// that aren't zero, as the kit's badges, each in its own tone whatever its
/// value: a grid of mostly zeros said nothing, and a tile repainted at zero
/// changed what its colour meant.
struct HomeDaySummary: View {
    let summary: DaySummary
    /// Counts already said in words above, left out here.
    var saidAbove: Set<String> = []

    private struct Count: Identifiable {
        let id: String
        let text: String
        let symbol: String
        let tone: BadgeTone
    }

    private var counts: [Count] {
        var counts: [Count] = []
        func add(_ id: String, _ count: Int, _ text: String, _ symbol: String, _ tone: BadgeTone) {
            guard count > 0, !saidAbove.contains(id) else { return }
            counts.append(Count(id: id, text: text, symbol: symbol, tone: tone))
        }
        add("planned", summary.planned, L("%d on the day", summary.planned), "checkmark", .success)
        add("unplanned", summary.unplanned, L("%d without a plan", summary.unplanned), "calendar", .warning)
        add("blocked", summary.blocked, L("%d blocked", summary.blocked), "pause.fill", .danger)
        add("contradictions", summary.contradictions, L("%d said started", summary.contradictions), "exclamationmark", .orange)
        add("overloaded", summary.overloaded, L("%d overloaded", summary.overloaded), "clock.fill", .warning)
        // Unanswered is never coloured as a fault.
        add("unanswered", summary.unanswered, L("%d unanswered", summary.unanswered), "questionmark", .neutral)
        return counts
    }

    var body: some View {
        let counts = self.counts
        if !counts.isEmpty {
            FlowRow(spacing: NeonSpace.sm) {
                ForEach(Array(counts.enumerated()), id: \.element.id) { index, count in
                    BadgeView(text: count.text, tone: count.tone, symbol: count.symbol)
                        .staggered(index)
                }
            }
        }
    }
}

// MARK: - What needs the manager

struct HomePressingPerson: View {
    let person: HomePersonDay

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                HStack(spacing: 8) {
                    // Their face where they have one; their colour's dot
                    // otherwise, as this list has always drawn them.
                    if let photo = facePhotoURL(person.photo) {
                        AvatarView(url: photo, name: person.name, size: 22)
                    } else {
                        Circle().fill(employeeFill(person.color)).frame(width: 8, height: 8)
                    }
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
                .foregroundStyle(homeDayText(person.describeKind, beforeWork: false))
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
