import SwiftUI

/// Where the Home tab pushes, inside its own stack.
enum HomeRoute: Hashable {
    case project(String)
    case employee(String)
    case reviews
    case alerts
    case analytics
    case requests
    case employees
    case payroll
    case meetings
    case today
    case search
    case projectList(HomeProjectFilter)
    case chat(ChatRoute)
    case cameras
}

/// Another tab, opened the way a tapped notification opens one: the shell
/// (`AdminHome` in NeonAdminApp.swift) reads `PushCenter.pendingPath`, turns
/// the web path into its tab and clears it. The Projects, Tasks and More tabs
/// each own a `NavigationStack`, so they cannot be pushed onto Home's.
enum HomeTabLink {
    static let projects = "/admin/projects"
    static let tasks = "/admin/tasks"
    static let more = "/admin/more"

    @MainActor static func open(_ webPath: String) {
        PushCenter.shared.pendingPath = webPath
    }
}

/// The manager's Home tab, laid out as the owner's mockup: the NEON header,
/// the greeting card, the studio's four figures, where every project stands
/// and the projects themselves, today's work, this month by week, what is
/// waiting on the manager, quick actions — then the team: who is on what
/// right now and how their day is going (silence shown as silence, never as
/// a verdict).
struct AdminHomeView: View {
    @EnvironmentObject var api: APIClient
    @State private var path: [HomeRoute] = []

    @State private var overview: HomeOverview?
    @State private var overviewCachedAt: Date?
    @State private var overviewError: String?
    @StateObject private var cameraFeed = HomeCamerasModel()
    @State private var pulse: HomePulse?
    @State private var pulseError: String?
    @State private var today: HomeToday?
    @State private var todayError: String?
    @State private var day: HomeDay?
    @State private var dayError: String?
    @State private var now: HomeNow?
    @State private var nowError: String?

    @State private var showNewProject = false
    @State private var showHandOutTask = false
    @State private var showSetMeeting = false
    @State private var showUploadPhotos = false

