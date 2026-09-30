import SwiftUI
import Charts

/// How each person's day and month are going. Pushed from More; owns no
/// `NavigationStack`.
struct AnalyticsRootView: View {
    @EnvironmentObject var api: APIClient
    @State private var data: HomeAnalytics?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var period: String?
    @State private var day: String?
    /// The previous period's average, fetched alongside the real read purely
    /// to give the KPI a real trend arrow — never invented, and left `nil`
    /// (no trend shown) until it actually answers.
    @State private var previousAverage: Int?

    var body: some View {
        LoadStateView(value: data, error: errorMessage, cachedAt: cachedAt, retry: load) {
            NeonScroll { SkeletonRows(count: 6) }
        } content: { data in
            ScrollViewReader { proxy in
                // Flattened to the kit's own page rhythm: every card here is a
                // sibling in the scroll, never a card nested in a card.
                NeonScroll(spacing: NeonSpace.stack) {
                    DailyTeamCard(data: data, goTo: { day = $0; Task { await load() } })
                        .id("daily")

                    if data.daily.isEmpty {
                        EmptyState(symbol: "chart.bar.xaxis", title: L("No employees yet"), detail: L("Add the team, and their day appears here."), hue: .blue)
                    } else {
                        ForEach(Array(data.daily.enumerated()), id: \.element.id) { index, person in
                            DayPersonCard(person: person, live: data.live, selected: data.day, goTo: { day = $0; Task { await load() } })
                                .staggered(index)
                        }
                    }

                    MonthlyHeaderCard(data: data, goTo: { period = $0; Task { await load() } })
                        .id("monthly")

                    MonthlyStatsGrid(data: data, previousAverage: previousAverage)

                    if !data.month.owing.isEmpty {
                        OwingBanner(owing: data.month.owing, target: data.target, penalty: data.penalty, period: data.period, apply: { await apply() })
                    }

                    if data.rows.isEmpty {
                        EmptyState(symbol: "chart.bar.xaxis", title: L("No employees yet"), detail: L("Add the team, and their progress appears here."), hue: .indigo)
                    } else {
                        ForEach(Array(data.rows.enumerated()), id: \.element.id) { index, row in
                            EmployeeProgressCard(row: row)
                                .id(index == 0 ? "rows" : "rows-\(index)")
                                .staggered(index)
                        }
                    }
                }
                .refreshable { Haptic.tap(); await load() }
                .debugScroll(proxy)
            }
        }
        .navigationTitle(L("Analytics"))
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarBackground(Color.neonBgSoft, for: .navigationBar)
        .task { await load() }
    }

    private func load() async {
        do {
            let loaded = try await api.fetchHomeAnalytics(period: period, day: day)
            data = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
            // Keep the picked values anchored to what actually came back, so
            // "previous"/"next" keep walking from a real day, not a guess.
            period = loaded.value.period
            day = loaded.value.day
        } catch {
            errorMessage = error.localizedDescription
            return
        }
        if let data {
            previousAverage = nil
            if let previous = try? await api.fetchHomeAnalytics(period: data.previousPeriod, day: nil) {
                previousAverage = previous.value.month.average
            }
        }
    }

    private func apply() async {
        guard let data else { return }
        do {
            try await api.applyHomeDeductions(period: data.period)
            Haptic.success()
            Toast.success(L("Applied"))
            await load()
        } catch {
            Toast.error(error)
        }
    }
}

/// `DayStateCounts` as the kit's own dot legend (`ProgressLegend`) — the
/// exact split the mockups' "Project Progress" card uses. The visible bar
/// stays `ProgressBar`, about done work only: a `SegmentedProgressBar` paints
/// every non-grey state as a vivid fill, so "0 done, 15 in progress" would
/// still read as a bar that's nearly finished.
private func insightsDaySegments(_ counts: DayStateCounts) -> [ProgressSegment] {
    [
        ProgressSegment(L("Done"), value: Double(counts.done), hue: .green),
        ProgressSegment(L("In review"), value: Double(counts.review), hue: .purple),
        ProgressSegment(L("In progress"), value: Double(counts.working), hue: .cyan),
        ProgressSegment(L("Pending"), value: Double(counts.pending), hue: .grey),
    ]
}

