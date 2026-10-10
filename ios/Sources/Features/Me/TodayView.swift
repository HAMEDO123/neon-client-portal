import SwiftUI

/// The employee's own day — what now, what it is for, what next, and the work
/// on today and tomorrow. `/today` is the portal home's own reading (`myDay`),
/// so the app and the web say the same thing, including the refusals: an
/// empty day says nothing is planned, never that somebody is idle.
struct TodayView: View {
    /// Where a chat notification opened from the Alerts sheet lands, since a
    /// sheet has no tab bar of its own to switch — the app shell wires this to
    /// its own Chat tab, the same way it already does for `EmployeeMoreView`.
    var openChat: () -> Void = {}

    @EnvironmentObject var api: APIClient
    @EnvironmentObject var store: StaffStore
    @State private var day: TodayResponse?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var employeeName: String?
    @State private var showAlerts = false

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                NeonScroll(spacing: NeonSpace.stack) {
                    ScreenHeader.brand {
                        IconButton("bell", label: L("Alerts"), size: NeonSize.circleButton, dot: store.badges.unread > 0) {
                            Haptic.tap()
                            showAlerts = true
                        }
                        AccountMenu()
                    }

                    if !store.warnings.isEmpty {
                        WarningsCard(warnings: store.warnings)
                    }

                    if let cachedAt { OfflineBanner(savedAt: cachedAt) }

                    if let day {
                        TodayHero(dayKey: day.dayKey, employeeName: employeeName, tasks: day.tasks)
                        NowNextCard(state: day.nowNext, hours: day.hours)
                        // What this phone shares with the team map, and when.
                        LocationSharingCard()

                        if day.tasks.isEmpty {
                            EmptyState(
                                symbol: "calendar",
                                title: L("Nothing planned for today"),
                                hue: .indigo,
                                card: true
                            )
                        } else {
                            SectionCard(L("Today's work"), subtitle: L("%d on the board for today", day.tasks.count), symbol: "checklist", hue: .blue) {
                                VStack(spacing: NeonSpace.sm) {
                                    ForEach(Array(day.tasks.enumerated()), id: \.element.id) { index, task in
                                        NavigationLink(value: TaskRoute(id: task.id)) {
                                            TodayTaskRow(task: task)
                                        }
                                        .buttonStyle(.pressableCard)
                                        .staggered(index)
                                        if task.id != day.tasks.last?.id { NeonDivider() }
                                    }
                                }
                            }
                        }

                        if !day.tomorrow.isEmpty {
                            SectionCard(L("Tomorrow"), subtitle: L("%d planned", day.tomorrow.count), symbol: "sunrise.fill", hue: .amber) {
                                VStack(spacing: NeonSpace.sm) {
                                    ForEach(Array(day.tomorrow.enumerated()), id: \.element.id) { index, task in
                                        NavigationLink(value: TaskRoute(id: task.id)) {
                                            TodayTaskRow(task: task)
                                        }
                                        .buttonStyle(.pressableCard)
                                        .staggered(index)
                                        if task.id != day.tomorrow.last?.id { NeonDivider() }
                                    }
                                }
                            }
                            .id("tomorrow")
                        }
                    } else if let errorMessage {
                        ErrorState(message: errorMessage) { await load() }
                    } else {
                        SkeletonRows(count: 4)
                    }
                }
                .debugScroll(proxy)
            }
            .refreshable {
                Haptic.tap()
                await load()
                await store.refresh()
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: TaskRoute.self) { route in
                TaskDetailView(taskId: route.id)
            }
            .neonAmbientBackground()
            .sheet(isPresented: $showAlerts) {
                // A sheet, unlike the pushed Alerts page under More, has no
                // back button of its own — and a chat notification whose link
                // can't be resolved needs somewhere to land, since there is no
                // tab bar to switch inside a sheet either.
                NavigationStack {
                    NotificationsView(openChat: {
                        showAlerts = false
                        openChat()
                    })
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            IconButton("xmark", label: L("Close"), size: NeonSize.circleButton) {
                                showAlerts = false
                            }
                        }
                    }
                }
                .neonSheet([.large])
            }
        }
        .task { await load() }
    }

    private func load() async {
        async let dayTask: Void = loadDay()
        async let meTask: Void = loadName()
        _ = await (dayTask, meTask)
    }

    private func loadDay() async {
        do {
            let loaded = try await api.fetchToday()
            day = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Just the name, for the hero's greeting — everything else the tabs
    /// need from `/me` (badges, warnings) is already `StaffStore`'s job.
    private func loadName() async {
        if let me = try? await api.fetchMe() { employeeName = me.name }
    }
}

/// A task to open, by id — what every list and notification pushes.
struct TaskRoute: Hashable {
    let id: String
}

// MARK: - Hero

/// A warm greeting, today's date and — once there is something to count — a
/// ring of how much of today's work is done. Purely a friendlier frame
/// around real numbers: it counts `DONE` among today's own tasks, nothing
/// guessed and nothing fetched beyond what this screen already reads.
private struct TodayHero: View {
    let dayKey: String
    let employeeName: String?
    let tasks: [StaffTask]

    private var doneCount: Int { tasks.filter { $0.state == "DONE" }.count }
    private var totalCount: Int { tasks.count }

    var body: some View {
        HeroCard(
            employeeName?.isEmpty == false ? employeeName! : greeting,
            eyebrow: greeting,
            eyebrowSymbol: greetingSymbol,
            subtitle: longDayLabel(dayKey),
            footnote: totalCount == 0 ? L("Nothing on the board today.") : L("%d of %d done so far today.", doneCount, totalCount)
        ) {
            if totalCount > 0 {
                ProgressRing(progress: Double(doneCount) / Double(totalCount), size: 56, lineWidth: 5.5, tint: .white) {
                    Text(verbatim: "\(doneCount)/\(totalCount)")
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                }
            }
        }
    }

    private var greetingSymbol: String {
        switch Calendar.current.component(.hour, from: Date()) {
        case 0..<12: return "sun.max.fill"
        case 12..<17: return "sun.min.fill"
        default: return "moon.stars.fill"
        }
    }

    private var greeting: String {
        switch Calendar.current.component(.hour, from: Date()) {
        case 0..<12: return L("Good morning")
        case 12..<17: return L("Good afternoon")
        default: return L("Good evening")
        }
    }
}

// MARK: - Now and next

/// `headline` in src/lib/now-next.ts, line for line: never scolds and never
/// guesses. Outside working hours it says so, and a day with nothing on it
/// says that rather than implying somebody is idle.
struct NowNextCard: View {
    let state: NowNext
    let hours: WorkHours

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.md) {
            HStack(spacing: 8) {
                IconTile(symbol, hue: state.now != nil ? .green : .cyan, size: 32)
                Text(label)
                    .font(.neonOverline)
                    .foregroundStyle(state.now != nil ? Color.neonSuccessStrong : Color.neonCyanStrong)
                Spacer(minLength: 0)
                if state.now != nil { OnlineDot(size: 9).neonPulse(true) }
            }

            if let now = state.now {
                routed(now.entryId) {
                    DirText(now.what, font: .neonTitle3)
                }
                HStack(spacing: 6) {
                    Text("\(now.from)–\(now.to)")
                    if let left = state.leftOfBlock {
                        Text("·")
                        Text(L("%@ left", describeMinutes(left)))
                    }
                }
                .font(.neonSubheadline)
                .foregroundStyle(Color.neonTextSecondary)
                if state.onBreak {
                    Label(L("Break until %@", lunchEnd ?? hours.end), systemImage: "cup.and.saucer.fill")
                        .font(.system(.footnote, weight: .semibold))
                        .foregroundStyle(Color.neonOrangeStrong)
                }
            } else {
                Text(headline)
                    .font(.neonTitle3)
                    .foregroundStyle(Color.neonInk)
            }

            if let next = state.next, !state.afterWork {
                NeonDivider()
                routed(next.entryId) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(L("Next"))
                            .font(.system(.footnote, weight: .semibold))
                            .foregroundStyle(Color.neonTextTertiary)
                        DirText(next.what, font: .system(.subheadline, weight: .semibold))
                        Text(untilNext)
                            .font(.neonCaption)
                            .foregroundStyle(Color.neonTextTertiary)
                    }
                }
            }

            if !state.beforeWork && !state.afterWork {
                Text(L("%@ of the working day left", describeMinutes(state.leftOfDay)))
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextTertiary)
            } else {
                Text(L("Working hours %@–%@", hours.start, hours.end))
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextTertiary)
            }
        }
        .padding(NeonSpace.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.glass, radius: NeonRadius.xl)
        .neonContextShape(radius: NeonRadius.xl)
        .neonAppear(delay: 0.05)
    }

    private var symbol: String {
        if state.onBreak && state.now == nil { return "cup.and.saucer.fill" }
        return state.now != nil ? "play.fill" : "clock.fill"
    }

    private var label: String {
        if state.now != nil { return L("NOW") }
        if state.onBreak { return L("ON A BREAK") }
        return L("YOUR DAY")
    }

    private var headline: String {
        if state.beforeWork { return L("The day starts at %@", hours.start) }
        if state.afterWork { return L("That is the day") }
        if state.onBreak { return L("Break until %@", lunchEnd ?? hours.end) }
        if let next = state.next { return L("Next at %@", next.from) }
        return L("Nothing planned for today")
    }

    private var untilNext: String {
        guard let minutes = state.untilNext else { return state.next?.from ?? "" }
        return L("in %@", describeMinutes(minutes))
    }

    /// `lunchWindow(hours).to`: when lunch ends, "HH:MM".
    private var lunchEnd: String? {
        guard let at = hours.lunchAt, let minutes = hours.lunchMinutes else { return nil }
        let parts = at.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        let total = parts[0] * 60 + parts[1] + Int(minutes)
        return String(format: "%02d:%02d", (total / 60) % 24, total % 60)
    }

    @ViewBuilder
    private func routed<Content: View>(_ entryId: String?, @ViewBuilder content: () -> Content) -> some View {
        if let entryId {
            NavigationLink(value: TaskRoute(id: entryId)) {
                HStack {
                    content()
                    Image(systemName: "chevron.forward")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.neonTextFaint)
                }
            }
            .buttonStyle(.plain)
        } else {
            content()
        }
    }
}

