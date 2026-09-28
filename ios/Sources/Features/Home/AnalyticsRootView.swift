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
            NeonScroll(spacing: NeonSpace.xxl) {
                Text(L("How each person's day and month are going."))
                    .font(.neonFootnote)
                    .foregroundStyle(Color.neonTextSecondary)

                DailySection(data: data, goTo: { day = $0; Task { await load() } })
                MonthlySection(data: data, goTo: { period = $0; Task { await load() } }, onApplied: { await load() })
            }
            .refreshable { Haptic.tap(); await load() }
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

// MARK: - Daily progress

private struct DailySection: View {
    let data: HomeAnalytics
    let goTo: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.md) {
            HStack(alignment: .firstTextBaseline) {
                SectionHeader(L("Daily progress"), subtitle: homeDayHeading(data.day, today: data.today))
                Spacer(minLength: 8)
                HStack(spacing: 6) {
                    IconButton("chevron.left", label: L("Previous day")) { goTo(data.previousDay) }
                    if !data.live {
                        Button(L("Today")) { goTo(data.today) }
                            .buttonStyle(.neon(.secondary, size: .small))
                    }
                    IconButton("chevron.right", label: L("Next day")) { goTo(data.nextDay) }
                }
            }
            Text(L("Each person's list for the day — board steps scheduled on it and jobs from the week table — counted the way their own phone shows it."))
                .font(.neonCaption)
                .foregroundStyle(Color.neonTextFaint)

            if data.daily.isEmpty {
                EmptyState(symbol: "chart.bar.xaxis", title: L("No employees yet"), detail: L("Add the team, and their day appears here."))
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
                    ForEach(data.daily) { person in
                        DayPersonCard(person: person, live: data.live, selected: data.day, goTo: goTo)
                    }
                }
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
            DayCountsBar(counts: counts)
            DayCountsLegend(counts: counts)
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
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Circle().fill(employeeFill(person.employee.color)).frame(width: 8, height: 8)
                        DirText(person.employee.name, font: .neonHeadline, fill: false)
                    }
                    if let role = person.employee.role {
                        Text(role).font(.neonCaption).foregroundStyle(Color.neonTextFaint)
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
                DayCountsBar(counts: person.counts)
                DayCountsLegend(counts: person.counts)
            }

            if live, !person.working.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Circle().fill(Color.neonCyanStrong).frame(width: 6, height: 6)
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

            DayHistoryStrip(history: person.history, selected: selected, live: live, goTo: goTo)
        }
    }
}

private struct DayCountsBar: View {
    let counts: DayStateCounts

    private var parts: [(Int, Color)] {
        [(counts.done, .neonSuccess), (counts.review, .neonPurple), (counts.working, .neonCyan)]
    }

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 2) {
                ForEach(Array(parts.enumerated()), id: \.offset) { _, part in
                    if part.0 > 0 {
                        part.1.frame(width: max(geo.size.width * CGFloat(part.0) / CGFloat(max(counts.total, 1)), 3))
                    }
                }
            }
            .frame(width: geo.size.width, alignment: .leading)
        }
        .frame(height: 8)
        .background(Color.neonSurfaceSunken)
        .clipShape(Capsule())
    }
}

private struct DayCountsLegend: View {
    let counts: DayStateCounts

    var body: some View {
        let parts: [(String, Int, Color)] = [
            (L("Done"), counts.done, .neonSuccess),
            (L("In review"), counts.review, .neonPurple),
            (L("In progress"), counts.working, .neonCyan),
            (L("Pending"), counts.pending, .neonTextFaint),
        ]
        FlowRow {
            ForEach(Array(parts.enumerated()), id: \.offset) { _, part in
                HStack(spacing: 5) {
                    Circle().fill(part.2).frame(width: 7, height: 7)
                    Text(part.0).font(.neonCaption).foregroundStyle(Color.neonTextSecondary)
                    Text(NeonFormat.integer(part.1)).font(.neonCaption.weight(.semibold)).foregroundStyle(Color.neonInk)
                }
            }
        }
    }
}

