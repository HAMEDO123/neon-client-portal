import SwiftUI

// The blocks of the Home tab above the team: the four figures, where every
// project stands, this month by week, what is waiting, the quick actions and
// the projects themselves. Each one is a kit card; the numbers are the
// server's, and a figure with no history behind it is drawn without one.

// MARK: - The four figures

struct HomeKPIRow: View {
    let stats: DashboardStats
    let pulse: HomePulse?
    let onOpenProjects: () -> Void
    let onNewProject: () -> Void

    var body: some View {
        StatGrid(columns: 4) {
            KPICard(
                L("Total Projects"), value: Double(stats.total), symbol: "folder.fill", hue: .blue,
                trend: projectsTrend, bars: pulse.map { $0.projects.monthEnds.map(Double.init) }, density: .compact
            ) {
                Button(L("Open projects"), systemImage: "folder", action: onOpenProjects)
                Button(L("New Project"), systemImage: "plus", action: onNewProject)
            }
            // Nothing records when a project was published, so this figure has
            // no trend: only what it is out of.
            KPICard(
                L("Published"), value: Double(stats.published), symbol: "checkmark.seal.fill", hue: .purple,
                caption: L("of %d projects", stats.total), density: .compact
            ) {
                Button(L("Open projects"), systemImage: "folder", action: onOpenProjects)
            }
            KPICard(
                L("Pending Approvals"), value: Double(stats.pendingApprovals), symbol: "clock.fill", hue: .orange,
                trend: approvalsTrend, bars: pulse.map { $0.approvals.weekEnds.map(Double.init) }, density: .compact
            ) {
                Button(L("Open projects"), systemImage: "folder", action: onOpenProjects)
            }
            // `updatedAt` keeps only a project's latest edit, so there is no
            // honest history of this one either.
            KPICard(
                L("Updated This Week"), value: Double(stats.recentlyUpdated), symbol: "chart.line.uptrend.xyaxis", hue: .pink,
                caption: L("in the last 7 days"), density: .compact
            ) {
                Button(L("Open projects"), systemImage: "folder", action: onOpenProjects)
            }
        }
    }

    private var projectsTrend: StatTrend? {
        guard let created = pulse?.projects.createdThisMonth else { return nil }
        return created > 0
            ? .rising(homeSigned(created), L("this month"))
            : .steady(L("None new"), L("this month"))
    }

    private var approvalsTrend: StatTrend? {
        guard let change = pulse?.approvals.change else { return nil }
        if change == 0 { return .steady(L("No change"), L("this week")) }
        // More waiting on clients is worth noticing, not a failure: orange,
        // and green when the pile shrinks.
        return change > 0
            ? .rising(homeSigned(change), L("this week"), tone: .orange)
            : .falling(homeSigned(change), L("this week"), tone: .success)
    }
}

// MARK: - Project Progress

/// The platform's pipeline statuses in the website's order and words
/// (`PIPELINE_STATUSES` in src/lib/constants.ts), one hue each.
enum HomePipeline {
    static let order = ProjectConstants.pipelineStatuses

    private static let english: [String: String] = [
        "DRAFT": "Draft", "INTERNAL_REVIEW": "Internal Review", "SENT_TO_CLIENT": "Sent to Client",
        "CLIENT_REVIEWING": "Client Reviewing", "CHANGES_REQUESTED": "Changes Requested", "APPROVED": "Approved",
        "EXECUTION": "Execution", "COMPLETED": "Completed", "ARCHIVED": "Archived",
    ]

    static func label(_ status: String) -> String {
        let key = "pipeline.\(status)"
        let translated = L(key)
        if translated != key { return translated }
        return english[status] ?? status.replacingOccurrences(of: "_", with: " ").capitalized
    }

    static func hue(_ status: String) -> NeonHue {
        switch status {
        case "DRAFT": return .green
        case "INTERNAL_REVIEW": return .cyan
        case "SENT_TO_CLIENT": return .blue
        case "CLIENT_REVIEWING": return .indigo
        case "CHANGES_REQUESTED": return .orange
        case "APPROVED": return .purple
        case "EXECUTION": return .pink
        case "COMPLETED": return .grey
        default: return .amber
        }
    }
}

struct HomeProgressCard: View {
    let projects: [HomeProject]
    let onViewAll: () -> Void

