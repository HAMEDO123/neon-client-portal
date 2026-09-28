import SwiftUI

/// The Projects tab's list: search, filters by publish state, the studio's
/// figures, and every project — for the manager and the team alike.
struct ProjectListView: View {
    @EnvironmentObject var api: APIClient
    @State private var data: ProjectsListResponse?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var query = ""
    @State private var filter: PublishFilter = .all
    @State private var pipelineFilter: String?
    @State private var stageFilter: String?
    @State private var showNewProject = false
    @State private var showFilters = false

    enum PublishFilter: String, CaseIterable {
        case all, published = "PUBLISHED", draft = "DRAFT", archived = "ARCHIVED"

        var label: String {
            switch self {
            case .all: return L("All")
            case .published: return L("publish.PUBLISHED")
            case .draft: return L("publish.DRAFT")
            case .archived: return L("publish.ARCHIVED")
            }
        }

        var symbol: String {
            switch self {
            case .all: return "square.grid.2x2"
            case .published: return "checkmark.seal.fill"
            case .draft: return "pencil.circle"
            case .archived: return "archivebox"
            }
        }
    }

    var body: some View {
        Group {
            if let data {
                content(data)
            } else if let errorMessage {
                ErrorState(message: errorMessage) { await load() }
            } else {
                NeonScroll { SkeletonRows(count: 6) }
            }
        }
        .neonAmbientBackground()
        .navigationTitle(L("Projects"))
        .toolbar {
            if api.side == .admin {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Haptic.tap(); showNewProject = true } label: {
                        Image(systemName: "plus.circle.fill")
                    }
                    .foregroundStyle(Color.neonInk)
                }
            }
        }
        .sheet(isPresented: $showNewProject) {
            NewProjectSheet { newId in
                Task { await load() }
            }
        }
        .sheet(isPresented: $showFilters) {
            ProjectFilterSheet(pipelineFilter: $pipelineFilter, stageFilter: $stageFilter)
        }
        .task { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .neonDataChanged)) { _ in
            Task { await load() }
        }
    }

    @ViewBuilder
    private func content(_ data: ProjectsListResponse) -> some View {
        let filtered = filteredProjects(data.projects)
        NeonScroll {
            Text(L("An overview of every client project delivery."))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextSecondary)

            if let cachedAt { OfflineBanner(savedAt: cachedAt) }

            StatGrid {
                StatTile(L("Total Projects"), value: Double(data.stats.total), symbol: "folder.fill")
                StatTile(L("Published"), value: Double(data.stats.published), symbol: "checkmark.seal.fill", tint: .neonPurpleStrong)
                StatTile(L("Pending Approvals"), value: Double(data.stats.pendingApprovals), symbol: "clock.fill", tint: .neonOrangeStrong)
                StatTile(L("Updated This Week"), value: Double(data.stats.recentlyUpdated), symbol: "chart.line.uptrend.xyaxis", tint: .neonPinkStrong)
            }

            SearchField(text: $query, prompt: L("Search projects"))

            FilterChips(
                selection: $filter,
                options: PublishFilter.allCases,
                inset: 16,
                title: { $0.label },
                symbol: { $0.symbol },
                count: { option in option == .all ? data.projects.count : data.projects.filter { $0.publishState == option.rawValue }.count }
            )
            .padding(.horizontal, -16)

            HStack(spacing: 8) {
                Button {
                    Haptic.tap()
                    showFilters = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "line.3.horizontal.decrease.circle")
                        Text(L("Filters"))
                        if activeExtraFilters > 0 {
                            Text("\(activeExtraFilters)")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(minWidth: 16, minHeight: 16)
                                .background(Circle().fill(Color.neonInk))
                        }
                    }
                    .font(.neonFootnote.weight(.medium))
                    .foregroundStyle(activeExtraFilters > 0 ? Color.neonInk : Color.neonTextSecondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background {
                        if activeExtraFilters > 0 {
                            Capsule().fill(Color.neonCyan.opacity(0.16))
                        } else {
                            Capsule().fill(Color.white.opacity(0.78)).overlay(Capsule().strokeBorder(Color.neonLine, lineWidth: 1))
                        }
                    }
                }
                .buttonStyle(PressableStyle(scale: 0.96))

                if activeExtraFilters > 0 {
                    Button {
                        Haptic.tap()
                        withNeonAnimation(NeonMotion.snappy) {
                            pipelineFilter = nil
                            stageFilter = nil
                        }
                    } label: {
                        Text(L("Clear Filters"))
                            .font(.neonFootnote.weight(.medium))
                            .foregroundStyle(Color.neonTextTertiary)
                    }
                    .buttonStyle(.plain)
                }

                Spacer(minLength: 0)
            }

            if filtered.isEmpty {
                EmptyState(
                    symbol: "folder",
                    title: L("No projects yet"),
                    detail: query.isEmpty ? nil : L("Nothing matches “%@”.", query)
                )
                .padding(.top, 24)
            } else {
                VStack(spacing: 10) {
                    ForEach(Array(filtered.enumerated()), id: \.element.id) { index, project in
                        NavigationLink(value: ProjectRoute(id: project.id, seed: project)) {
                            ProjectRow(project: project)
                        }
                        .buttonStyle(.pressableCard)
                        .staggered(index)
                    }
                }
            }
        }
        .refreshable { await load() }
    }

    private var activeExtraFilters: Int {
        (pipelineFilter != nil ? 1 : 0) + (stageFilter != nil ? 1 : 0)
    }

    private func filteredProjects(_ projects: [ProjectSummary]) -> [ProjectSummary] {
        var list = projects
        if filter != .all { list = list.filter { $0.publishState == filter.rawValue } }
        if let pipelineFilter { list = list.filter { $0.pipelineStatus == pipelineFilter } }
        if let stageFilter { list = list.filter { $0.currentStage == stageFilter } }
        if !query.isEmpty {
            list = list.filter { $0.name.matchesSearch(query) || $0.clientName.matchesSearch(query) }
        }
        return list
    }

    private func load() async {
        do {
            let loaded = try await api.fetchProjectsList()
            withAnimation(.easeOut(duration: 0.3)) {
                data = loaded.value
                cachedAt = loaded.cachedAt
            }
            errorMessage = nil
        } catch {
            if data == nil { errorMessage = error.localizedDescription }
        }
    }
}

struct ProjectRow: View {
    let project: ProjectSummary

    var body: some View {
        NeonCard {
            HStack(spacing: 12) {
                RemoteImage(url: project.resolvedCoverURL, contentMode: .fill)
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous))

                VStack(alignment: .leading, spacing: 4) {
                    DirText(project.name, font: .neonHeadline)
                    DirText(project.clientName, font: .neonFootnote, color: .neonTextSecondary)
                    HStack(spacing: 6) {
                        BadgeView(text: localizedEnum("pipeline", project.pipelineStatus), tone: .purple)
                        if project.publishState != "PUBLISHED" {
                            BadgeView(text: localizedEnum("publish", project.publishState), tone: publishTone(project.publishState))
                        }
                        if project.approvalsCount > 0 {
                            MetaLabel("\(project.approvalsCount)", symbol: "checkmark.seal")
                        }
                    }
                }
                Spacer()
                Image(systemName: "chevron.forward")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.neonTextTertiary)
            }
        }
    }
}
