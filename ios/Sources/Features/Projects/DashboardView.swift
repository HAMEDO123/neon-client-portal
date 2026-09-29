import SwiftUI

/// The Projects tab's list: the studio's figures, where every project stands
/// in the pipeline, search, filters by publish state (and, in a sheet, by
/// pipeline status and journey stage), and every project on a card led by
/// its cover — for the manager and the team alike.
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
    @State private var createdProjectId: String?
    @AppStorage("projects.list.grid") private var gridLayout = false

    enum PublishFilter: String, CaseIterable {
        case all, published = "PUBLISHED", draft = "DRAFT", archived = "ARCHIVED"

        var label: String {
            // The filter chips once showed the raw key ("publish.PUBLISHED"):
            // L() has no English table, localizedEnum() humanizes the value.
            self == .all ? L("All") : localizedEnum("publish", rawValue)
        }

        var symbol: String {
            self == .all ? "square.grid.2x2" : ProjectPublishStyle.symbol(rawValue)
        }
    }

    var body: some View {
        ScrollViewReader { proxy in
            NeonScroll(spacing: NeonSpace.stack) {
                header

                if let data {
                    content(data)
                } else if let errorMessage {
                    ErrorState(message: errorMessage) { await load() }
                } else {
                    loadingPlaceholder
                }
            }
            .refreshable { await load() }
            .debugScroll(proxy)
        }
        .toolbar(.hidden, for: .navigationBar)
        .floatingActionButton("plus", label: L("New Project"), isVisible: api.side == .admin && data != nil) {
            showNewProject = true
        }
        .navigationDestination(isPresented: Binding(
            get: { createdProjectId != nil },
            set: { if !$0 { createdProjectId = nil } }
        )) {
            if let createdProjectId { ProjectDetailView(projectId: createdProjectId) }
        }
        .sheet(isPresented: $showNewProject) {
            NewProjectSheet { newId in
                Task { await load() }
                // Straight into the new project, where its renders go next.
                if let newId, !newId.isEmpty {
                    Task { @MainActor in
                        try? await Task.sleep(nanoseconds: 450_000_000)
                        createdProjectId = newId
                    }
                }
            }
        }
        .sheet(isPresented: $showFilters) {
            ProjectFilterSheet(pipelineFilter: $pipelineFilter, stageFilter: $stageFilter, projects: data?.projects ?? [])
        }
        .task { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .neonDataChanged)) { _ in
            Task { await load() }
        }
    }

    // MARK: - Header

    private var header: some View {
        ScreenHeader(L("Projects"), subtitle: L("Every client project, newest first")) {
            IconButton(
                gridLayout ? "rectangle.grid.1x2" : "square.grid.2x2",
                label: gridLayout ? L("Show as list") : L("Show as grid"),
                size: NeonSize.circleButton
            ) {
                withNeonAnimation(NeonMotion.smooth) { gridLayout.toggle() }
            }
            IconButton(
                "line.3.horizontal.decrease",
                label: L("Filters"),
                size: NeonSize.circleButton,
                badge: activeExtraFilters > 0 ? activeExtraFilters : nil
            ) {
                showFilters = true
            }
        }
    }

    // MARK: - Content

    @ViewBuilder
    private func content(_ data: ProjectsListResponse) -> some View {
        let filtered = filteredProjects(data.projects)

        if let cachedAt { OfflineBanner(savedAt: cachedAt) }

        StatGrid(columns: 4) {
            KPICard(L("Total Projects"), value: Double(data.stats.total), symbol: "folder.fill", hue: .blue, density: .compact)
            KPICard(L("Published"), value: Double(data.stats.published), symbol: "checkmark.seal.fill", hue: .purple, density: .compact)
            KPICard(L("Pending Approvals"), value: Double(data.stats.pendingApprovals), symbol: "clock.fill", hue: .orange, density: .compact)
            KPICard(L("Updated This Week"), value: Double(data.stats.recentlyUpdated), symbol: "chart.line.uptrend.xyaxis", hue: .pink, density: .compact)
        }
        .id("stats")

        if !data.projects.isEmpty {
            pipelineCard(data.projects)
                .id("pipeline")
        }

        VStack(alignment: .leading, spacing: NeonSpace.stack) {
            SearchField(text: $query, prompt: L("Search projects"))
            // Separate chips rather than the pill bar: "Published" and
            // "Archived" do not fit a quarter of a phone's width in English.
            FilterChips(
                selection: $filter,
                options: PublishFilter.allCases,
                inset: NeonSpace.gutter,
                title: { $0.label },
                symbol: { $0.symbol },
                count: { option in
                    option == .all ? data.projects.count : data.projects.filter { $0.publishState == option.rawValue }.count
                }
            )
            .padding(.horizontal, -NeonSpace.gutter)
            if activeExtraFilters > 0 {
                activeFilterChips
                    .transition(.neonRise)
            }
        }
        .padding(.top, NeonSpace.xs)
        .id("filters")

        if data.projects.isEmpty {
            EmptyState(
                symbol: "folder",
                title: L("No projects yet"),
                detail: api.side == .admin
                    ? L("Create the first one and it shows here.")
                    : L("When the studio starts a project, it shows here."),
                actionTitle: api.side == .admin ? L("New Project") : nil,
                action: api.side == .admin ? { showNewProject = true } : nil,
                hue: .blue,
                card: true
            )
        } else if filtered.isEmpty {
            EmptyState(
                symbol: "magnifyingglass",
                title: L("No projects match"),
                detail: query.isEmpty ? L("None of the projects fit these filters.") : L("Nothing matches “%@”.", query),
                actionTitle: L("Clear Filters"),
                action: clearAll,
                hue: .indigo,
                card: true
            )
        } else {
            SectionHeader(
                filter == .all ? L("All Projects") : filter.label,
                subtitle: L("Newest update first"),
                count: filtered.count
            )
            .padding(.top, NeonSpace.sm)
            .id("list")

            if gridLayout {
                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: NeonSpace.stack, alignment: .top), GridItem(.flexible(), spacing: NeonSpace.stack, alignment: .top)],
                    spacing: NeonSpace.stack
                ) {
                    ForEach(Array(filtered.enumerated()), id: \.element.id) { index, project in
                        NavigationLink(value: ProjectRoute(id: project.id, seed: project)) {
                            ProjectCoverTile(project: project)
                        }
                        .buttonStyle(.pressableCard)
                        .staggered(index)
                    }
                }
                .transition(.opacity)
            } else {
                ForEach(Array(filtered.enumerated()), id: \.element.id) { index, project in
                    NavigationLink(value: ProjectRoute(id: project.id, seed: project)) {
                        ProjectCoverCard(project: project)
                    }
                    .buttonStyle(.pressableCard)
                    .staggered(index)
                }
            }

            if api.side == .admin {
                // Room for the floating "New Project" button over the last card.
                Color.clear.frame(height: NeonSize.fab)
            }
        }
    }

    /// Every pipeline status that has a project, as one bar and a key whose
    /// entries filter the list — the same filter the sheet sets.
    @ViewBuilder
    private func pipelineCard(_ projects: [ProjectSummary]) -> some View {
        let segments = pipelineSegments(projects)
        SectionCard(
            L("Project Pipeline"),
            subtitle: L("Where every project stands"),
            symbol: "square.stack.3d.up.fill",
            hue: .blue
        ) {
            SegmentedProgressBar(segments)
            FlowRow(spacing: NeonSpace.sm) {
                ForEach(segments) { segment in
                    ProjectPipelineKey(
                        segment: segment,
                        isSelected: pipelineFilter == segment.id
                    ) {
                        withNeonAnimation(NeonMotion.snappy) {
                            pipelineFilter = pipelineFilter == segment.id ? nil : segment.id
                        }
                    }
                }
            }
        }
    }

    private func pipelineSegments(_ projects: [ProjectSummary]) -> [ProgressSegment] {
        let counts = Dictionary(grouping: projects, by: \.pipelineStatus).mapValues(\.count)
        // The website's order first; anything newer the server adds, after it.
        let order = ProjectConstants.pipelineStatuses + counts.keys.filter { !ProjectConstants.pipelineStatuses.contains($0) }.sorted()
        return order.compactMap { status in
            guard let count = counts[status], count > 0 else { return nil }
            return ProgressSegment(localizedEnum("pipeline", status), value: Double(count), hue: ProjectPipelineStyle.hue(status), id: status)
        }
    }

    private var activeFilterChips: some View {
        FlowRow(spacing: NeonSpace.sm) {
            if let pipelineFilter {
                Chip(localizedEnum("pipeline", pipelineFilter), symbol: "xmark.circle.fill", isSelected: true) {
                    withNeonAnimation(NeonMotion.snappy) { self.pipelineFilter = nil }
                }
                .accessibilityHint(Text(L("Removes this filter")))
            }
            if let stageFilter {
                Chip(projectStageLabel(stageFilter), symbol: "xmark.circle.fill", isSelected: true) {
                    withNeonAnimation(NeonMotion.snappy) { self.stageFilter = nil }
                }
                .accessibilityHint(Text(L("Removes this filter")))
            }
            Button {
                Haptic.tap()
                withNeonAnimation(NeonMotion.snappy) {
                    pipelineFilter = nil
                    stageFilter = nil
                }
            } label: {
                Text(L("Clear Filters"))
                    .font(.system(.footnote, weight: .semibold))
                    .foregroundStyle(Color.neonTextSecondary)
                    .frame(minHeight: 36)
                    .padding(.horizontal, 6)
            }
            .buttonStyle(.pressable)
        }
    }

    private var loadingPlaceholder: some View {
        VStack(alignment: .leading, spacing: NeonSpace.stack) {
            StatGrid(columns: 4) {
                ForEach(0..<4, id: \.self) { _ in SkeletonKPICard(compact: true) }
            }
            SkeletonCard(lines: 2)
            ForEach(0..<3, id: \.self) { _ in ProjectCoverSkeleton() }
        }
    }

    // MARK: - Filtering and loading

    private var activeExtraFilters: Int {
        (pipelineFilter != nil ? 1 : 0) + (stageFilter != nil ? 1 : 0)
    }

    private func clearAll() {
        withNeonAnimation(NeonMotion.snappy) {
            query = ""
            filter = .all
            pipelineFilter = nil
            stageFilter = nil
        }
    }

    private func filteredProjects(_ projects: [ProjectSummary]) -> [ProjectSummary] {
        var list = projects
        if filter != .all { list = list.filter { $0.publishState == filter.rawValue } }
        if let pipelineFilter { list = list.filter { $0.pipelineStatus == pipelineFilter } }
        if let stageFilter { list = list.filter { $0.currentStage == stageFilter } }
        if !query.isEmpty {
            list = list.filter { matchesSearch(query, $0.name, $0.clientName, $0.location) }
        }
        return list
    }

    private func load() async {
        do {
            let loaded = try await api.fetchProjectsList()
            withNeonAnimation(NeonMotion.gentle) {
                data = loaded.value
                cachedAt = loaded.cachedAt
            }
            errorMessage = nil
        } catch {
            if data == nil { errorMessage = error.localizedDescription }
        }
    }
}