    private var segments: [ProgressSegment] {
        let counts = Dictionary(grouping: projects, by: \.pipelineStatus).mapValues(\.count)
        let known = HomePipeline.order.filter { (counts[$0] ?? 0) > 0 }
        let unknown = counts.keys.filter { !HomePipeline.order.contains($0) }.sorted()
        return (known + unknown).map { status in
            ProgressSegment(HomePipeline.label(status), value: Double(counts[status] ?? 0), hue: HomePipeline.hue(status), id: status)
        }
    }

    var body: some View {
        SectionCard(
            L("Project Progress"), subtitle: L("Live status of all projects"),
            symbol: "square.stack.3d.up.fill", hue: .blue, action: onViewAll
        ) {
            if projects.isEmpty {
                SegmentedProgressBar([])
                Text(L("No projects yet"))
                    .font(.neonLabel)
                    .foregroundStyle(Color.neonTextSecondary)
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    SegmentedProgressBar(segments)
                    HomeLegend(segments)
                }
            }
        }
        .neonAppear()
    }
}

/// The key under a segmented bar — the kit's `ProgressLegend` look, but in a
/// grid that wraps, because the pipeline has up to nine statuses and a
/// single row only has room for four. The figures count up.
struct HomeLegend: View {
    let segments: [ProgressSegment]

    init(_ segments: [ProgressSegment]) {
        self.segments = segments
    }

    var body: some View {
        let columns = segments.count <= 4 ? max(segments.count, 1) : 3
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: NeonSpace.xs, alignment: .topLeading), count: columns),
            alignment: .leading,
            spacing: NeonSpace.md
        ) {
            ForEach(segments) { segment in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(segment.hue == .grey ? segment.hue.gradient[1] : segment.hue.color)
                            .frame(width: 8, height: 8)
                        HomeCountUp(value: Int(segment.value), font: .system(.headline, weight: .bold))
                    }
                    Text(segment.label)
                        .font(.neonSubtitle)
                        .foregroundStyle(Color.neonTextSecondary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.leading, 14)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
            }
        }
    }
}

// MARK: - This Month

/// What the "This Month" card can count — each one a timestamp the platform
/// really keeps. Never money: nothing here records revenue.
enum HomeMonthMetric: String, CaseIterable, Identifiable {
    case completed, sold, created

    var id: String { rawValue }

    var title: String {
        switch self {
        case .completed: return L("Work done")
        case .sold: return L("Projects sold")
        case .created: return L("New projects")
        }
    }

    /// Exactly what is counted, under the figure.
    var detail: String {
        switch self {
        case .completed: return L("Board steps and jobs marked done, by the day they were marked")
        case .sold: return L("Projects by their Sold on date")
        case .created: return L("Projects by the day they were created")
        }
    }

    var symbol: String {
        switch self {
        case .completed: return "checkmark.circle"
        case .sold: return "handshake"
        case .created: return "folder.badge.plus"
        }
    }

    func series(_ metrics: HomeMonthMetrics) -> HomeMonthSeries {
        switch self {
        case .completed: return metrics.completed
        case .sold: return metrics.sold
        case .created: return metrics.created
        }
    }
}

struct HomeMonthCard: View {
    let pulse: HomePulse?
    let error: String?
    let retry: () async -> Void

    @AppStorage("home.monthMetric") private var metricRaw = HomeMonthMetric.completed.rawValue

    private var metric: HomeMonthMetric { HomeMonthMetric(rawValue: metricRaw) ?? .completed }

