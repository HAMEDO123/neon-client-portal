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

    var body: some View {
        LoadStateView(value: data, error: errorMessage, cachedAt: cachedAt, retry: load) {
            NeonScroll { SkeletonRows(count: 6) }
        } content: { data in
            ScrollViewReader { proxy in
                NeonScroll(spacing: NeonSpace.xxl) {
                    Text(L("How each person's day and month are going."))
                        .font(.neonFootnote)
                        .foregroundStyle(Color.neonTextSecondary)

                    DailySection(data: data, goTo: { day = $0; Task { await load() } })
                        .id("daily")

                    MonthlySection(data: data, goTo: { period = $0; Task { await load() } }, onApplied: { await load() })
                        .id("monthly")
                }
                .refreshable { Haptic.tap(); await load() }
                .debugScroll(proxy)
            }
        }
        .navigationTitle(L("Analytics"))
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
        }
    }
}

/// `DayStateCounts` as the kit's own split bar + dot legend, rather than a
/// hand-rolled bar — the exact piece the mockups use for "Project Progress".
private func insightsDaySegments(_ counts: DayStateCounts) -> [ProgressSegment] {
    [
        ProgressSegment(L("Done"), value: Double(counts.done), hue: .green),
        ProgressSegment(L("In review"), value: Double(counts.review), hue: .purple),
        ProgressSegment(L("In progress"), value: Double(counts.working), hue: .cyan),
        ProgressSegment(L("Pending"), value: Double(counts.pending), hue: .grey),
    ]
}

// MARK: - Daily progress

private struct DailySection: View {
    let data: HomeAnalytics
    let goTo: (String) -> Void

    var body: some View {
        SectionCard(L("Daily progress"), subtitle: homeDayHeading(data.day, today: data.today), symbol: "calendar", hue: .blue) {
            Text(L("Each person's list for the day — board steps scheduled on it and jobs from the week table — counted the way their own phone shows it."))
                .font(.neonCaption)
                .foregroundStyle(Color.neonTextFaint)

            if data.daily.isEmpty {
                EmptyState(symbol: "chart.bar.xaxis", title: L("No employees yet"), detail: L("Add the team, and their day appears here."), hue: .blue)
            } else {
                if data.teamDay.total > 0 {
                    TeamDayCard(counts: data.teamDay)
                } else {
                    Text(L("Nothing was on anyone's list this day."))
                        .font(.neonFootnote)
                        .foregroundStyle(Color.neonTextTertiary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, NeonSpace.lg)
                        .neonSurface(.outline, radius: NeonRadius.lg)
                }

                VStack(spacing: NeonSpace.sm) {
                    ForEach(Array(data.daily.enumerated()), id: \.element.id) { index, person in
                        DayPersonCard(person: person, live: data.live, selected: data.day, goTo: goTo)
                            .staggered(index)
                    }
                }
            }
        } trailing: {
            HStack(spacing: 6) {
                IconButton("chevron.backward", label: L("Previous day")) { goTo(data.previousDay) }
                if !data.live {
                    Button(L("Today")) { goTo(data.today) }
                        .buttonStyle(.neon(.secondary, size: .small))
                }
                IconButton("chevron.forward", label: L("Next day")) { goTo(data.nextDay) }
            }
        }
    }
}

private struct TeamDayCard: View {
    let counts: DayStateCounts