/// The same four states, for a month's `PeriodProgressCounts` — one
/// vocabulary for one set of states, on both cards.
private func insightsMonthSegments(_ counts: PeriodProgressCounts) -> [ProgressSegment] {
    [
        ProgressSegment(L("Done"), value: Double(counts.completed), hue: .green),
        ProgressSegment(L("In review"), value: Double(counts.awaitingReview), hue: .purple),
        ProgressSegment(L("In progress"), value: Double(counts.inProgress), hue: .cyan),
        ProgressSegment(L("Pending"), value: Double(counts.pending), hue: .grey),
    ]
}

/// "Wed, Sep 30" — a short subtitle that never wraps under the day's round
/// chevrons, unlike `homeDayHeading`'s `.long` day (kept local: HomeModels.swift
/// is the Home area's own file).
private func insightsShortDayLabel(_ dayKey: String) -> String {
    guard let date = parseISODate("\(dayKey)T00:00:00.000Z") else { return dayKey }
    var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: AppLanguage.current.locale)
    style.timeZone = TimeZone(identifier: "UTC")!
    style = style.weekday(.abbreviated).month(.abbreviated).day()
    return date.formatted(style)
}

private func insightsShortDayHeading(_ dayKey: String, today: String) -> String {
    let date = insightsShortDayLabel(dayKey)
    if dayKey == today { return L("Today · %@", date) }
    if dayKey == shiftHomeDayKey(today, by: -1) { return L("Yesterday · %@", date) }
    if dayKey == shiftHomeDayKey(today, by: 1) { return L("Tomorrow · %@", date) }
    return date
}

/// "September 2026" — never a day. `homePeriodLabel` (HomeModels.swift) asks
/// for `.month(.wide).year()` but starts from a `.long` `Date.FormatStyle`,
/// whose day survives; this starts from `.omitted` instead.
private func insightsPeriodLabel(_ period: String) -> String {
    let parts = period.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2,
          let date = Calendar(identifier: .gregorian).date(from: DateComponents(year: parts[0], month: parts[1], day: 1))
    else { return period }
    var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: AppLanguage.current.locale)
    style = style.month(.wide).year()
    return date.formatted(style)
}

/// One month on from a "YYYY-MM" period key, so the month stepper can step
/// forward again after stepping back — the server has no "next period" of
/// its own to hand over, since paging only ever went backward before this.
private func insightsNextPeriodKey(_ period: String) -> String {
    let parts = period.split(separator: "-").compactMap { Int($0) }
    let calendar = Calendar(identifier: .gregorian)
    guard parts.count == 2,
          let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: 1)),
          let next = calendar.date(byAdding: .month, value: 1, to: date)
    else { return period }
    let comps = calendar.dateComponents([.year, .month], from: next)
    guard let year = comps.year, let month = comps.month else { return period }
    return String(format: "%04d-%02d", year, month)
}

// MARK: - Daily progress

private struct DailyTeamCard: View {
    let data: HomeAnalytics
    let goTo: (String) -> Void

    private var percent: Int {
        data.teamDay.total == 0 ? 0 : Int((Double(data.teamDay.done) / Double(data.teamDay.total) * 100).rounded())
    }

