import SwiftUI

/// Which of Home's figures a project list was opened from. Each is a filter
/// over the projects Home already holds (home/overview), counted exactly as
/// the server counts the figure on the card.
enum HomeProjectFilter: String, Hashable, CaseIterable {
    /// "Published": `publishState == PUBLISHED`, the projects clients can open.
    case published
    /// "Updated This Week": `updatedAt` within the last 7 × 24 hours.
    case updated

    var title: String {
        switch self {
        case .published: return L("Published projects")
        case .updated: return L("Updated this week")
        }
    }

    var detail: String {
        switch self {
        case .published: return L("Clients can open these through their link.")
        case .updated: return L("Last changed in the last 7 days, most recent first.")
        }
    }

    var symbol: String {
        switch self {
        case .published: return "checkmark.seal.fill"
        case .updated: return "chart.line.uptrend.xyaxis"
        }
    }

    var hue: NeonHue {
        switch self {
        case .published: return .purple
        case .updated: return .pink
        }
    }

    var emptyTitle: String {
        switch self {
        case .published: return L("No project is published yet")
        case .updated: return L("Nothing was updated this week")
        }
    }

    func matches(_ project: HomeProject, now: Date = Date()) -> Bool {
        switch self {
        case .published:
            return project.publishState == "PUBLISHED"
        case .updated:
            guard let updated = parseISODate(project.updatedAt) else { return false }
            return now.timeIntervalSince(updated) < 7 * 86_400
        }
    }
}

/// The projects behind one of Home's figures, each opening its own page.
struct HomeProjectListView: View {
    let filter: HomeProjectFilter
    let projects: [HomeProject]
    let onOpen: (String) -> Void

    var body: some View {
        let shown = projects.filter { filter.matches($0) }
        NeonScroll(spacing: NeonSpace.stack) {
            if shown.isEmpty {
                EmptyState(symbol: filter.symbol, title: filter.emptyTitle, detail: filter.detail, hue: filter.hue, card: true)
            } else {
                SectionHeader(filter.title, subtitle: filter.detail, count: shown.count)
                VStack(spacing: NeonSpace.sm) {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, project in
                        Button {
                            Haptic.tap()
                            onOpen(project.id)
                        } label: {
                            ListCardRow(
                                project.name,
                                subtitle: project.location.map { "\(project.clientName) · \($0)" } ?? project.clientName,
                                leading: .thumbnail(url: resolvedMediaURL(project.coverImageUrl)),
                                time: shortTime(project.updatedAt),
                                badge: localizedEnum("publish", project.publishState),
                                badgeTone: publishTone(project.publishState)
                            )
                        }
                        .buttonStyle(.pressableCard)
                        .staggered(index)
                    }
                }
            }
        }
        .navigationTitle(filter.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