// MARK: - Pieces

/// One entry of the pipeline bar's key: the colour, the count, the status —
/// a button that narrows the list to it.
private struct ProjectPipelineKey: View {
    let segment: ProgressSegment
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button {
            Haptic.selection()
            action()
        } label: {
            HStack(spacing: 6) {
                Circle()
                    .fill(segment.hue.color)
                    .frame(width: 8, height: 8)
                Text(NeonFormat.number(segment.value))
                    .font(.system(.subheadline, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(Color.neonInk)
                Text(segment.label)
                    .font(.system(.footnote, weight: .medium))
                    .foregroundStyle(isSelected ? segment.hue.deep : Color.neonTextSecondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 32)
            .background(Capsule().fill(isSelected ? segment.hue.wash : Color.neonSurfaceSunken))
            .overlay(Capsule().strokeBorder(isSelected ? segment.hue.color.opacity(0.5) : Color.clear, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(PressableStyle(scale: 0.95))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// A project on its own card, led by its cover: the publish state, the
/// client's activity counts and the journey stage on the photo; the name,
/// the client and place, the pipeline status and the last update under it.
struct ProjectCoverCard: View {
    let project: ProjectSummary

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            ProjectCoverPhoto(project: project, height: 168, showsStage: true)

            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .center, spacing: 8) {
                    DirText(project.name, font: .neonCardTitle, fill: false, lineLimit: 1)
                    Spacer(minLength: 6)
                    if let completion = project.completionPercent {
                        Text(NeonFormat.percent(Double(completion)))
                            .font(.system(.subheadline, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(Color.neonInk.opacity(0.82))
                    }
                    Image(systemName: "chevron.forward")
                        .font(.system(.caption, weight: .semibold))
                        .foregroundStyle(Color.neonTextFaint)
                }
                DirText(project.clientLine, font: .neonSubtitle, color: .neonTextSecondary, fill: false, lineLimit: 1)
                HStack(spacing: 8) {
                    ProjectStatusPill(status: project.pipelineStatus)
                    Spacer(minLength: 4)
                    if let ago = projectTimeAgo(project.updatedAt) {
                        MetaLabel(ago, symbol: "clock")
                    }
                }
                .padding(.top, 5)
                if let completion = project.completionPercent {
                    ProgressBar(progress: Double(completion) / 100, height: 6)
                        .padding(.top, 6)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 14)
        }
        .clipShape(shape)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .neonContextShape(radius: NeonRadius.lg)
        .accessibilityElement(children: .combine)
    }
}

/// The same project, two to a row: the cover, the name, the client, the status.
struct ProjectCoverTile: View {
    let project: ProjectSummary

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            ProjectCoverPhoto(project: project, height: 120, showsStage: false)
            VStack(alignment: .leading, spacing: 4) {
                DirText(project.name, font: .system(.subheadline, weight: .bold), fill: false, lineLimit: 1)
                DirText(project.clientName, font: .system(.caption), color: .neonTextSecondary, fill: false, lineLimit: 1)
                ProjectStatusPill(status: project.pipelineStatus)
                    .padding(.top, 4)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .clipShape(shape)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .neonContextShape(radius: NeonRadius.lg)
        .accessibilityElement(children: .combine)
    }
}

/// A project's cover with what the client side of it looks like laid over:
/// published or not, and how many approvals and comments it holds.
private struct ProjectCoverPhoto: View {
    let project: ProjectSummary
    let height: CGFloat
    let showsStage: Bool

    var body: some View {
        let hasCover = project.resolvedCoverURL != nil
        Group {
            if hasCover {
                RemoteImage(url: project.resolvedCoverURL, contentMode: .fill, placeholderSymbol: "photo.on.rectangle.angled")
                    .overlay {
                        // A scrim only where the badges sit, so the photo stays bright.
                        LinearGradient(colors: [.black.opacity(0.22), .clear, .clear, .black.opacity(showsStage ? 0.28 : 0)], startPoint: .top, endPoint: .bottom)
                    }
            } else {
                ProjectCoverFallback(name: project.name, compact: !showsStage)
            }
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .overlay(alignment: .topLeading) {
            ProjectPublishPill(state: project.publishState, onPhoto: true)
                .padding(10)
        }
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 4) {
                if project.approvalsCount > 0 {
                    ProjectPhotoBadge(text: NeonFormat.integer(project.approvalsCount), symbol: "checkmark.seal.fill")
                        .accessibilityLabel(Text(L("Approvals: %d", project.approvalsCount)))
                }
                if project.commentsCount > 0 {
                    ProjectPhotoBadge(text: NeonFormat.integer(project.commentsCount), symbol: "bubble.left.fill")
                        .accessibilityLabel(Text(L("Comments: %d", project.commentsCount)))
                }
            }
            .padding(10)
        }
        .overlay(alignment: .bottomLeading) {
            if showsStage {
                ProjectPhotoBadge(text: projectStageLabel(project.currentStage), symbol: "flag.fill")
                    .padding(10)
            }
        }
    }
}

/// A project with no cover yet: its own pastel (the same one wherever its
/// name appears) and a quiet note that the cover is missing.
private struct ProjectCoverFallback: View {
    let name: String
    let compact: Bool

    var body: some View {
        let hue = NeonPalette.hue(for: name)
        ZStack {
            LinearGradient(colors: [hue.wash, hue.pastel], startPoint: .topLeading, endPoint: .bottomTrailing)
                // A glow toward the trailing top, drawn over the gradient so it
                // never sizes the card.
                .overlay(alignment: .topTrailing) {
                    Circle()
                        .fill(hue.color.opacity(0.16))
                        .frame(width: 180, height: 180)
                        .blur(radius: 40)
                        .offset(x: 60, y: -70)
                        .flipsForRightToLeftLayoutDirection(true)
                }
            VStack(spacing: 6) {
                IconTile("photo.on.rectangle.angled", hue: hue, size: compact ? 36 : 46, style: .filled)
                if !compact {
                    Text(L("No cover photo yet"))
                        .font(.system(.caption, weight: .semibold))
                        .foregroundStyle(hue.deep.opacity(0.8))
                }
            }
        }
        .clipped()
        .accessibilityHidden(true)
    }
}

/// A cover card still loading.
private struct ProjectCoverSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SkeletonBlock(height: 150, radius: 0)
            VStack(alignment: .leading, spacing: 9) {
                SkeletonBlock(height: 14).frame(maxWidth: 170)
                SkeletonBlock(height: 10).frame(maxWidth: 120)
                SkeletonBlock(width: 96, height: 20, radius: 10)
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 14)
        }
        .clipShape(RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous))
        .neonSurface(.glass, radius: NeonRadius.lg)
        .shimmer()
        .accessibilityLabel(L("Loading"))
    }
}

extension ProjectSummary {
    /// "Client · Place", or just the client.
    var clientLine: String {
        guard let location, !location.trimmingCharacters(in: .whitespaces).isEmpty else { return clientName }
        return clientName.isEmpty ? location : "\(clientName) · \(location)"
    }
}