    var body: some View {
        SectionCard(L("Daily progress"), symbol: "calendar", hue: .blue) {
            HStack(spacing: 8) {
                Text(insightsShortDayHeading(data.day, today: data.today))
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextSecondary)
                if !data.live {
                    Button(L("Today")) { goTo(data.today) }
                        .buttonStyle(.neon(.secondary, size: .small))
                }
                Spacer(minLength: 0)
            }

            if data.teamDay.total > 0 {
                HStack(alignment: .top) {
                    Text(L("Whole team")).font(.neonHeadline)
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("\(percent)%").font(.neonTitle3).foregroundStyle(Color.neonInk)
                        Text(L("%d of %d done", data.teamDay.done, data.teamDay.total))
                            .font(.neonCaption)
                            .foregroundStyle(Color.neonTextTertiary)
                    }
                }
                ProgressBar(progress: Double(data.teamDay.done) / Double(data.teamDay.total), tint: .neonSuccess, height: 8)
                ProgressLegend(insightsDaySegments(data.teamDay))
            } else if !data.daily.isEmpty {
                Text(L("Nothing was on anyone's list this day."))
                    .font(.neonFootnote)
                    .foregroundStyle(Color.neonTextTertiary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, NeonSpace.lg)
                    .neonSurface(.outline, radius: NeonRadius.lg)
            }
        } trailing: {
            HStack(spacing: 6) {
                IconButton("chevron.backward", label: L("Previous day"), size: NeonSize.circleButton) { goTo(data.previousDay) }
                IconButton("chevron.forward", label: L("Next day"), size: NeonSize.circleButton) { goTo(data.nextDay) }
            }
        }
    }
}

private struct DayPersonCard: View {
    let person: DailyProgressRow
    let live: Bool
    let selected: String
    let goTo: (String) -> Void

    private var percent: Int { person.counts.total == 0 ? 0 : Int((Double(person.counts.done) / Double(person.counts.total) * 100).rounded()) }

    var body: some View {
        NeonCard {
            HStack(alignment: .top) {
                HStack(spacing: 8) {
                    AvatarView(url: nil, name: person.employee.name, size: 36)
                    VStack(alignment: .leading, spacing: 2) {
                        DirText(person.employee.name, font: .neonHeadline, fill: false)
                        if let role = person.employee.role {
                            Text(role).font(.neonSubtitle).foregroundStyle(Color.neonTextSecondary)
                        }
                    }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(person.counts.total == 0 ? "—" : "\(percent)%")
                        .font(.neonTitle3)
                        .foregroundStyle(Color.neonInk)
                    Text(person.counts.total == 0 ? L("Nothing planned") : L("%d of %d done", person.counts.done, person.counts.total))
                        .font(.neonCaption)
                        .foregroundStyle(Color.neonTextTertiary)
                }
            }
            .opacity(person.employee.active ? 1 : 0.5)

            if person.counts.total > 0 {
                ProgressBar(progress: Double(person.counts.done) / Double(person.counts.total), tint: .neonSuccess, height: 8)
                ProgressLegend(insightsDaySegments(person.counts))
            }

            if live, !person.working.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Circle().fill(Color.neonCyanStrong).frame(width: 6, height: 6).neonPulse(true)
                        Text(L("Working on now")).font(.neonOverline).foregroundStyle(Color.neonCyanStrong)
                    }
                    ForEach(person.working) { item in
                        DirText(
                            item.project != nil ? "\(item.title) · \(item.project!)" : item.title,
                            font: .neonFootnote, fill: false
                        )
                    }
                }
                .padding(NeonSpace.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .neonSurface(.tinted(.neonCyan), radius: NeonRadius.sm)
            }

            InsightsDayHistoryStrip(history: person.history, selected: selected, live: live, goTo: goTo)
        }
    }
}

