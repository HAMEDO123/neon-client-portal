import SwiftUI

// "Today's Tasks": what is really on the studio's calendar today (home/today)
// — board steps scheduled or due today, jobs running today, meetings starting
// today. The circle on a row only shows the board's state (a green tick is
// work the manager approved as done); nothing here changes a state, because
// nobody marks work done from a list — proof goes to review.

struct HomeTodayCard: View {
    let today: HomeToday?
    let error: String?
    let retry: () async -> Void
    let onOpen: (HomeTodayItem) -> Void
    let onViewAll: () -> Void

    private let shown = 4

    var body: some View {
        SectionCard(
            L("Today's Tasks"), symbol: "checkmark.square.fill", hue: .blue, tileStyle: .filled,
            spacing: 6, action: onViewAll
        ) {
            if let today {
                if today.items.isEmpty {
                    HomeInlineEmpty(
                        symbol: "sun.max",
                        title: L("Nothing planned for today"),
                        detail: L("No board steps, jobs or meetings are on today's calendar."),
                        hue: .blue
                    )
                    .padding(.top, 6)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(today.items.prefix(shown).enumerated()), id: \.element.id) { index, item in
                            if index > 0 { NeonDivider().padding(.leading, 60) }
                            HomeTodayRow(item: item, timezone: today.timezone) { onOpen(item) }
                                .padding(.horizontal, -14)
                                .staggered(index)
                        }
                    }
                    if today.items.count > shown {
                        Button {
                            Haptic.tap()
                            onViewAll()
                        } label: {
                            Text(L("%d more today", today.items.count - shown))
                                .font(.system(.footnote, weight: .semibold))
                                .foregroundStyle(Color.neonBlueStrong)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                                .background(Capsule().fill(NeonHue.blue.wash))
                        }
                        .buttonStyle(.pressable)
                        .padding(.top, 6)
                    }
                }
            } else if let error {
                HomeInlineError(message: error, retry: retry)
                    .padding(.top, 6)
            } else {
                VStack(spacing: 14) {
                    ForEach(0..<3, id: \.self) { _ in
                        HStack(spacing: 12) {
                            SkeletonBlock(width: 46, height: 46, radius: NeonRadius.sm)
                            VStack(alignment: .leading, spacing: 8) {
                                SkeletonBlock(height: 12).frame(maxWidth: 150)
                                SkeletonBlock(height: 10).frame(maxWidth: 110)
                            }
                            Spacer(minLength: 0)
                            SkeletonBlock(width: 26, height: 26, radius: 13)
                        }
                    }
                }
                .padding(.vertical, 8)
                .shimmer()
            }
        }
        .neonAppear()
    }
}

/// One thing on today's calendar, as the mockup's task row: a picture (the
/// project's cover, or a tile for a job or a meeting), what it is, whose or
/// where, the time, and the board's state.
struct HomeTodayRow: View {
    let item: HomeTodayItem
    let timezone: String
    let onTap: () -> Void

    var body: some View {
        Button {
            Haptic.tap()
            onTap()
        } label: {
            ListRow(
                item.title,
                subtitle: subtitle,
                meta: stateLine,
                leading: leading,
                titleLines: 1
            ) {
                if let time {
                    Text(time)
                        .font(.neonMeta)
                        .foregroundStyle(Color.neonTextSecondary)
                        .lineLimit(1)
                        .fixedSize()
                }
                if item.kind == "meeting" {
                    if isHappeningNow {
                        StateBadge(L("Now"), tone: .success, symbol: "dot.radiowaves.left.and.right", pulsing: true)
                    }
                } else {
                    // Display only: the board's state, never a control.
                    CheckCircle(item.isDone, size: 24)
                }
            }
        }
        .buttonStyle(.pressableCard)
        .accessibilityHint(Text(hint))
    }

    private var leading: RowLeading {
        switch item.kind {
        case "cell":
            if let cover = item.coverImageUrl, !cover.isEmpty {
                return .thumbnail(url: resolvedMediaURL(cover))
            }
            return .icon("square.grid.3x3.fill", tint: .neonBlueStrong)
        case "meeting":
            return .icon(item.mode == "IN_PERSON" ? "person.2.fill" : "video.fill", tint: .neonIndigoStrong)
        default:
            return .icon("checklist", tint: item.person.map { employeeTint($0.color) } ?? .neonPurpleStrong)
        }
    }

