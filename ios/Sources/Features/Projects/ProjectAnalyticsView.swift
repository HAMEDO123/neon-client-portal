import SwiftUI

/// A project's client-side activity — what the manager and team see behind
/// the Analytics tab.
struct ProjectAnalyticsView: View {
    let projectId: String

    @EnvironmentObject var api: APIClient
    @State private var analytics: ProjectAnalytics?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let analytics {
                content(analytics)
            } else if let errorMessage {
                ErrorState(message: errorMessage) { await load() }
            } else {
                SkeletonRows(count: 4)
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private func content(_ analytics: ProjectAnalytics) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            StatGrid {
                StatTile(L("Project Opens"), value: Double(analytics.views), symbol: "eye")
                StatTile(L("Renders Viewed"), value: Double(analytics.renderViews), symbol: "photo")
                StatTile(L("Downloads"), value: Double(analytics.downloads), symbol: "arrow.down.circle")
                StatTile(L("Approval Responses"), value: Double(analytics.approvals), symbol: "checkmark.seal")
                StatTile(L("Comments"), value: Double(analytics.comments), symbol: "bubble.left")
            }

            if analytics.totalEvents == 0 {
                EmptyState(
                    symbol: "chart.bar",
                    title: L("No client activity yet"),
                    detail: L("Once the client opens their project link, their activity will appear here.")
                )
            } else {
                if !analytics.byType.isEmpty {
                    NeonCard {
                        SectionLabel(L("Activity Breakdown"))
                        NeonBarChart(
                            analytics.byType
                                .sorted { $0.count.type > $1.count.type }
                                .map { ChartPoint(activityLabel($0.type), Double($0.count.type)) }
                        )
                    }
                }

                NeonCard {
                    SectionLabel(L("Recent Activity"))
                    VStack(spacing: 0) {
                        ForEach(Array(analytics.recent.enumerated()), id: \.element.id) { index, item in
                            if index > 0 { NeonDivider() }
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(activityLabel(item.type)).font(.neonCallout)
                                    if let detail = item.detail, !detail.isEmpty {
                                        DirText(detail, font: .neonCaption, color: .neonTextTertiary)
                                    }
                                }
                                Spacer()
                                Text(relativeTime(item.createdAt))
                                    .font(.neonCaption)
                                    .foregroundStyle(Color.neonTextTertiary)
                            }
                            .padding(.vertical, 8)
                        }
                    }
                }
            }
        }
    }

    private func load() async {
        do {
            let loaded = try await api.fetchProjectAnalytics(id: projectId)
            withAnimation(.easeOut(duration: 0.3)) { analytics = loaded.value }
            errorMessage = nil
        } catch {
            if analytics == nil { errorMessage = error.localizedDescription }
        }
    }
}

/// Server activity-log codes (lib/activity-labels.ts) → studio words.
private func activityLabel(_ type: String) -> String { localizedEnum("activity", type) }

private func relativeTime(_ iso: String) -> String {
    guard let date = parseISODate(iso) else { return "" }
    let minutes = Int(-date.timeIntervalSinceNow / 60)
    if minutes < 1 { return L("just now") }
    if minutes < 60 { return L("%dm ago", minutes) }
    let hours = minutes / 60
    if hours < 24 { return L("%dh ago", hours) }
    let days = hours / 24
    if days < 30 { return L("%dd ago", days) }
    return formattedDay(iso) ?? ""
}
