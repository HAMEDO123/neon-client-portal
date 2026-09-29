import SwiftUI

/// The manager's home tab — the admin dashboard: the studio's four figures,
/// the team's day (who needs the manager, most pressing first — silence is
/// shown as silence, never as a verdict), and every project.
struct AdminHomeView: View {
    @EnvironmentObject var api: APIClient
    @State private var overview: HomeOverview?
    @State private var overviewCachedAt: Date?
    @State private var overviewError: String?
    @State private var day: HomeDay?
    @State private var dayCachedAt: Date?
    @State private var dayError: String?
    @State private var showNewProject = false
    @State private var newProjectId: String?
    @State private var openProjectId: String?

    var body: some View {
        NavigationStack {
            NeonScroll {
                HomeGreetingHero(projectCount: overview?.stats.total)
                    .neonAppear()

                LoadStateView(value: overview, error: overviewError, cachedAt: overviewCachedAt, retry: loadOverview) {
                    StatGrid {
                        ForEach(0..<4, id: \.self) { _ in SkeletonStatTile() }
                    }
                } content: { overview in
                    StatGrid {
                        StatTile(L("Total Projects"), value: Double(overview.stats.total), symbol: "folder.fill", tint: .neonCyanStrong)
                        StatTile(L("Published"), value: Double(overview.stats.published), symbol: "checkmark.seal.fill", tint: .neonPurpleStrong)
                        StatTile(L("Pending Approvals"), value: Double(overview.stats.pendingApprovals), symbol: "clock.fill", tint: .neonOrangeStrong)
                        StatTile(L("Updated This Week"), value: Double(overview.stats.recentlyUpdated), symbol: "chart.line.uptrend.xyaxis", tint: .neonPinkStrong)
                    }
                }

                if let day {
                    SectionHeader(L("The day"), subtitle: longDayLabel(day.dayKey))
                    DayBoardSummary(summary: day.summary)
                    DayBoardPressing(days: day.pressing, dayLabel: longDayLabel(day.dayKey))
                    Text(L("An unanswered question is a question, not a verdict: nobody here is marked as having done nothing."))
                        .font(.neonCaption)
                        .foregroundStyle(Color.neonTextFaint)
                } else if let dayError {
                    ErrorState(message: dayError, retry: loadDay)
                } else {
                    SectionHeader(L("The day"))
                    SkeletonRows(count: 3)
                }

                if let overview {
                    SectionHeader(L("All Projects"), count: overview.projects.count)
                    if overview.projects.isEmpty {
                        EmptyState(symbol: "folder", title: L("No projects yet"), detail: L("Create your first client project to start building its delivery portal."))
                    } else {
                        VStack(spacing: NeonSpace.sm) {
                            ForEach(Array(overview.projects.enumerated()), id: \.element.id) { index, project in
                                Button {
                                    Haptic.tap()
                                    openProjectId = project.id
                                } label: {
                                    HomeProjectRow(project: project)
                                }
                                .buttonStyle(.pressableCard)
                                .staggered(index)
                            }
                        }
                    }
                }
            }
            .refreshable {
                Haptic.tap()
                await load()
            }
            .navigationTitle(L("Home"))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: NeonSpace.sm) {
                        Button {
                            Haptic.tap()
                            showNewProject = true
                        } label: {
                            Image(systemName: "plus.circle.fill")
                        }
                        .foregroundStyle(Color.neonInk)
                        AccountMenu()
                    }
                }
            }
            .sheet(isPresented: $showNewProject) {
                // The projects area's own new-project form, reused rather than
                // rebuilt: same fields, same action ("projects" → createProject).
                NewProjectSheet { newId in
                    newProjectId = newId
                    Task { await loadOverview() }
                }
            }
            .navigationDestination(isPresented: Binding(get: { newProjectId != nil }, set: { if !$0 { newProjectId = nil } })) {
                if let newProjectId { ProjectDetailView(projectId: newProjectId) }
            }
            .navigationDestination(isPresented: Binding(get: { openProjectId != nil }, set: { if !$0 { openProjectId = nil } })) {
                if let openProjectId { ProjectDetailView(projectId: openProjectId) }
            }
        }
        .task { await load() }
    }

    private func load() async {
        async let overviewTask: Void = loadOverview()
        async let dayTask: Void = loadDay()
        _ = await (overviewTask, dayTask)
    }

    private func loadOverview() async {
        do {
            let loaded = try await api.fetchHomeOverview()
            overview = loaded.value
            overviewCachedAt = loaded.cachedAt
            overviewError = nil
        } catch {
            overviewError = error.localizedDescription
        }
    }

    private func loadDay() async {
        do {
            let loaded = try await api.fetchHomeDay()
            day = loaded.value
            dayCachedAt = loaded.cachedAt
            dayError = nil
        } catch {
            dayError = error.localizedDescription
        }
    }
}