// MARK: - Warnings

/// Pinned to the top of the day for as long as the manager keeps them on
/// record. There is deliberately no way to dismiss it.
struct WarningsCard: View {
    let warnings: [StaffWarning]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                IconTile("exclamationmark.triangle.fill", hue: .orange, size: 32)
                Text(warnings.count == 1 ? L("You have a warning") : L("You have %d warnings", warnings.count))
                    .font(.system(.subheadline, weight: .semibold))
                Spacer()
                HStack(spacing: 3) {
                    ForEach(0..<warningLimit, id: \.self) { index in
                        Capsule()
                            .fill(index < warnings.count ? Color.neonDangerStrong.opacity(0.8) : Color.neonInk.opacity(0.12))
                            .frame(width: 16, height: 5)
                    }
                }
            }
            .foregroundStyle(Color(hex: 0x92400E))

            ForEach(Array(warnings.enumerated()), id: \.element.id) { index, warning in
                VStack(alignment: .leading, spacing: 3) {
                    Text(L("Warning %d · %@", index + 1, formattedDay(warning.createdAt) ?? ""))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color(hex: 0x92400E).opacity(0.75))
                    DirText(warning.reason, font: .system(size: 14), color: Color(hex: 0x451A03))
                }
            }

            if warnings.count == warningLimit - 1 {
                Text(L("One more warning closes your account."))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.neonDangerStrong)
            }
        }
        .padding(NeonSpace.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: 0xFFFBEB), in: RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous).strokeBorder(Color(hex: 0xFCD34D), lineWidth: 1))
        .neonAppear()
    }
}