    var body: some View {
        NeonCard {
            HStack {
                Text(L("Whole team")).font(.neonSubheadline.weight(.semibold))
                Spacer()
                Text(NeonFormat.integer(counts.done) + "/" + NeonFormat.integer(counts.total))
                    .font(.neonNumberSmall)
                    .foregroundStyle(Color.neonTextSecondary)
            }
            SegmentedProgress(insightsDaySegments(counts))
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
                    Circle().fill(employeeFill(person.employee.color)).frame(width: 9, height: 9)
                    VStack(alignment: .leading, spacing: 2) {
                        DirText(person.employee.name, font: .neonHeadline, fill: false)
                        if let role = person.employee.role {
                            Text(role).font(.neonCaption).foregroundStyle(Color.neonTextFaint)
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
                SegmentedProgress(insightsDaySegments(person.counts))
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
            HStack(spacing: 4) {
                ForEach(history) { point in
                    let share = point.total == 0 ? 0 : Double(point.done) / Double(point.total)
                    let isSelected = point.dayKey == selected
                    Button { withNeonAnimation(.snappy) { goTo(point.dayKey) } } label: {
                        VStack(spacing: 3) {
                            ZStack(alignment: .bottom) {
                                RoundedRectangle(cornerRadius: 3)
                                    .strokeBorder(point.total == 0 ? Color.neonLineStrong : Color.clear, style: StrokeStyle(lineWidth: 1, dash: point.total == 0 ? [3, 2] : []))
                                    .background(RoundedRectangle(cornerRadius: 3).fill(point.total == 0 ? Color.clear : Color.neonSurfaceSunken))
                                if share > 0 {
                                    RoundedRectangle(cornerRadius: 3)
                                        .fill(LinearGradient(colors: [NeonHue.green.color, NeonHue.green.deep], startPoint: .bottom, endPoint: .top))
                                        .frame(height: max(28 * share, 4))
                                }
                            }
                            .frame(height: 28)
                            Text(shortWeekday(point.dayKey))
                                .font(.system(size: 9, weight: isSelected ? .bold : .regular))
                                .foregroundStyle(isSelected ? Color.neonInk : Color.neonTextFaint)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(4)
                        .background(isSelected ? Color.neonSurfaceSunken : Color.clear, in: RoundedRectangle(cornerRadius: 8))
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

private struct MonthlySection: View {
    let data: HomeAnalytics
    let goTo: (String) -> Void
    let onApplied: () async -> Void

    @EnvironmentObject var api: APIClient

    var body: some View {
        SectionCard(L("Monthly progress"), subtitle: homePeriodLabel(data.period), symbol: "chart.bar.xaxis", hue: .indigo) {
            Text(L("Completed board steps over assigned ones. Below %d%% costs %.2f JOD, and the employee is told why.", data.target, data.penalty))
                .font(.neonCaption)
                .foregroundStyle(Color.neonTextFaint)

            StatGrid {
                StatTile(L("Team"), value: Double(data.month.team), symbol: "person.2.fill", tint: .neonBlueStrong)
                StatTile(L("Average progress"), value: Double(data.month.average), format: .percent, symbol: "chart.line.uptrend.xyaxis", tint: .neonIndigoStrong)
                StatTile(L("Below %d%%", data.target), value: Double(data.month.below), symbol: "arrow.down.right", tint: .neonWarningStrong)
                StatTile(L("Deductions applied"), text: "\(data.month.deductionsApplied) / \(data.month.below)", symbol: "scissors", tint: .neonDangerStrong)
            }

            if !data.month.owing.isEmpty {
                OwingBanner(owing: data.month.owing, target: data.target, penalty: data.penalty, period: data.period, apply: apply)
            }

            if data.rows.isEmpty {
                EmptyState(symbol: "chart.bar.xaxis", title: L("No employees yet"), detail: L("Add the team, and their progress appears here."), hue: .indigo)
            } else {
                VStack(spacing: NeonSpace.sm) {
                    ForEach(Array(data.rows.enumerated()), id: \.element.id) { index, row in
                        EmployeeProgressCard(row: row)
                            .id(index == 0 ? "rows" : "rows-\(index)")
                            .staggered(index)
                    }
                }
            }
        } trailing: {
            HStack(spacing: 6) {
                Button(L("Previous month")) { goTo(data.previousPeriod) }
                    .buttonStyle(.neon(.secondary, size: .small))
                if data.period != data.thisMonth {
                    Button(L("This month")) { goTo(data.thisMonth) }
                        .buttonStyle(.neon(.secondary, size: .small))
                }
            }
        }
    }

    private func apply() async {
        do {
            try await api.applyHomeDeductions(period: data.period)
            Haptic.success()
            Toast.success(L("Applied"))
            await onApplied()
        } catch {
            Toast.error(error)
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
            Text(L("Applying this takes %.2f JOD off each of their salaries for the period and sends them a notification with the numbers behind it. Running it twice changes nothing.", penalty))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextSecondary)

            NeonButton(
                owing.count == 1 ? L("Apply the deduction") : L("Apply %d deductions", owing.count),
                symbol: "scissors", kind: .destructive, size: .medium, fullWidth: false,
                confirm: headline,
                confirmMessage: L("Applying this takes %.2f JOD off each of their salaries for the period and sends them a notification with the numbers behind it. Running it twice changes nothing.", penalty)
            ) { await apply() }
        }
        .padding(NeonSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.tinted(.neonPink), radius: NeonRadius.lg)
    }

    private var headline: String {
        owing.count == 1
            ? L("%@ is below %d%% for %@.", owing[0].name, target, homePeriodLabel(period))
            : L("%d people are below %d%% for %@.", owing.count, target, homePeriodLabel(period))
    }
}

private struct EmployeeProgressCard: View {
    let row: EmployeeProgressRow

    var body: some View {
        NeonCard {
            HStack(alignment: .top) {
                HStack(spacing: 8) {
                    Circle().fill(employeeFill(row.employee.color)).frame(width: 9, height: 9)
                    VStack(alignment: .leading, spacing: 2) {
                        DirText(row.employee.name, font: .neonHeadline, fill: false)
                        if let role = row.employee.role {
                            Text(role).font(.neonCaption).foregroundStyle(Color.neonTextFaint)
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

            let figures: [(String, String, Bool)] = [
                (L("Done"), "\(row.counts.completed)/\(row.counts.total)", false),
                (L("Review"), NeonFormat.integer(row.counts.awaitingReview), false),
                (L("Working"), NeonFormat.integer(row.counts.inProgress), false),
                (L("Pending"), NeonFormat.integer(row.counts.pending), false),
                (L("Late"), NeonFormat.integer(row.counts.overdue), row.counts.overdue > 0),
                (L("On time"), row.counts.completed == 0 ? "—" : "\(row.timeliness)%", false),
            ]
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                ForEach(Array(figures.enumerated()), id: \.offset) { _, figure in
                    VStack(spacing: 1) {
                        Text(figure.0).font(.system(size: 9, weight: .medium)).foregroundStyle(Color.neonTextFaint)
                        Text(figure.1).font(.system(size: 13, weight: .semibold)).foregroundStyle(figure.2 ? Color.neonDangerStrong : Color.neonTextSecondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 5)
                    .background(Color.neonSurfaceSunken, in: RoundedRectangle(cornerRadius: NeonRadius.sm))
                }
            }

            if let deduction = row.deduction {
                BadgeView(text: L("−%.2f deducted", deduction.amount), tone: .danger, symbol: "scissors")
            }
        }
    }
}
