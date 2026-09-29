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
                    StatGrid {
                        ForEach(0..<4, id: \.self) { _ in SkeletonKPICard() }
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

            StatGrid {
                KPICard(L("Project Opens"), value: Double(analytics.views), symbol: "eye.fill", hue: .blue)
                // The client page does not log render views yet (README, Known
                // issues), so a zero here is "not recorded", never "not looked at".
                KPICard(
                    L("Renders Viewed"), value: Double(analytics.renderViews), symbol: "photo.fill", hue: .purple,
                    caption: analytics.renderViews == 0 ? L("Not recorded by the client page yet") : nil
                )
                KPICard(L("Downloads"), value: Double(analytics.downloads), symbol: "arrow.down.circle.fill", hue: .green)
                KPICard(L("Approval Responses"), value: Double(analytics.approvals), symbol: "checkmark.seal.fill", hue: .orange)
                KPICard(L("Comments"), value: Double(analytics.comments), symbol: "bubble.left.fill", hue: .pink)
                KPICard(L("All Activity"), value: Double(analytics.totalEvents), symbol: "waveform.path.ecg", hue: .indigo)
            }
            .id("figures")

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
                        subtitle: L("Everything the client did, by kind"),
                        symbol: "chart.pie.fill",
                        hue: .purple
                    ) {
                        NeonDonutChart(
                            breakdown(analytics),
                            size: 132,
                            lineWidth: 20,
                            centerValue: NeonFormat.integer(analytics.totalEvents),
                            centerTitle: L("events")
                        )
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

    /// Largest first; the chart gives each slice the next colour of the palette.
    private func breakdown(_ analytics: ProjectAnalytics) -> [ChartPoint] {
        analytics.byType
            .sorted { $0.count.type > $1.count.type }
            .map { ChartPoint(projectActivityLabel($0.type), Double($0.count.type), id: $0.type) }
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