// MARK: - Greeting hero

/// The brand-gradient welcome card at the top of the home tab: a time-of-day
/// greeting, today's date, and — once it has loaded — how many projects the
/// studio is running. Purely decorative chrome; no server data of its own.
private struct HomeGreetingHero: View {
    let projectCount: Int?

    var body: some View {
        HStack(alignment: .top, spacing: NeonSpace.md) {
            VStack(alignment: .leading, spacing: NeonSpace.xs) {
                Text(L(greetingKey))
                    .font(.neonTitle2)
                    .foregroundStyle(.white)
                Text(todayLabel)
                    .font(.neonSubheadline)
                    .foregroundStyle(.white.opacity(0.85))
                if let projectCount {
                    Text(L("%d projects in the studio", projectCount))
                        .font(.neonFootnote.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.75))
                        .padding(.top, 2)
                }
            }
            Spacer(minLength: NeonSpace.sm)
            BrandMark(size: 46)
        }
        .padding(NeonSpace.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient.neonBrand)
        .clipShape(RoundedRectangle(cornerRadius: NeonRadius.xl, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: NeonRadius.xl, style: .continuous)
                .strokeBorder(.white.opacity(0.12), lineWidth: 1)
        )
        .neonShadow(.raised)
    }

    private var greetingKey: String {
        switch Calendar.current.component(.hour, from: Date()) {
        case 0..<12: return "Good morning"
        case 12..<17: return "Good afternoon"
        default: return "Good evening"
        }
    }

    private var todayLabel: String {
        let formatter = DateFormatter()
        formatter.locale = AppLanguage.current.locale
        formatter.setLocalizedDateFormatFromTemplate("EEEE, MMMM d")
        return formatter.string(from: Date())
    }
}

// MARK: - The day

private struct DayBoardTile {
    let title: String
    let value: Int
    let symbol: String
    let tint: Color
    let isAlert: Bool
}

private struct DayBoardSummary: View {
    let summary: DaySummary

    var body: some View {
        let tiles: [DayBoardTile] = [
            DayBoardTile(title: L("On the day"), value: summary.planned, symbol: "calendar", tint: .neonCyanStrong, isAlert: false),
            DayBoardTile(title: L("No plan yet"), value: summary.unplanned, symbol: "questionmark.circle.fill", tint: .neonWarningStrong, isAlert: summary.unplanned > 0),
            DayBoardTile(title: L("Blocked"), value: summary.blocked, symbol: "pause.circle.fill", tint: .neonDangerStrong, isAlert: summary.blocked > 0),
            DayBoardTile(title: L("Said started"), value: summary.contradictions, symbol: "exclamationmark.triangle.fill", tint: .neonDangerStrong, isAlert: summary.contradictions > 0),
            DayBoardTile(title: L("Overloaded"), value: summary.overloaded, symbol: "clock.fill", tint: .neonWarningStrong, isAlert: summary.overloaded > 0),
            DayBoardTile(title: L("Unanswered"), value: summary.unanswered, symbol: "bubble.left.and.exclamationmark.bubble.right.fill", tint: .neonPurpleStrong, isAlert: false),
        ]
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: NeonSpace.sm), count: 3), spacing: NeonSpace.sm) {
            ForEach(Array(tiles.enumerated()), id: \.offset) { index, tile in
                VStack(spacing: 6) {
                    Image(systemName: tile.symbol)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(tile.value > 0 ? tile.tint : Color.neonTextFaint)
                    Text(NeonFormat.integer(tile.value))
                        .font(.neonTitle3)
                        .foregroundStyle(tile.isAlert ? tile.tint : Color.neonInk)
                    Text(tile.title)
                        .font(.neonOverline)
                        .foregroundStyle(Color.neonTextTertiary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, NeonSpace.sm)
                .neonSurface(tile.isAlert ? .tinted(tile.tint) : .glass, radius: NeonRadius.md)
                .staggered(index)
            }
        }
    }
}

private struct DayBoardPressing: View {
    let days: [HomePersonDay]
    let dayLabel: String

    var body: some View {
        if days.isEmpty {
            Text(L("Nothing on %@ needs you right now.", dayLabel))
                .font(.neonSubheadline)
                .foregroundStyle(Color.neonTextSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, NeonSpace.xl)
                .neonSurface(.glass, radius: NeonRadius.lg)
        } else {
            VStack(spacing: NeonSpace.sm) {
                ForEach(days) { person in
                    PressingPersonCard(person: person)
                }
            }
        }
    }
}

private struct PressingPersonCard: View {
    let person: HomePersonDay

