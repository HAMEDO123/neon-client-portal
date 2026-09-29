import SwiftUI

/// The manager's home tab — the admin dashboard: a warm gradient greeting,
/// the studio's four figures, what needs the manager first, quick actions,
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
    @State private var showHandOutTask = false
    @State private var showSetMeeting = false
    @State private var showAlerts = false
    @State private var destination: HomeLinkDestination?

    var body: some View {
        NavigationStack {
            NeonScroll(spacing: NeonSpace.xxl) {
                HomeGreetingHero()

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

                    SectionLabel(L("Needs you"))
                    NeedsYouStrip(
                        badges: overview.badges,
                        onReviews: { destination = .reviews },
                        onAlerts: { showAlerts = true },
                        onRequests: { destination = .requests }
                    )
                }

                SectionLabel(L("Quick actions"))
                QuickActionsGrid(
                    onNewProject: { showNewProject = true },
                    onHandOutTask: { showHandOutTask = true },
                    onSetMeeting: { showSetMeeting = true },
                    onOpenBoard: { destination = .tasksBoard }
                )

                if let day {
                    SectionHeader(L("The day"), subtitle: longDayLabel(day.dayKey))
                    if !day.everyone.isEmpty {
                        TeamDayAvatarRow(people: day.everyone, onTap: { destination = .employee(id: $0) })
                    }
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
                    if !overview.projects.isEmpty {
                        SectionLabel(L("Recent projects"))
                        ProjectCarousel(
                            projects: Array(overview.projects.prefix(8)),
                            onTap: { destination = .project(id: $0) }
                        )
                    }

                    SectionHeader(L("All Projects"), count: overview.projects.count)
                    if overview.projects.isEmpty {
                        EmptyState(symbol: "folder", title: L("No projects yet"), detail: L("Create your first client project to start building its delivery portal."))
                    } else {
                        VStack(spacing: NeonSpace.sm) {
                            ForEach(overview.projects) { project in
                                HomeProjectRow(project: project, onTap: { destination = .project(id: project.id) })
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
            .navigationBarTitleDisplayMode(.inline)
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
            .sheet(isPresented: $showHandOutTask) {
                // The chat area's own compose sheet, reused with the team
                // channel: the same form, the same action, one fewer place
                // this could drift from the chat's own "+ → Task".
                ChatTaskComposeSheet(conversationSlug: "team") { Task { await loadDay() } }
            }
            .sheet(isPresented: $showSetMeeting) {
                ChatMeetingComposeSheet(conversationSlug: "team")
            }
            .navigationDestination(isPresented: Binding(get: { newProjectId != nil }, set: { if !$0 { newProjectId = nil } })) {
                if let newProjectId { ProjectDetailView(projectId: newProjectId) }
            }
            .navigationDestination(isPresented: Binding(get: { destination != nil }, set: { if !$0 { destination = nil } })) {
                homeDestinationView(destination)
            }
            .navigationDestination(isPresented: $showAlerts) {
                AlertsRootView()
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

// MARK: - Hero

/// The top of the dashboard: a greeting by time of day, today's date and the
/// studio's own mark, on the brand's own gradient. Nothing here reads from
/// the server — it says when it is, not what happened.
private struct HomeGreetingHero: View {
    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.md) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(greeting)
                        .font(.system(size: 23, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    Text(dateLabel)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white.opacity(0.82))
                }
                Spacer(minLength: 8)
                Text(verbatim: "NEON")
                    .font(.system(size: 15, weight: .heavy, design: .rounded))
                    .tracking(2.2)
                    .foregroundStyle(.white.opacity(0.9))
                    .environment(\.layoutDirection, .leftToRight)
            }
            Text(L("An overview of every client project delivery."))
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.8))
        }
        .padding(NeonSpace.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.brand, radius: NeonRadius.xxl)
        .neonAppear()
    }

    private var greeting: String {
        switch Calendar.current.component(.hour, from: Date()) {
        case 0..<12: return L("Good morning")
        case 12..<17: return L("Good afternoon")
        default: return L("Good evening")
        }
    }

    private var dateLabel: String {
        var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: AppLanguage.current.locale)
        style = style.weekday(.wide).day().month(.wide)
        return Date().formatted(style)
    }
}

// MARK: - Needs you

/// Bright, tappable counts for the three things most likely to be waiting on
/// the manager right now — each opens this area's own screen for it.
private struct NeedsYouStrip: View {
    let badges: HomeAdminBadges
    let onReviews: () -> Void
    let onAlerts: () -> Void
    let onRequests: () -> Void

    private struct Item {
        let title: String
        let count: Int
        let symbol: String
        let tint: Color
        let action: () -> Void
    }