    var body: some View {
        NavigationStack(path: $path) {
            ScrollViewReader { proxy in
                NeonScroll(spacing: NeonSpace.stack) {
                    header

                    if let overviewCachedAt {
                        OfflineBanner(savedAt: overviewCachedAt)
                    }

                    hero

                    // The studio's cameras, live, when there are any.
                    if !cameraFeed.cameras.isEmpty {
                        HomeCamerasCard(model: cameraFeed, onViewAll: { path.append(.cameras) })
                            .id("cameras")
                            .transition(.neonRise)
                    }

                    figures.id("kpis")

                    if let overview {
                        HomeProjectsCard(
                            projects: overview.projects,
                            onProject: { path.append(.project($0)) },
                            onViewAll: { HomeTabLink.open(HomeTabLink.projects) }
                        )
                        .id("projects")
                    }

                    HomeTodayCard(
                        today: today,
                        error: todayError,
                        retry: loadToday,
                        onOpen: open,
                        onViewAll: { path.append(.today) }
                    )
                    .id("today")

                    HomeMonthCard(pulse: pulse, error: pulseError, retry: loadPulse)
                        .id("month")

                    waiting.id("reviews")

                    HomeQuickActionsCard(actions: quickActions)
                        .id("actions")

                    // "Right now" and "The day" as one card: the team is listed
                    // once, each person with what they are on and how their day
                    // is going. `-neonScroll day` lands on its lower half.
                    HomeTeamCard(
                        now: now,
                        nowError: nowError,
                        day: day,
                        dayError: dayError,
                        timezone: day?.timezone ?? pulse?.timezone ?? today?.timezone,
                        retryNow: loadNow,
                        retryDay: loadDay,
                        onPerson: { path.append(.employee($0)) }
                    )
                    .id("now")
                }
                .refreshable {
                    Haptic.tap()
                    await load()
                }
                // Home has no navigation bar to soften the top edge, so cards
                // scrolling up would run straight under the clock and the
                // Dynamic Island.
                .overlay(alignment: .top) { HomeStatusBarFade() }
                .debugScroll(proxy)
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: HomeRoute.self) { route in
                destination(route)
            }
            .sheet(isPresented: $showNewProject) {
                // The projects area's own new-project form, reused rather than
                // rebuilt: same fields, same action ("projects" → createProject).
                NewProjectSheet { newId in
                    Task { await loadOverview() }
                    if let newId { path.append(.project(newId)) }
                }
            }
            .sheet(isPresented: $showHandOutTask) {
                // The chat area's own compose sheet, with the team channel: the
                // same form and action as the chat's own "+ → Task".
                ChatTaskComposeSheet(conversationSlug: "team") {
                    Task { await loadDay() }
                    Task { await loadToday() }
                }
            }
            .sheet(isPresented: $showSetMeeting) {
                ChatMeetingComposeSheet(conversationSlug: "team") {
                    Task { await loadToday() }
                }
            }
            .sheet(isPresented: $showUploadPhotos) {
                HomeUploadPhotosSheet(
                    projects: overview?.projects ?? [],
                    onUploaded: { Task { await loadOverview() } },
                    onOpenProject: { path.append(.project($0)) }
                )
            }
        }
        .task { await load() }
        .task {
            // "Right now" moves on its own — somebody starts a task, a break
            // ends — so it refreshes every 60 s while Home is on screen, same
            // as pull-to-refresh but without waiting for a tug.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60 * 1_000_000_000)
                guard !Task.isCancelled else { return }
                await loadNow()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .neonDataChanged)) { note in
            // Work approved or sent back, an alert read, a project or a task
            // changed elsewhere: the counts and today's list are what moved.
            guard let name = note.object as? String else { return }
            // Somebody's face changed: every row of people here draws it.
            if isFaceChange(name) {
                Task { await loadNow() }
                Task { await loadDay() }
                Task { await loadToday() }
                Task { await loadPulse() }
                return
            }
            guard ["home/", "projects/", "tasks/", "ops/"].contains(where: { name.hasPrefix($0) }) else { return }
            Task { await loadOverview() }
            Task { await loadPulse() }
            if name.hasPrefix("tasks/") { Task { await loadToday() } }
        }
    }

    // MARK: - The top

    private var header: some View {
        ScreenHeader.brand {
            IconButton("magnifyingglass", label: L("Search"), size: NeonSize.circleButton) {
                path.append(.search)
            }
            IconButton("bell", label: L("Alerts"), size: NeonSize.circleButton, dot: (overview?.badges.alerts ?? 0) > 0) {
                path.append(.alerts)
            }
            Button {
                Haptic.tap()
                HomeTabLink.open(HomeTabLink.more)
            } label: {
                // The manager's own face once they have set one (More → the
                // top card); the studio's "N" until then.
                AvatarView(url: facePhotoURL(api.myPhoto), name: "NEON", size: NeonSize.circleButton, ring: true)
                    .neonShadow(.low)
            }
            .buttonStyle(PressableStyle(scale: 0.88))
            .accessibilityLabel(L("More"))
        }
    }

    private var hero: some View {
        let greeting = HomeGreeting.now()
        let firstName = pulse?.manager.map { homeFirstName($0.name) }.flatMap { $0.isEmpty ? nil : $0 }
        return HeroCard(
            firstName.map { "\($0) 👋" } ?? "\(greeting.plain) 👋",
            eyebrow: firstName == nil ? nil : greeting.withComma,
            eyebrowSymbol: greeting.symbol,
            subtitle: homeLongDate(Date()),
            footnote: L("An overview of every client project delivery."),
            photo: coverPhoto,
            actionLabel: L("Open projects"),
            action: { HomeTabLink.open(HomeTabLink.projects) }
        ) {
            HomeWeatherBadge()
        }
        .animation(NeonMotion.smooth, value: firstName)
    }

    /// The studio's own work: the most recently updated published project
    /// with a cover (what clients already see), else any project with one,
    /// else the kit's own illustration.
    private var coverPhoto: HeroPhoto {
        let covered = (overview?.projects ?? []).filter { ($0.coverImageUrl ?? "").isEmpty == false }
        guard let cover = (covered.first(where: { $0.publishState == "PUBLISHED" }) ?? covered.first)?.coverImageUrl else {
            return .none
        }
        return .url(resolvedMediaURL(cover))
    }

    // MARK: - Figures

    @ViewBuilder
    private var figures: some View {
        if let overview {
            HomeKPIRow(
                stats: overview.stats,
                projects: overview.projects,
                pulse: pulse,
                onTotal: { HomeTabLink.open(HomeTabLink.projects) },
                onPublished: { path.append(.projectList(.published)) },
                // Approvals live on each project's own Approvals tab; there is
                // no list of them across projects to open instead.
                onApprovals: { HomeTabLink.open(HomeTabLink.projects) },
                onUpdated: { path.append(.projectList(.updated)) }
            )
            HomeProgressCard(projects: overview.projects) {
                HomeTabLink.open(HomeTabLink.projects)
            }
            .id("progress")
        } else if let overviewError {
            ErrorState(message: overviewError, retry: loadOverview)
                .neonSurface(.glass, radius: NeonRadius.lg)
        } else {
            StatGrid(columns: 4) {
                ForEach(0..<4, id: \.self) { _ in SkeletonKPICard(compact: true) }
            }
            SkeletonCard(lines: 2)
        }
    }

    @ViewBuilder
    private var waiting: some View {
        HStack(alignment: .top, spacing: NeonSpace.stack) {
            HomeReviewsCard(
                count: pulse?.reviews.waiting ?? overview?.badges.reviews,
                people: pulse?.reviews.people ?? [],
                onOpen: { path.append(.reviews) }
            )
            HomeNeedsYouCard(
                alerts: overview?.badges.alerts,
                requests: overview?.badges.requests,
                onAlerts: { path.append(.alerts) },
                onRequests: { path.append(.requests) }
            )
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var quickActions: [QuickAction] {
        [
            QuickAction(L("New Project"), symbol: "plus", hue: .purple) { showNewProject = true },
            QuickAction(L("Hand out a Task"), symbol: "checklist", hue: .green) { showHandOutTask = true },
            QuickAction(L("Set a Meeting"), symbol: "calendar.badge.plus", hue: .blue) { showSetMeeting = true },
            QuickAction(L("Upload Photos"), symbol: "camera.fill", hue: .pink) { showUploadPhotos = true },
            QuickAction(L("Open the board"), symbol: "square.grid.3x3.fill", hue: .orange) { HomeTabLink.open(HomeTabLink.tasks) },
            QuickAction(L("Employees"), symbol: "person.2.fill", hue: .cyan) { path.append(.employees) },
            QuickAction(L("Payroll"), symbol: "banknote.fill", hue: .amber) { path.append(.payroll) },
            QuickAction(L("More"), symbol: "ellipsis", hue: .grey) { HomeTabLink.open(HomeTabLink.more) },
        ]
    }

    // MARK: - Going places

    private func open(_ item: HomeTodayItem) {
        switch item.kind {
        case "cell":
            if let projectId = item.projectId { path.append(.project(projectId)) }
        case "meeting":
            path.append(.meetings)
        default:
            // A job handed out by hand lives on the week board, in Tasks;
            // there is no screen for one job on its own to push.
            HomeTabLink.open(HomeTabLink.tasks)
        }
    }

    @ViewBuilder
    private func destination(_ route: HomeRoute) -> some View {
        switch route {
        case .project(let id): ProjectDetailView(projectId: id)
        case .employee(let id): EmployeeDetailView(employeeId: id)
        case .reviews: ReviewsRootView()
        case .alerts: AlertsRootView()
        case .analytics: AnalyticsRootView()
        case .requests: RequestsRootView()
        case .employees: EmployeesRootView()
        case .payroll: PayrollRootView()
        case .meetings: MeetingsView()
        case .today:
            HomeTodayView(today: today, error: todayError, retry: loadToday, onOpen: open)
        case .search:
            HomeSearchView(
                projects: overview?.projects ?? [],
                people: homeSearchPeople(now: now, day: day),
                onOpen: { path.append($0) }
            )
        case .projectList(let filter):
            HomeProjectListView(filter: filter, projects: overview?.projects ?? []) { path.append(.project($0)) }
        case .chat(let route): ChatRoomView(route: route)
        case .cameras: CamerasRootView()
        }
    }

    // MARK: - Loading

    private func load() async {
        async let overviewTask: Void = loadOverview()
        async let pulseTask: Void = loadPulse()
        async let todayTask: Void = loadToday()
        async let dayTask: Void = loadDay()
        async let nowTask: Void = loadNow()
        async let camerasTask: Void = cameraFeed.load()
        _ = await (overviewTask, pulseTask, todayTask, dayTask, nowTask, camerasTask)
    }

    private func loadOverview() async {
        do {
            let loaded = try await api.fetchHomeOverview()
            withNeonAnimation(NeonMotion.smooth) {
                overview = loaded.value
                overviewCachedAt = loaded.cachedAt
                overviewError = nil
            }
        } catch {
            overviewError = error.localizedDescription
        }
    }

    private func loadPulse() async {
        do {
            let loaded = try await api.fetchHomePulse()
            withNeonAnimation(NeonMotion.smooth) {
                pulse = loaded.value
                pulseError = nil
            }
        } catch {
            pulseError = error.localizedDescription
        }
    }

    private func loadToday() async {
        do {
            let loaded = try await api.fetchHomeToday()
            withNeonAnimation(NeonMotion.smooth) {
                today = loaded.value
                todayError = nil
            }
        } catch {
            todayError = error.localizedDescription
        }
    }

    private func loadDay() async {
        do {
            let loaded = try await api.fetchHomeDay()
            withNeonAnimation(NeonMotion.smooth) {
                day = loaded.value
                dayError = nil
            }
        } catch {
            dayError = error.localizedDescription
        }
    }

    private func loadNow() async {
        do {
            let loaded = try await api.fetchHomeNow()
            withNeonAnimation(NeonMotion.smooth) {
                now = loaded.value
                nowError = nil
            }
        } catch {
            nowError = error.localizedDescription
        }
    }
}

// MARK: - The greeting

/// Good morning, afternoon or evening by the phone's own clock, with the
/// symbol that goes with it.
struct HomeGreeting {
    let plain: String
    let withComma: String
    let symbol: String

    static func now(_ date: Date = Date()) -> HomeGreeting {
        switch Calendar.current.component(.hour, from: date) {
        case 5..<12: return HomeGreeting(plain: L("Good morning"), withComma: L("Good morning,"), symbol: "sun.max.fill")
        case 12..<17: return HomeGreeting(plain: L("Good afternoon"), withComma: L("Good afternoon,"), symbol: "sun.max.fill")
        case 17..<20: return HomeGreeting(plain: L("Good evening"), withComma: L("Good evening,"), symbol: "sunset.fill")
        default: return HomeGreeting(plain: L("Good evening"), withComma: L("Good evening,"), symbol: "moon.stars.fill")
        }
    }
}

/// "Hamed" from "Hamed Samir": the greeting uses a first name, as a person would.
func homeFirstName(_ name: String) -> String {
    name.split(whereSeparator: { $0.isWhitespace }).first.map(String.init) ?? name
}

/// "Wednesday, September 30", in the app's language.
func homeLongDate(_ date: Date) -> String {
    var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: AppLanguage.current.locale)
    style = style.weekday(.wide).day().month(.wide)
    return date.formatted(style)
}