private struct DayHistoryStrip: View {
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
                    Button { goTo(point.dayKey) } label: {
                        VStack(spacing: 3) {
                            ZStack(alignment: .bottom) {
                                RoundedRectangle(cornerRadius: 3)
                                    .strokeBorder(point.total == 0 ? Color.neonLineStrong : Color.clear, style: StrokeStyle(lineWidth: 1, dash: point.total == 0 ? [3, 2] : []))
                                    .background(RoundedRectangle(cornerRadius: 3).fill(point.total == 0 ? Color.clear : Color.neonSurfaceSunken))
                                if share > 0 {
                                    RoundedRectangle(cornerRadius: 3)
                                        .fill(Color.neonSuccess)
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
    @State private var confirming = false
    @State private var applying = false

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.md) {
            HStack(alignment: .firstTextBaseline) {
                SectionHeader(L("Monthly progress"), subtitle: homePeriodLabel(data.period))
                Spacer(minLength: 8)
                HStack(spacing: 6) {
                    Button(L("Previous month")) { goTo(data.previousPeriod) }
                        .buttonStyle(.neon(.secondary, size: .small))
                    if data.period != data.thisMonth {
                        Button(L("This month")) { goTo(data.thisMonth) }
                            .buttonStyle(.neon(.secondary, size: .small))
                    }
                }
            }
            Text(L("Completed board steps over assigned ones. Below %d%% costs %.2f JOD, and the employee is told why.", data.target, data.penalty))
                .font(.neonCaption)
                .foregroundStyle(Color.neonTextFaint)

            StatGrid {
                StatTile(L("Team"), value: Double(data.month.team), symbol: "person.2.fill")
                StatTile(L("Average progress"), value: Double(data.month.average), format: .percent, symbol: "chart.line.uptrend.xyaxis")
                StatTile(L("Below %d%%", data.target), value: Double(data.month.below), symbol: "arrow.down.right", tint: .neonWarningStrong)
                StatTile(L("Deductions applied"), text: "\(data.month.deductionsApplied) / \(data.month.below)", symbol: "scissors", tint: .neonDangerStrong)
            }

            if !data.month.owing.isEmpty {
                OwingBanner(
                    owing: data.month.owing, target: data.target, penalty: data.penalty, period: data.period,
                    confirming: $confirming, applying: $applying, apply: apply
                )
            }

            if data.rows.isEmpty {
                EmptyState(symbol: "chart.bar.xaxis", title: L("No employees yet"), detail: L("Add the team, and their progress appears here."))
            } else {
                VStack(spacing: NeonSpace.sm) {
                    ForEach(data.rows) { row in
                        EmployeeProgressCard(row: row)
                    }
                }
            }
        }
    }

    private func apply() async {
        applying = true
        defer { applying = false }
        do {
            try await api.applyHomeDeductions(period: data.period)
            Haptic.success()
            Toast.success(L("Applied"))
            confirming = false
            await onApplied()
        } catch {
            Toast.error(error)
        }
    }
}

private struct OwingBanner: View {
    let owing: [MonthOwingPerson]
    let target: Int
    let penalty: Double
    let period: String
    @Binding var confirming: Bool
    @Binding var applying: Bool
    let apply: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.sm) {
            Label(headline, systemImage: "exclamationmark.triangle.fill")
                .font(.neonSubheadline.weight(.semibold))
                .foregroundStyle(Color.neonDangerStrong)
            Text(L("Applying this takes %.2f JOD off each of their salaries for the period and sends them a notification with the numbers behind it. Running it twice changes nothing.", penalty))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextSecondary)

            if confirming {
                HStack(spacing: NeonSpace.sm) {
                    NeonButton(L("Yes, deduct and notify"), symbol: "scissors", kind: .destructive, size: .medium, isLoading: applying) { await apply() }
                    NeonButton(L("Cancel"), kind: .ghost, size: .medium) { confirming = false }
                }
            } else {
                NeonButton(
                    owing.count == 1 ? L("Apply the deduction") : L("Apply %d deductions", owing.count),
                    symbol: "scissors", kind: .destructive, size: .medium, fullWidth: false
                ) { confirming = true }
            }
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
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Circle().fill(employeeFill(row.employee.color)).frame(width: 8, height: 8)
                        DirText(row.employee.name, font: .neonHeadline, fill: false)
                    }
                    if let role = row.employee.role {
                        Text(role).font(.neonCaption).foregroundStyle(Color.neonTextFaint)
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
                    .background(Color.neonSurfaceSunken, in: RoundedRectangle(cornerRadius: 8))
                }
            }

            if let deduction = row.deduction {
                Label(L("−%.2f deducted", deduction.amount), systemImage: "scissors")
                    .font(.neonCaption.weight(.semibold))
                    .foregroundStyle(Color.neonDangerStrong)
            }
        }
    }
}