    var body: some View {
        SectionCard(L("This Month"), symbol: "chart.bar.fill", hue: .amber) {
            if let pulse {
                content(metric.series(pulse.month))
            } else if let error {
                HomeInlineError(message: error, retry: retry)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    SkeletonBlock(width: 90, height: 26, radius: 8)
                    SkeletonBlock(width: nil, height: 70, radius: 10)
                }
                .shimmer()
            }
        } trailing: {
            PillMenu(metric.title) {
                ForEach(HomeMonthMetric.allCases) { option in
                    Button {
                        Haptic.selection()
                        withNeonAnimation(NeonMotion.snappy) { metricRaw = option.rawValue }
                    } label: {
                        if option == metric {
                            Label(option.title, systemImage: "checkmark")
                        } else {
                            Text(option.title)
                        }
                    }
                }
            }
        }
        .neonAppear()
    }

    @ViewBuilder
    private func content(_ series: HomeMonthSeries) -> some View {
        let count = max(series.weeks.count, series.previousWeeks.count)
        let weeks = padded(series.weeks, to: count)
        let previous = padded(series.previousWeeks, to: count)
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                HomeCountUp(value: series.total, font: .neonTitle)
                    .id(metric)
                TrendLabel(homeMonthTrend(series), lineLimit: 2)
            }
            Text(metric.detail)
                .font(.neonLabel)
                .foregroundStyle(Color.neonTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        MiniBars(
            weeks.map(Double.init),
            comparison: previous.map(Double.init),
            labels: (1...max(count, 1)).map { L("W%d", $0) },
            hue: .blue,
            height: 74
        )
        .id(metric)
        HStack(spacing: 14) {
            HomeLegendDot(title: homeMonthName(series.period), color: NeonHue.blue.color)
            HomeLegendDot(title: homeMonthName(series.previousPeriod), color: NeonHue.blue.color.opacity(0.45))
            Spacer(minLength: 0)
        }
    }

    private func padded(_ values: [Int], to count: Int) -> [Int] {
        values + Array(repeating: 0, count: max(0, count - values.count))
    }
}

/// This month so far against the same days of last month — the only fair
/// comparison while a month is still running.
func homeMonthTrend(_ series: HomeMonthSeries) -> StatTrend {
    let detail = L("vs the same days last month")
    let change = series.total - series.previousToDate
    if change == 0 { return .steady(L("No change"), detail) }
    var text = homeSigned(change)
    if series.previousToDate > 0 {
        let percent = (Double(abs(change)) / Double(series.previousToDate) * 100).rounded()
        if percent >= 1 { text = "\u{200E}" + (change > 0 ? "+" : "−") + NeonFormat.percent(percent) }
    }
    return change > 0 ? .rising(text, detail) : .falling(text, detail)
}

/// "+2" or "−1", kept left to right so Arabic doesn't print "2+".
func homeSigned(_ value: Int) -> String {
    "\u{200E}" + (value >= 0 ? "+" : "−") + NeonFormat.integer(abs(value))
}

/// "September" for a YYYY-MM period.
func homeMonthName(_ period: String) -> String {
    let parts = period.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2,
          let date = Calendar(identifier: .gregorian).date(from: DateComponents(year: parts[0], month: parts[1], day: 1))
    else { return period }
    return date.formatted(Date.FormatStyle(locale: AppLanguage.current.locale).month(.wide))
}

struct HomeLegendDot: View {
    let title: String
    let color: Color

    var body: some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                .fill(color)
                .frame(width: 10, height: 10)
            Text(title)
                .font(.neonMeta)
                .foregroundStyle(Color.neonTextSecondary)
                .lineLimit(1)
        }
    }
}

// MARK: - Waiting on the manager

/// The mockup's "Client Reviews" card, holding what really waits: work the
/// team sent with proof, for the manager to approve or send back.
struct HomeReviewsCard: View {
    let count: Int?
    let people: [HomeReviewPerson]
    let onOpen: () -> Void

    var body: some View {
        Button {
            Haptic.tap()
            onOpen()
        } label: {
            HomeHalfCard(L("Reviews"), symbol: "star.fill", hue: .amber) {
                VStack(alignment: .leading, spacing: 2) {
                    if let count {
                        HomeCountUp(value: count, font: .neonTitle)
                    } else {
                        SkeletonBlock(width: 30, height: 26, radius: 8).shimmer()
                    }
                    Text(L("Reviews waiting"))
                        .font(.neonLabel)
                        .foregroundStyle(Color.neonTextSecondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    if people.isEmpty {
                        Text(count == 0 ? L("Nothing waiting") : " ")
                            .font(.neonMeta)
                            .foregroundStyle(Color.neonTextTertiary)
                            .lineLimit(1)
                    } else {
                        AvatarStack(people.map { AvatarItem(id: $0.id, name: $0.name) }, size: 28, limit: 4)
                    }
                    Spacer(minLength: 4)
                    IconButtonLabel("chevron.forward", look: .tinted, tint: .neonPurpleStrong, size: 32)
                }
            }
        }
        .buttonStyle(.pressableCard)
        .accessibilityLabel(Text(L("Reviews waiting")))
        .accessibilityValue(Text(count.map { NeonFormat.integer($0) } ?? ""))
        .neonAppear()
    }
}

/// The rest of what is waiting on the manager: unread alerts and supply
/// requests nobody has answered yet.
struct HomeNeedsYouCard: View {
    let alerts: Int?
    let requests: Int?
    let onAlerts: () -> Void
    let onRequests: () -> Void