/// A soft band of the page's own background under the status bar. Home hides
/// the navigation bar (a tab's root page has none), so nothing else stops a
/// card's text running into the clock and the Dynamic Island as the page
/// scrolls. The band is the very same `NeonAmbient` the page is painted
/// with, laid over the whole screen exactly as the page's is, so it can't
/// show as a stripe; it is solid over the status bar and fades out just
/// below it.
///
/// The height comes from the window: a reader that ignores the safe area
/// (as this one must, to line up with the page) is told its inset is zero.
struct HomeStatusBarFade: View {
    var body: some View {
        let top = homeWindowTopInset()
        NeonAmbient()
            .mask(alignment: .top) {
                LinearGradient(
                    stops: [
                        .init(color: .black, location: 0),
                        .init(color: .black, location: 0.72),
                        .init(color: .black.opacity(0), location: 1),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: top + NeonSpace.lg)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// How far the status bar (and the Dynamic Island) reach down the screen.
@MainActor
func homeWindowTopInset() -> CGFloat {
    let windows = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap(\.windows)
    let key = windows.first(where: \.isKeyWindow) ?? windows.first
    let inset = key?.safeAreaInsets.top ?? 0
    // Before the window has its insets (the first pass), assume a notched phone.
    return inset > 0 ? inset : 47
}