/// The kit has no tappable day-by-day strip, and "jump to that day" is a real
/// feature this screen needs — so it's built locally rather than forced into
/// `MiniBars`, which has no per-bar tap.
private struct InsightsDayHistoryStrip: View {
    let history: [DayHistoryPoint]
    let selected: String
    let live: Bool
    let goTo: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            NeonDivider()
            Text(live ? L("Last 7 days") : L("7 days to %@", longDayLabel(selected)))
                .font(.neonOverline)
                .foregroundStyle(Color.neonTextFaint)
            HStack(alignment: .bottom, spacing: 4) {
                ForEach(history) { point in
                    let share = point.total == 0 ? 0 : Double(point.done) / Double(point.total)
                    let isSelected = point.dayKey == selected
                    Button { withNeonAnimation(.snappy) { goTo(point.dayKey) } } label: {
                        VStack(spacing: 3) {
                            Text(point.total == 0 ? " " : "\(point.done)/\(point.total)")
                                .font(.neonMeta)
                                .foregroundStyle(Color.neonTextTertiary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                            ZStack(alignment: .bottom) {
                                RoundedRectangle(cornerRadius: 3)
                                    .strokeBorder(point.total == 0 ? Color.neonLine : Color.clear, lineWidth: 1)
                                    .background(RoundedRectangle(cornerRadius: 3).fill(point.total == 0 ? Color.clear : Color.neonSurfaceSunken))
                                if share > 0 {
                                    RoundedRectangle(cornerRadius: 3)
                                        .fill(LinearGradient(colors: [NeonHue.green.color, NeonHue.green.deep], startPoint: .bottom, endPoint: .top))
                                        .frame(height: max(28 * share, 4))
                                }
                            }
                            .frame(height: 28)
                            Text(shortWeekday(point.dayKey))
                                .font(.neonMeta.weight(isSelected ? .bold : .regular))
                                .foregroundStyle(isSelected ? Color.neonInk : Color.neonTextFaint)
                            Capsule()
                                .fill(isSelected ? Color.neonAccent : Color.clear)
                                .frame(width: 16, height: 3)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func shortWeekday(_ dayKey: String) -> String {
        guard let date = parseISODate("\(dayKey)T00:00:00.000Z") else { return "" }
        var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: AppLanguage.current.locale)
        style.timeZone = TimeZone(identifier: "UTC")!
        return date.formatted(style.weekday(.abbreviated))
    }
}

// MARK: - Monthly progress

private struct MonthlyHeaderCard: View {
    let data: HomeAnalytics
    let goTo: (String) -> Void

    var body: some View {
        SectionCard(
            L("Monthly progress"),
            subtitle: L("%d people · %@", data.month.team, insightsPeriodLabel(data.period)),
            symbol: "chart.bar.xaxis", hue: .indigo
        ) {
            HStack(spacing: 8) {
                if data.period != data.thisMonth {
                    Button(L("This month")) { goTo(data.thisMonth) }
                        .buttonStyle(.neon(.secondary, size: .small))
                }
                Spacer(minLength: 0)
            }
            // The policy behind the deduction, kept short and legible
            // (`.neonCaption`/`.neonTextSecondary`, not the faint grey the kit
            // reserves for chevrons and placeholders) rather than dropped
            // outright: it carries the one real number a manager needs —
            // what falling short actually costs.
            Text(L("Below %d%% costs %@, and the employee is told why.", data.target, NeonFormat.money(data.penalty, decimals: 0)))
                .font(.neonCaption)
                .foregroundStyle(Color.neonTextSecondary)
        } trailing: {
            HStack(spacing: 6) {
                IconButton("chevron.backward", label: L("Previous month"), size: NeonSize.circleButton) { goTo(data.previousPeriod) }
                IconButton("chevron.forward", label: L("Next month"), size: NeonSize.circleButton) { goTo(insightsNextPeriodKey(data.period)) }
            }
        }
    }
}

private struct MonthlyStatsGrid: View {
    let data: HomeAnalytics
    let previousAverage: Int?

    private var averageTrend: StatTrend? {
        guard let previousAverage else { return nil }
        let delta = data.month.average - previousAverage
        if delta == 0 { return .steady(L("vs last month")) }
        let text = (delta > 0 ? "+" : "") + "\(delta)%"
        return delta > 0 ? .rising(text, L("vs last month")) : .falling(text, L("vs last month"))
    }

    var body: some View {
        StatGrid(columns: 3) {
            KPICard(
                L("Average progress"), value: Double(data.month.average), format: .percent,
                symbol: "chart.line.uptrend.xyaxis", hue: .indigo, trend: averageTrend, density: .compact
            )
            KPICard(
                L("Below %d%%", data.target), value: Double(data.month.below),
                symbol: "arrow.down.forward", hue: .orange,
                caption: L("of %d people", data.month.team), density: .compact
            )
            KPICard(
                L("Deducted"), value: Double(data.month.deductionsApplied),
                symbol: "minus.circle.fill", hue: .red,
                caption: L("of %d owed", data.month.below), density: .compact
            )
        }
    }
}

/// The confirm step is `NeonButton`'s own (`confirm:`/`confirmMessage:`)
/// rather than a hand-rolled Yes/Cancel pair.
private struct OwingBanner: View {
    let owing: [MonthOwingPerson]
    let target: Int
    let penalty: Double
    let period: String
    let apply: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.sm) {
            Label(headline, systemImage: "exclamationmark.triangle.fill")
                .font(.neonSubheadline.weight(.semibold))
                .foregroundStyle(Color.neonDangerStrong)
            Text(L("Applying this takes %@ off each of their salaries for the period and sends them a notification with the numbers behind it. Running it twice changes nothing.", NeonFormat.money(penalty, decimals: 0)))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextSecondary)

            NeonButton(
                owing.count == 1 ? L("Apply the deduction") : L("Apply %d deductions", owing.count),
                symbol: "scissors", kind: .destructive, size: .medium, fullWidth: false,
                confirm: headline,
                confirmMessage: L("Applying this takes %@ off each of their salaries for the period and sends them a notification with the numbers behind it. Running it twice changes nothing.", NeonFormat.money(penalty, decimals: 0))
            ) { await apply() }
        }
        .padding(NeonSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.tinted(.neonPink), radius: NeonRadius.lg)
    }

    private var headline: String {
        owing.count == 1
            ? L("%@ is below %d%% for %@.", owing[0].name, target, insightsPeriodLabel(period))
            : L("%d people are below %d%% for %@.", owing.count, target, insightsPeriodLabel(period))
    }
}

private struct EmployeeProgressCard: View {
    let row: EmployeeProgressRow

