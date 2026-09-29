import SwiftUI

/// A project's client-side activity — what the manager and team see behind
/// the Analytics tab: what the client did with their link, by kind, and the
/// latest of it in order.
struct ProjectAnalyticsView: View {
    let projectId: String

    @EnvironmentObject var api: APIClient
    @State private var analytics: ProjectAnalytics?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let analytics {
                content(analytics)
                    .transition(.opacity)
            } else if let errorMessage {
                ErrorState(message: errorMessage) { await load() }
            } else {
                VStack(spacing: NeonSpace.stack) {
                    StatGrid(columns: 3) {
                        ForEach(0..<6, id: \.self) { _ in SkeletonKPICard(compact: true) }
                    }
                    SkeletonCard(lines: 4)
                }
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private func content(_ analytics: ProjectAnalytics) -> some View {
        VStack(alignment: .leading, spacing: NeonSpace.stack) {
            if let cachedAt { OfflineBanner(savedAt: cachedAt) }

            StatGrid(columns: 3) {
                KPICard(L("Project Opens"), value: Double(analytics.views), symbol: "eye.fill", hue: .blue, density: .compact)
                KPICard(L("Renders Viewed"), value: Double(analytics.renderViews), symbol: "photo.fill", hue: .purple, density: .compact)
                KPICard(L("Downloads"), value: Double(analytics.downloads), symbol: "arrow.down.circle.fill", hue: .green, density: .compact)
                KPICard(L("Approval Responses"), value: Double(analytics.approvals), symbol: "checkmark.seal.fill", hue: .orange, density: .compact)
                KPICard(L("Comments"), value: Double(analytics.comments), symbol: "bubble.left.fill", hue: .pink, density: .compact)
                KPICard(L("All Activity"), value: Double(analytics.totalEvents), symbol: "waveform.path.ecg", hue: .indigo, density: .compact)
            }
            .id("figures")

            // The client page does not log render views yet (README, Known
            // issues), so a zero there is "not recorded", never "not looked at".
            if analytics.renderViews == 0 {
                Label(L("The client page doesn't record render views yet, so that figure says nothing about whether renders were looked at."), systemImage: "info.circle")
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
            }

            if analytics.totalEvents == 0 {
                EmptyState(
                    symbol: "chart.bar",
                    title: L("No client activity yet"),
                    detail: L("Once the client opens their project link, their activity will appear here."),
                    hue: .indigo,
                    card: true
                )
            } else {
                if !analytics.byType.isEmpty {
                    SectionCard(
                        L("Activity Breakdown"),
                        subtitle: L("Every event logged on the client's link, by kind"),
                        symbol: "chart.bar.fill",
                        hue: .purple
                    ) {
                        VStack(spacing: NeonSpace.md) {
                            ForEach(Array(sortedTypes(analytics).enumerated()), id: \.element.type) { index, entry in
                                breakdownRow(type: entry.type, count: entry.count.type, total: analytics.totalEvents)
                                    .staggered(index)
                            }
                        }
                    }
                    .id("breakdown")
                }

                SectionCard(
                    L("Recent Activity"),
                    subtitle: L("Newest first"),
                    symbol: "clock.arrow.circlepath",
                    hue: .pink
                ) {
                    if analytics.recent.isEmpty {
                        Text(L("Nothing recent to show."))
                            .font(.neonSubtitle)
                            .foregroundStyle(Color.neonTextTertiary)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(analytics.recent.enumerated()), id: \.element.id) { index, item in
                                TimelineRow(
                                    projectActivityLabel(item.type),
                                    subtitle: item.detail?.isEmpty == false ? item.detail : nil,
                                    time: projectTimeAgo(item.createdAt),
                                    symbol: ProjectActivityStyle.symbol(item.type),
                                    tint: ProjectActivityStyle.hue(item.type).deep,
                                    isFirst: index == 0,
                                    isLast: index == analytics.recent.count - 1
                                )
                                .staggered(index)
                            }
                        }
                    }
                }
                .id("activity")
            }
        }
    }

    /// Largest first.
    private func sortedTypes(_ analytics: ProjectAnalytics) -> [ProjectActivityCount] {
        analytics.byType.sorted { $0.count.type > $1.count.type }
    }

    /// One kind of event: what it was, how many, and its share as a bar —
    /// rows rather than a donut, because the website's names for these are
    /// whole sentences a chart's key would cut short.
    private func breakdownRow(type: String, count: Int, total: Int) -> some View {
        let hue = ProjectActivityStyle.hue(type)
        let share = Double(count) / Double(max(total, 1))
        return HStack(alignment: .center, spacing: NeonSpace.md) {
            IconTile(ProjectActivityStyle.symbol(type), hue: hue, size: 34)
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(projectActivityLabel(type))
                        .font(.system(.subheadline, weight: .medium))
                        .foregroundStyle(Color.neonInk)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 6)
                    Text(NeonFormat.integer(count))
                        .font(.system(.subheadline, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(Color.neonInk)
                    Text(NeonFormat.percent(share * 100))
                        .font(.system(.caption, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(Color.neonTextTertiary)
                        .frame(minWidth: 34, alignment: .trailing)
                }
                ProgressBar(progress: share, tint: hue.color, height: 6)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func load() async {
        do {
            let loaded = try await api.fetchProjectAnalytics(id: projectId)
            withNeonAnimation(NeonMotion.gentle) {
                analytics = loaded.value
                cachedAt = loaded.cachedAt
            }
            errorMessage = nil
        } catch {
            if analytics == nil { errorMessage = error.localizedDescription }
        }
    }
}