    var body: some View {
        NeonCard {
            HStack(alignment: .firstTextBaseline) {
                HStack(spacing: 8) {
                    Circle().fill(employeeFill(person.color)).frame(width: 8, height: 8)
                    DirText(person.name, font: .neonHeadline, fill: false)
                }
                Spacer(minLength: 8)
                Text(describeDayKind(
                    person.describeKind,
                    blocked: person.blocked.count,
                    contradictions: person.contradictions.count,
                    waiting: person.needsManager.count,
                    unanswered: person.unanswered
                ))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextTertiary)
            }

            if person.overloaded {
                Label(
                    L("%@ more than the day holds (%@ planned, %@ available)",
                      describeMinutes(Double(person.overBy)),
                      describeMinutes(Double(person.plannedMinutes)),
                      describeMinutes(Double(person.capacityMinutes))),
                    systemImage: "clock.fill"
                )
                .font(.neonCaption)
                .foregroundStyle(Color.neonWarningStrong)
            }

            ForEach(person.blocked) { row in
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "pause.circle.fill").font(.neonFootnote)
                    VStack(alignment: .leading, spacing: 2) {
                        DirText(row.taskName, font: .neonFootnote.weight(.semibold), color: .neonDangerStrong)
                        DirText(
                            row.who != nil ? "\(row.reason) — \(L("%@ can clear it", row.who!))" : row.reason,
                            font: .neonCaption, color: .neonTextSecondary
                        )
                    }
                }
                .foregroundStyle(Color.neonDangerStrong)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(NeonSpace.sm)
                .neonSurface(.tinted(.neonDanger), radius: NeonRadius.sm)
            }

            ForEach(person.contradictions) { row in
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill").font(.neonFootnote)
                    DirText(L("%@: said started, the board still says pending", row.taskName), font: .neonFootnote, color: .neonTextSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(NeonSpace.sm)
                .neonSurface(.outline, radius: NeonRadius.sm)
            }

            ForEach(person.needsManager) { row in
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "exclamationmark.circle.fill").font(.neonFootnote)
                    VStack(alignment: .leading, spacing: 2) {
                        DirText("\(row.taskName ?? L("Their day")) — \(describeManagerAnswer(row.answer))", font: .neonFootnote.weight(.semibold), color: .neonWarningStrong)
                        if let note = row.note {
                            DirText(note, font: .neonCaption, color: .neonTextSecondary)
                        }
                    }
                }
                .foregroundStyle(Color.neonWarningStrong)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(NeonSpace.sm)
                .neonSurface(.tinted(.neonWarning), radius: NeonRadius.sm)
            }
        }
    }
}

// MARK: - Projects

private struct HomeProjectRow: View {
    let project: HomeProject

    private var accentColor: Color { publishTone(project.publishState).color }

    var body: some View {
        HStack(spacing: NeonSpace.md) {
            RoundedRectangle(cornerRadius: 2)
                .fill(accentColor)
                .frame(width: 3)
                .padding(.vertical, 2)

            RemoteImage(url: resolvedMediaURL(project.coverImageUrl), contentMode: .fill)
                .frame(width: 64, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous)
                        .strokeBorder(Color.neonLine, lineWidth: 1)
                )

            VStack(alignment: .leading, spacing: 4) {
                DirText(project.name, font: .neonHeadline, fill: false, lineLimit: 1)
                HStack(spacing: 6) {
                    BadgeView(text: localizedEnum("publishState", project.publishState), tone: publishTone(project.publishState))
                    BadgeView(text: localizedEnum("pipelineStatus", project.pipelineStatus), tone: .neutral)
                }
                DirText(
                    project.location != nil ? "\(project.clientName) · \(project.location!)" : project.clientName,
                    font: .system(size: 13)
                )
                .foregroundStyle(Color.neonTextTertiary)
                .lineLimit(1)
            }

            Spacer(minLength: 4)

            VStack(alignment: .trailing, spacing: 4) {
                Label(L("%d approvals", project.approvals), systemImage: "checkmark.seal")
                    .font(.neonCaption2Ish)
                Label(L("%d comments", project.comments), systemImage: "bubble.left")
                    .font(.neonCaption2Ish)
            }
            .labelStyle(.trailingIconLabel)
            .foregroundStyle(Color.neonTextFaint)

            Image(systemName: "chevron.forward")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.neonTextFaint)
        }
        .padding(NeonSpace.sm)
        .neonSurface(.glass, radius: NeonRadius.lg)
    }
}

private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) {
            configuration.title
            configuration.icon.font(.system(size: 9))
        }
    }
}

private extension LabelStyle where Self == TrailingIconLabelStyle {
    static var trailingIconLabel: TrailingIconLabelStyle { TrailingIconLabelStyle() }
}

private extension Font {
    /// A touch smaller than `.neonCaption`, for two stacked figures.
    static var neonCaption2Ish: Font { .system(size: 10) }
}

private struct SkeletonStatTile: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            IconTile("circle", tint: .neonTextFaint, size: 34)
            Text("00").font(.neonNumber).hidden()
        }
        .padding(NeonSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .skeleton(true)
    }
}