    /// The platform's own MIN_SAMPLE rule (lib/performance.ts): under 3
    /// finished items, a rate is refused rather than shown as a possibly
    /// misleading 100%.
    private var hasEnoughSample: Bool { row.counts.completed >= 3 }

    var body: some View {
        NeonCard {
            HStack(alignment: .top) {
                HStack(spacing: 8) {
                    AvatarView(url: nil, name: row.employee.name, size: 36)
                    VStack(alignment: .leading, spacing: 2) {
                        DirText(row.employee.name, font: .neonHeadline, fill: false)
                        if let role = row.employee.role {
                            Text(role).font(.neonSubtitle).foregroundStyle(Color.neonTextSecondary)
                        }
                    }
                }
                Spacer(minLength: 8)
                Text(row.counts.total == 0 ? "—" : "\(row.progress)%")
                    .font(.neonTitle3)
                    .foregroundStyle(row.shortfall ? Color.neonDangerStrong : Color.neonInk)
            }
            .opacity(row.employee.active ? 1 : 0.5)

            ProgressBar(progress: Double(row.progress) / 100, tint: row.shortfall ? .neonDanger : .neonSuccess, height: 8)
            ProgressLegend(insightsMonthSegments(row.counts))

            HStack(spacing: NeonSpace.md) {
                InsightsMiniStat(
                    label: L("Overdue now"),
                    value: NeonFormat.integer(row.counts.overdue),
                    danger: row.counts.overdue > 0
                )
                if hasEnoughSample {
                    InsightsMiniStat(label: L("Finished on time"), value: "\(row.timeliness)%", danger: false)
                } else {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L("Finished on time")).font(.neonLabel).foregroundStyle(Color.neonTextTertiary)
                        MetaLabel(L("Too few to tell"), symbol: "questionmark.circle")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            if let deduction = row.deduction {
                BadgeView(text: L("−%@ deducted", NeonFormat.money(deduction.amount, decimals: 0)), tone: .danger, symbol: "scissors")
            }
        }
    }
}

/// A small label-over-figure pair, in the kit's own Dynamic-Type-safe fonts —
/// replacing a `LazyVGrid` of `.system(size: 9/13)` chips.
private struct InsightsMiniStat: View {
    let label: String
    let value: String
    let danger: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.neonLabel).foregroundStyle(Color.neonTextTertiary)
            Text(value).font(.neonNumberSmall).foregroundStyle(danger ? Color.neonDangerStrong : Color.neonText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