    var body: some View {
        HomeHalfCard(L("Needs you"), symbol: "bell.badge.fill", hue: .pink) {
            VStack(spacing: 0) {
                row(L("Unread alerts"), count: alerts, symbol: "bell.fill", hue: .pink, action: onAlerts)
                NeonDivider().padding(.vertical, 2)
                row(L("Open requests"), count: requests, symbol: "shippingbox.fill", hue: .orange, action: onRequests)
            }
        }
        .neonAppear(delay: 0.05)
    }

    private func row(_ title: String, count: Int?, symbol: String, hue: NeonHue, action: @escaping () -> Void) -> some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            HStack(spacing: 8) {
                IconTile(symbol, hue: hue, size: 28, style: (count ?? 0) > 0 ? .filled : .soft)
                VStack(alignment: .leading, spacing: 0) {
                    if let count {
                        HomeCountUp(value: count, font: .system(.title3, weight: .bold))
                    } else {
                        SkeletonBlock(width: 22, height: 18, radius: 6).shimmer()
                    }
                    Text(title)
                        .font(.neonMeta)
                        .foregroundStyle(Color.neonTextSecondary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.forward")
                    .font(.system(.caption2, weight: .semibold))
                    .foregroundStyle(Color.neonTextFaint)
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressable)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(title))
        .accessibilityValue(Text(count.map { NeonFormat.integer($0) } ?? ""))
        .accessibilityAddTraits(.isButton)
    }
}

/// A card half the width of the page, as the mockup's "Client Reviews": a
/// small tile and a one-line title (a `SectionCard`'s heading wraps at this
/// width), and a body that grows to the height of the card beside it.
struct HomeHalfCard<Content: View>: View {
    let title: String
    let symbol: String
    let hue: NeonHue
    let content: Content

    init(_ title: String, symbol: String, hue: NeonHue, @ViewBuilder content: () -> Content) {
        self.title = title
        self.symbol = symbol
        self.hue = hue
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                IconTile(symbol, hue: hue, size: 30)
                Text(title)
                    .font(.system(.subheadline, weight: .semibold))
                    .foregroundStyle(Color.neonInk)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .accessibilityAddTraits(.isHeader)
            }
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .neonContextShape(radius: NeonRadius.lg)
    }
}

// MARK: - Quick Actions

struct HomeQuickActionsCard: View {
    let actions: [QuickAction]

    var body: some View {
        SectionCard(L("Quick Actions"), symbol: "bolt.fill", hue: .purple, tileStyle: .filled) {
            QuickActionGrid(actions, columns: nil, inset: NeonSpace.card)
                .padding(.horizontal, -NeonSpace.card)
        }
        .neonAppear()
    }
}

// MARK: - Projects

/// Every project, most recently updated first, as cover cards that scroll
/// sideways — what the dashboard's "All Projects" list held, at a glance.
struct HomeProjectsCard: View {
    let projects: [HomeProject]
    let onProject: (String) -> Void
    let onViewAll: () -> Void

    var body: some View {
        SectionCard(
            L("Projects"), subtitle: L("Most recently updated first"),
            symbol: "folder.fill", hue: .blue, action: onViewAll
        ) {
            if projects.isEmpty {
                HomeInlineEmpty(
                    symbol: "folder",
                    title: L("No projects yet"),
                    detail: L("Create your first client project to start building its delivery portal."),
                    hue: .blue
                )
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: NeonSpace.md) {
                        ForEach(projects) { project in
                            Button {
                                Haptic.tap()
                                onProject(project.id)
                            } label: {
                                HomeProjectCover(project: project)
                            }
                            .buttonStyle(.pressableCard)
                        }
                    }
                    .padding(.horizontal, NeonSpace.card)
                    .padding(.vertical, 6)
                }
                .padding(.horizontal, -NeonSpace.card)
            }
        }
        .neonAppear()
    }
}