    private var subtitle: String {
        switch item.kind {
        case "cell":
            return [item.projectName, item.person?.name].compactMap { $0 }.joined(separator: " · ")
        case "meeting":
            let where_ = item.mode == "IN_PERSON" ? (item.place.flatMap { $0.isEmpty ? nil : $0 } ?? L("In person")) : L("Online")
            guard let attendees = item.attendees, attendees > 0 else { return where_ }
            return "\(where_) · \(L("%d invited", attendees))"
        default:
            var parts = [item.person?.name ?? L("Job")]
            if let until = item.until { parts.append(L("until %@", homeShortDay(until))) }
            return parts.joined(separator: " · ")
        }
    }

    private var time: String? {
        homeClock(item.at, timezone: timezone)
    }

    /// The state in the board's words, where there is something to say
    /// besides pending or done (the circle says those).
    private var stateLine: String? {
        guard let state = item.state, state != "TODO", state != "DONE" else { return nil }
        return taskStateLabel(state)
    }

    private var isHappeningNow: Bool {
        guard let start = parseISODate(item.at) else { return false }
        let end = start.addingTimeInterval(Double(item.durationMinutes ?? 30) * 60)
        return (start...end).contains(Date())
    }

    private var hint: String {
        switch item.kind {
        case "cell": return L("Opens the project")
        case "meeting": return L("Opens the meetings")
        default: return L("Opens the week board in Tasks")
        }
    }
}

/// Everything on today's calendar, grouped: meetings, board steps, jobs.
struct HomeTodayView: View {
    let today: HomeToday?
    let error: String?
    let retry: () async -> Void
    let onOpen: (HomeTodayItem) -> Void

    var body: some View {
        NeonScroll(spacing: NeonSpace.stack) {
            if let today {
                summary(today)
                if today.items.isEmpty {
                    EmptyState(
                        symbol: "sun.max",
                        title: L("Nothing planned for today"),
                        detail: L("No board steps, jobs or meetings are on today's calendar."),
                        hue: .blue,
                        card: true
                    )
                } else {
                    group(L("Meetings"), symbol: "video.fill", hue: .indigo, kind: "meeting", today: today)
                    group(L("Board steps"), symbol: "square.grid.3x3.fill", hue: .blue, kind: "cell", today: today)
                    group(L("Jobs handed out"), symbol: "checklist", hue: .purple, kind: "job", today: today)
                }
            } else if let error {
                ErrorState(message: error, retry: retry)
            } else {
                SkeletonCard(lines: 4)
                SkeletonCard(lines: 3)
            }
        }
        .refreshable { await retry() }
        .navigationTitle(L("Today"))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func summary(_ today: HomeToday) -> some View {
        let work = today.items.filter { $0.kind != "meeting" }
        return StatGrid(columns: 3) {
            KPICard(L("Meetings"), value: Double(today.items.filter { $0.kind == "meeting" }.count), symbol: "video.fill", hue: .indigo, density: .compact)
            KPICard(L("Tasks"), value: Double(work.count), symbol: "checklist", hue: .blue, density: .compact)
            KPICard(L("Done"), value: Double(work.filter(\.isDone).count), symbol: "checkmark.circle.fill", hue: .green, caption: L("approved"), density: .compact)
        }
    }

    @ViewBuilder
    private func group(_ title: String, symbol: String, hue: NeonHue, kind: String, today: HomeToday) -> some View {
        let items = today.items.filter { $0.kind == kind }
        if !items.isEmpty {
            SectionCard(title, subtitle: L("%d today", items.count), symbol: symbol, hue: hue, spacing: 6) {
                VStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { NeonDivider().padding(.leading, 60) }
                        HomeTodayRow(item: item, timezone: today.timezone) { onOpen(item) }
                            .padding(.horizontal, -14)
                            .staggered(index)
                    }
                }
            }
        }
    }
}

/// "10:00 AM" in the studio's timezone and the app's language.
func homeClock(_ iso: String?, timezone: String) -> String? {
    guard let date = parseISODate(iso) else { return nil }
    var style = Date.FormatStyle(date: .omitted, time: .shortened, locale: AppLanguage.current.locale)
    style.timeZone = TimeZone(identifier: timezone) ?? .current
    return date.formatted(style)
}

/// "Thu 2 Oct" for a studio day key, read in UTC like every `@db.Date`.
func homeShortDay(_ dayKey: String) -> String {
    guard let date = parseISODate("\(dayKey)T00:00:00.000Z") else { return dayKey }
    var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: AppLanguage.current.locale)
    style.timeZone = TimeZone(identifier: "UTC")!
    style = style.weekday(.abbreviated).day().month(.abbreviated)
    return date.formatted(style)
}