    var body: some View {
        let items: [Item] = [
            Item(title: L("Reviews waiting"), count: badges.reviews, symbol: "tray.and.arrow.down.fill", tint: .neonPurpleStrong, action: onReviews),
            Item(title: L("Unread alerts"), count: badges.alerts, symbol: "bell.badge.fill", tint: .neonPinkStrong, action: onAlerts),
            Item(title: L("Open requests"), count: badges.requests, symbol: "shippingbox.fill", tint: .neonOrangeStrong, action: onRequests),
        ]
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: NeonSpace.sm) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    Button {
                        Haptic.tap()
                        item.action()
                    } label: {
                        HStack(spacing: 10) {
                            IconTile(item.symbol, tint: item.tint, size: 36, style: item.count > 0 ? .filled : .soft)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(NeonFormat.integer(item.count))
                                    .font(.system(size: 17, weight: .bold, design: .rounded))
                                    .foregroundStyle(Color.neonInk)
                                Text(item.title)
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(Color.neonTextSecondary)
                                    .lineLimit(1)
                            }
                        }
                        .padding(.horizontal, NeonSpace.md)
                        .padding(.vertical, NeonSpace.sm)
                        .neonSurface(item.count > 0 ? .tinted(item.tint) : .glass, radius: NeonRadius.lg)
                    }
                    .buttonStyle(.pressableCard)
                }
            }
            .padding(.vertical, 2)
        }
    }
}

// MARK: - Quick actions

private struct QuickActionsGrid: View {
    let onNewProject: () -> Void
    let onHandOutTask: () -> Void
    let onSetMeeting: () -> Void
    let onOpenBoard: () -> Void

    private struct Action {
        let title: String
        let symbol: String
        let tint: Color
        let action: () -> Void
    }

    var body: some View {
        let actions: [Action] = [
            Action(title: L("New project"), symbol: "plus.circle.fill", tint: .neonPurpleStrong, action: onNewProject),
            Action(title: L("Hand out a task"), symbol: "checklist", tint: .neonCyanStrong, action: onHandOutTask),
            Action(title: L("Set a meeting"), symbol: "calendar.badge.plus", tint: .neonPinkStrong, action: onSetMeeting),
            Action(title: L("Open the board"), symbol: "square.grid.3x3.fill", tint: .neonOrangeStrong, action: onOpenBoard),
        ]
        LazyVGrid(columns: [GridItem(.flexible(), spacing: NeonSpace.sm), GridItem(.flexible(), spacing: NeonSpace.sm)], spacing: NeonSpace.sm) {
            ForEach(Array(actions.enumerated()), id: \.offset) { index, action in
                Button {
                    Haptic.tap()
                    action.action()
                } label: {
                    VStack(spacing: 10) {
                        IconTile(action.symbol, tint: action.tint, size: 40, style: .filled)
                        Text(action.title)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color.neonInk)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, NeonSpace.lg)
                    .neonSurface(.glass, radius: NeonRadius.lg)
                }
                .buttonStyle(.pressableCard)
                .staggered(index)
            }
        }
    }
}

// MARK: - The day

/// The team's day as a row of coloured avatar cards — planned (quiet),
/// blocked or a mismatch (red), waiting on the manager or overloaded
/// (amber), and unanswered (grey: a silence, never a verdict).
private struct TeamDayAvatarRow: View {
    let people: [HomePersonDay]
    let onTap: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: NeonSpace.sm) {
                ForEach(people) { person in
                    Button {
                        Haptic.tap()
                        onTap(person.employeeId)
                    } label: {
                        VStack(spacing: 6) {
                            ZStack {
                                Circle()
                                    .stroke(dayStateTone(person.describeKind), lineWidth: 2.5)
                                    .frame(width: 54, height: 54)
                                AvatarView(url: nil, name: person.name, size: 46)
                            }
                            DirText(person.name, font: .system(size: 11, weight: .semibold), fill: false, lineLimit: 1)
                                .frame(width: 74)
                            Text(describeDayKind(
                                person.describeKind,
                                blocked: person.blocked.count,
                                contradictions: person.contradictions.count,
                                waiting: person.needsManager.count,
                                unanswered: person.unanswered
                            ))
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(dayStateTone(person.describeKind))
                            .lineLimit(2)
                            .minimumScaleFactor(0.75)
                            .multilineTextAlignment(.center)
                            .frame(width: 74)
                        }
                        .padding(.vertical, NeonSpace.sm)
                    }
                    .buttonStyle(.pressableCard)
                }
            }
            .padding(.horizontal, 2)
        }
    }
}

/// A colour for `describeKind` — the same judgement the pressing list and
/// `describeDayKind` already read, just as a ring instead of a sentence.
/// "unanswered" stays a quiet grey on purpose: it is a silence, not a fault.
private func dayStateTone(_ kind: String) -> Color {
    switch kind {
    case "blocked", "contradiction": return .neonDangerStrong
    case "waiting", "overloaded", "unplanned": return .neonWarningStrong
    case "allStarted": return .neonSuccessStrong
    default: return .neonTextTertiary
    }
}

private struct DayBoardSummary: View {
    let summary: DaySummary

    private struct Tile {
        let title: String
        let value: Int
        let symbol: String
        let tone: Color?
    }