struct HomeProjectCover: View {
    let project: HomeProject

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                RemoteImage(url: resolvedMediaURL(project.coverImageUrl), placeholderSymbol: "building.2")
                LinearGradient(
                    colors: [.black.opacity(0), .black.opacity(0.55)],
                    startPoint: .center,
                    endPoint: .bottom
                )
                HStack(spacing: 4) {
                    BadgeView(text: localizedEnum("publish", project.publishState), tone: publishTone(project.publishState))
                }
                .padding(10)
            }
            .frame(width: 196, height: 120)
            .clipped()
            .overlay(alignment: .topTrailing) {
                ProgressRing(progress: Double(project.completionPercent) / 100, size: 34, lineWidth: 3.5, tint: .white) {
                    Text(verbatim: NeonFormat.percent(Double(project.completionPercent)))
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                        .minimumScaleFactor(0.6)
                }
                .background(Circle().fill(Color.black.opacity(0.28)))
                .padding(8)
            }

            VStack(alignment: .leading, spacing: 4) {
                DirText(project.name, font: .neonRowTitle, fill: false, lineLimit: 1)
                DirText(
                    project.location.map { "\(project.clientName) · \($0)" } ?? project.clientName,
                    font: .neonMeta, color: .neonTextSecondary, fill: false, lineLimit: 1
                )
                HStack(spacing: 6) {
                    Circle().fill(HomePipeline.hue(project.pipelineStatus).color).frame(width: 7, height: 7)
                    Text(HomePipeline.label(project.pipelineStatus))
                        .font(.neonMeta)
                        .foregroundStyle(Color.neonTextSecondary)
                        .lineLimit(1)
                }
                HStack(spacing: 10) {
                    MetaLabel(NeonFormat.integer(project.approvals), symbol: "checkmark.seal")
                        .accessibilityLabel(Text(L("%d approvals", project.approvals)))
                    MetaLabel(NeonFormat.integer(project.comments), symbol: "text.bubble")
                        .accessibilityLabel(Text(L("%d comments", project.comments)))
                    Spacer(minLength: 0)
                    if let updated = shortTime(project.updatedAt) {
                        Text(updated)
                            .font(.neonMeta)
                            .foregroundStyle(Color.neonTextTertiary)
                            .lineLimit(1)
                    }
                }
                .padding(.top, 2)
            }
            .padding(12)
            .frame(width: 196, alignment: .leading)
        }
        .background(Color.neonSurface)
        .clipShape(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
                .strokeBorder(Color.neonLine, lineWidth: 1)
        )
        .neonShadow(.low)
        .neonContextShape(radius: NeonRadius.md)
    }
}

// MARK: - Small pieces

/// A whole number that counts up to its value when it appears, and again
/// when it changes.
struct HomeCountUp: View {
    let value: Int
    var font: Font

    @State private var shown: Double = 0

    var body: some View {
        CountingText(value: shown, format: .integer)
            .font(font)
            .foregroundStyle(Color.neonInk)
            .lineLimit(1)
            .onAppear { count() }
            .onChange(of: value) { _ in count() }
            .accessibilityLabel(Text(NeonFormat.integer(value)))
    }

    private func count() {
        withNeonAnimation(NeonMotion.fill) { shown = Double(value) }
    }
}

/// Nothing to show, said plainly inside a card.
struct HomeInlineEmpty: View {
    let symbol: String
    let title: String
    var detail: String?
    var hue: NeonHue = .indigo

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconTile(symbol, hue: hue, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.neonRowTitle)
                    .foregroundStyle(Color.neonInk)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail {
                    Text(detail)
                        .font(.neonLabel)
                        .foregroundStyle(Color.neonTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

/// A read that failed, inside its card: the server's sentence and Retry.
struct HomeInlineError: View {
    let message: String
    let retry: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Color.neonWarningStrong)
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Couldn't load this"))
                        .font(.neonRowTitle)
                        .foregroundStyle(Color.neonInk)
                    Text(message)
                        .font(.neonLabel)
                        .foregroundStyle(Color.neonTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            NeonButton(L("Retry"), symbol: "arrow.clockwise", kind: .secondary, size: .small) {
                await retry()
            }
            .fixedSize()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