// MARK: - Task rows

/// A compact row for inside a `SectionCard` (Today, Tomorrow) — the state's
/// tile, what and where, and a due time.
struct TodayTaskRow: View {
    let task: StaffTask

    private var tone: BadgeTone { taskStateTone(task.state) }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            IconTile(taskRowGlyph(task.state), hue: tone.hue, size: 38)

            VStack(alignment: .leading, spacing: 4) {
                DirText(task.task.name, font: .neonRowTitle, fill: false)
                DirText(task.project.name, font: .neonSubtitle, color: .neonTextSecondary, fill: false)

                FlowRow {
                    meStateBadge(task.state)
                    priorityChip(task.priority)
                    lateBadge(task.late)
                    if !task.waitingOn.isEmpty {
                        BadgeView(text: L("Waiting"), tone: .orange)
                    }
                    if task.blockedReason?.isEmpty == false {
                        BadgeView(text: L("Blocked"), tone: .warning)
                    }
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 4) {
                if let due = formattedISODate(task.dueAt) {
                    Text(due)
                        .font(.neonCaption)
                        .foregroundStyle(Color.neonTextTertiary)
                }
                Image(systemName: "chevron.forward")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.neonTextFaint)
            }
        }
        .padding(.vertical, 4)
        .taskPriorityWash(task.priority, state: task.state)
    }
}

/// A stand-alone card version of the same row, for a screen with no
/// surrounding `SectionCard` (the board list, jobs, follow-up targets).
struct TaskList: View {
    let tasks: [StaffTask]

    var body: some View {
        VStack(spacing: NeonSpace.stack) {
            ForEach(Array(tasks.enumerated()), id: \.element.id) { index, task in
                NavigationLink(value: TaskRoute(id: task.id)) {
                    TaskRow(task: task)
                }
                .buttonStyle(.pressableCard)
                .staggered(index)
            }
        }
    }
}

struct TaskRow: View {
    let task: StaffTask

    private var tone: BadgeTone { taskStateTone(task.state) }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconTile(taskRowGlyph(task.state), hue: tone.hue, size: 38)

            VStack(alignment: .leading, spacing: 5) {
                DirText(task.task.name, font: .neonRowTitle, fill: false)
                DirText(task.project.name, font: .neonSubtitle, color: .neonTextSecondary, fill: false)

                FlowRow {
                    meStateBadge(task.state)
                    priorityChip(task.priority)
                    lateBadge(task.late)
                    if !task.waitingOn.isEmpty {
                        BadgeView(text: L("Waiting"), tone: .orange)
                    }
                    if task.blockedReason?.isEmpty == false {
                        BadgeView(text: L("Blocked"), tone: .warning)
                    }
                }
                if let due = formattedISODate(task.dueAt) {
                    Label(L("Due %@", due), systemImage: "clock")
                        .font(.neonCaption)
                        .foregroundStyle(Color.neonTextTertiary)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.forward")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.neonTextFaint)
                .padding(.top, 8)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .neonContextShape(radius: NeonRadius.lg)
    }
}

/// The state's own icon (`StateBadge.symbol(for:)`, the same one its badge
/// wears), with a concrete fallback for `IN_PROGRESS` — the one state that
/// badge draws as a plain pulsing dot instead of a symbol.
private func taskRowGlyph(_ state: String) -> String {
    StateBadge.symbol(for: state) ?? "play.circle.fill"
}