    var body: some View {
        let tiles: [Tile] = [
            Tile(title: L("On the day"), value: summary.planned, symbol: "checkmark.circle.fill", tone: nil),
            Tile(title: L("No plan yet"), value: summary.unplanned, symbol: "calendar.badge.exclamationmark", tone: summary.unplanned > 0 ? .neonWarningStrong : nil),
            Tile(title: L("Blocked"), value: summary.blocked, symbol: "pause.circle.fill", tone: summary.blocked > 0 ? .neonDangerStrong : nil),
            Tile(title: L("Said started"), value: summary.contradictions, symbol: "exclamationmark.triangle.fill", tone: summary.contradictions > 0 ? .neonDangerStrong : nil),
            Tile(title: L("Overloaded"), value: summary.overloaded, symbol: "clock.badge.exclamationmark.fill", tone: summary.overloaded > 0 ? .neonWarningStrong : nil),
            Tile(title: L("Unanswered"), value: summary.unanswered, symbol: "questionmark.circle.fill", tone: nil),
        ]
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: NeonSpace.sm), count: 3), spacing: NeonSpace.sm) {
            ForEach(Array(tiles.enumerated()), id: \.offset) { index, tile in
                VStack(spacing: 6) {
                    Image(systemName: tile.symbol)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(tile.tone ?? Color.neonPurpleStrong.opacity(0.5))
                    Text(NeonFormat.integer(tile.value))
                        .font(.neonTitle3)
                        .foregroundStyle(tile.tone ?? Color.neonInk)
                    Text(tile.title)
                        .font(.neonOverline)
                        .foregroundStyle(Color.neonTextTertiary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, NeonSpace.md)
                .neonSurface(tile.tone != nil ? .tinted(tile.tone!) : .glass, radius: NeonRadius.md)
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

/// The top few projects (by the server's own recency order) as cover-image
/// cards with a completion ring — the same figure the project's own page
/// shows, just reachable at a glance.
private struct ProjectCarousel: View {
    let projects: [HomeProject]
    let onTap: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: NeonSpace.md) {
                ForEach(projects) { project in
                    Button {
                        Haptic.tap()
                        onTap(project.id)
                    } label: {
                        ZStack(alignment: .bottomLeading) {
                            RemoteImage(url: resolvedMediaURL(project.coverImageUrl), contentMode: .fill)
                            LinearGradient(
                                colors: [.black.opacity(0), .black.opacity(0.16), .black.opacity(0.78)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                            VStack(alignment: .leading, spacing: 4) {
                                BadgeView(text: localizedEnum("publishState", project.publishState), tone: publishTone(project.publishState))
                                DirText(project.name, font: .system(size: 15, weight: .bold, design: .rounded), color: .white, fill: false, lineLimit: 1)
                                DirText(project.clientName, font: .system(size: 12, weight: .medium), color: .white.opacity(0.82), fill: false, lineLimit: 1)
                            }
                            .padding(12)
                        }
                        .frame(width: 168, height: 190)
                        .clipShape(RoundedRectangle(cornerRadius: NeonRadius.xl, style: .continuous))
                        .overlay(alignment: .topTrailing) {
                            ProgressRing(progress: Double(project.completionPercent) / 100, size: 38, lineWidth: 4, tint: .white) {
                                Text(verbatim: "\(project.completionPercent)%")
                                    .font(.system(size: 9.5, weight: .bold, design: .rounded))
                                    .foregroundStyle(.white)
                            }
                            .padding(8)
                        }
                        .overlay(
                            RoundedRectangle(cornerRadius: NeonRadius.xl, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.16), lineWidth: 1)
                        )
                        .neonShadow(.raised)
                    }
                    .buttonStyle(.pressableCard)
                }
            }
            .padding(.vertical, 4)
        }
    }
}

private struct HomeProjectRow: View {
    let project: HomeProject
    let onTap: () -> Void

    var body: some View {
        Button {
            Haptic.tap()
            onTap()
        } label: {
            HStack(spacing: NeonSpace.md) {
                RemoteImage(url: resolvedMediaURL(project.coverImageUrl), contentMode: .fill)
                    .frame(width: 64, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous))

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

                ProgressRing(progress: Double(project.completionPercent) / 100, size: 34, lineWidth: 3.5) {
                    Text(verbatim: "\(project.completionPercent)%")
                        .font(.system(size: 8.5, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.neonInk)
                        .minimumScaleFactor(0.7)
                }

                VStack(alignment: .trailing, spacing: 2) {
                    Text(L("%d approvals", project.approvals)).font(.neonCaption2Ish)
                    Text(L("%d comments", project.comments)).font(.neonCaption2Ish)
                }
                .foregroundStyle(Color.neonTextFaint)
            }
            .padding(NeonSpace.sm)
            .neonSurface(.glass, radius: NeonRadius.lg)
        }
        .buttonStyle(.pressableCard)
    }
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
