import SwiftUI

/// The employee's own day — what now, what it is for, what next, and the work
/// on today and tomorrow. `/today` is the portal home's own reading (`myDay`),
/// so the app and the web say the same thing, including the refusals: an
/// empty day says nothing is planned, never that somebody is idle.
struct TodayView: View {
    @EnvironmentObject var api: APIClient
    @EnvironmentObject var store: StaffStore
    @State private var day: TodayResponse?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var employeeName: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if !store.warnings.isEmpty {
                        WarningsCard(warnings: store.warnings)
                    }

                    if let cachedAt { OfflineBanner(savedAt: cachedAt) }

                    if let day {
                        TodayHero(dayKey: day.dayKey, employeeName: employeeName, tasks: day.tasks)
                        NowNextCard(state: day.nowNext, hours: day.hours)

                        SectionHeader(L("Today's work"), count: day.tasks.count)
                        if day.tasks.isEmpty {
                            EmptyState(symbol: "calendar", title: L("Nothing is scheduled on today"))
                                .glassCard(radius: 18)
                        } else {
                            TaskList(tasks: day.tasks)
                        }

                        if !day.tomorrow.isEmpty {
                            SectionHeader(L("Tomorrow"), count: day.tomorrow.count)
                            TaskList(tasks: day.tomorrow)
                        }
                    } else if let errorMessage {
                        ErrorState(message: errorMessage) { await load() }
                    } else {
                        SkeletonRows(count: 4)
                    }
                }
                .padding(16)
            }
            .refreshable {
                Haptic.tap()
                await load()
                await store.refresh()
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { AccountMenu() }
            }
            .navigationDestination(for: TaskRoute.self) { route in
                TaskDetailView(taskId: route.id)
            }
            .neonAmbientBackground()
        }
        .task { await load() }
    }

    private var title: String {
        guard let day else { return L("Today") }
        return formattedDayKey(day.dayKey)
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
        HStack(alignment: .center, spacing: NeonSpace.lg) {
            VStack(alignment: .leading, spacing: 4) {
                Text(greeting)
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(longDayLabel(dayKey))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.82))
            }
            Spacer(minLength: 8)
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
        .padding(NeonSpace.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.brand, radius: NeonRadius.xxl)
        .neonAppear()
    }

    private var greeting: String {
        let time: String
        switch Calendar.current.component(.hour, from: Date()) {
        case 0..<12: time = L("Good morning")
        case 12..<17: time = L("Good afternoon")
        default: time = L("Good evening")
        }
        guard let employeeName, !employeeName.isEmpty else { return time }
        return L("%@, %@", time, employeeName)
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
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 13, weight: .semibold))
                Text(label)
                    .font(.system(size: 12, weight: .semibold))
                    .tracking(0.5)
            }
            .foregroundStyle(Color.neonCyanStrong)

            if let now = state.now {
                routed(now.entryId) {
                    DirText(now.what, font: .system(size: 22, weight: .bold, design: .rounded))
                }
                HStack(spacing: 6) {
                    Text("\(now.from)–\(now.to)")
                    if let left = state.leftOfBlock {
                        Text("·")
                        Text(L("%@ left", describeMinutes(left)))
                    }
                }
                .font(.system(size: 13))
                .foregroundStyle(Color.neonInk.opacity(0.55))
                if state.onBreak {
                    Text(L("Break until %@", lunchEnd ?? hours.end))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.neonOrangeStrong)
                }
            } else {
                Text(headline)
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.neonInk)
            }

            if let next = state.next, !state.afterWork {
                Divider()
                routed(next.entryId) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(L("Next"))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color.neonInk.opacity(0.45))
                        DirText(next.what, font: .system(size: 15, weight: .semibold))
                        Text(untilNext)
                            .font(.system(size: 12))
                            .foregroundStyle(Color.neonInk.opacity(0.5))
                    }
                }
            }

            if !state.beforeWork && !state.afterWork {
                Text(L("%@ of the working day left", describeMinutes(state.leftOfDay)))
                    .font(.system(size: 12))
                    .foregroundStyle(Color.neonInk.opacity(0.5))
            } else {
                Text(L("Working hours %@–%@", hours.start, hours.end))
                    .font(.system(size: 12))
                    .foregroundStyle(Color.neonInk.opacity(0.5))
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.strong, radius: NeonRadius.xxl)
    }

    private var symbol: String {
        if state.onBreak && state.now == nil { return "cup.and.saucer" }
        return state.now != nil ? "play.circle" : "clock"
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
                        .foregroundStyle(Color.neonInk.opacity(0.3))
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
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill")
                Text(warnings.count == 1 ? L("You have a warning") : L("You have %d warnings", warnings.count))
                    .font(.system(size: 15, weight: .semibold))
                Spacer()
                HStack(spacing: 3) {
                    ForEach(0..<warningLimit, id: \.self) { index in
                        Capsule()
                            .fill(index < warnings.count ? Color.red.opacity(0.75) : Color.neonInk.opacity(0.12))
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
                    .foregroundStyle(Color.red.opacity(0.85))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: 0xFFFBEB), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color(hex: 0xFCD34D), lineWidth: 1))
    }
}

// MARK: - Task rows

struct TaskList: View {
    let tasks: [StaffTask]

    var body: some View {
        VStack(spacing: 10) {
            ForEach(Array(tasks.enumerated()), id: \.element.id) { index, task in
                NavigationLink(value: TaskRoute(id: task.id)) {
                    TaskRow(task: task)
                }
                .buttonStyle(.pressable)
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
            IconTile(taskRowGlyph(task.state), tint: tone.color, size: 38, style: .soft)

            VStack(alignment: .leading, spacing: 5) {
                DirText(task.task.name, font: .system(size: 16, weight: .semibold))
                DirText(task.project.name, font: .system(size: 13), color: .neonInk.opacity(0.55))

                HStack(spacing: 6) {
                    BadgeView(text: taskStateLabel(task.state), tone: tone)
                    if let priority = priorityLabel(task.priority) {
                        BadgeView(text: priority, tone: task.priority == "HIGH" ? .pink : .neutral)
                    }
                    if !task.waitingOn.isEmpty {
                        BadgeView(text: L("Waiting"), tone: .orange)
                    }
                    if task.blockedReason?.isEmpty == false {
                        BadgeView(text: L("Blocked"), tone: .warning)
                    }
                }
                if let due = formattedISODate(task.dueAt) {
                    Label(L("Due %@", due), systemImage: "clock")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.neonInk.opacity(0.5))
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.forward")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.neonInk.opacity(0.25))
                .padding(.top, 8)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.tinted(tone.color), radius: NeonRadius.lg)
    }
}

/// The state's own icon (`StateBadge.symbol(for:)`, the same one its badge
/// wears), with a concrete fallback for `IN_PROGRESS` — the one state that
/// badge draws as a plain pulsing dot instead of a symbol.
private func taskRowGlyph(_ state: String) -> String {
    StateBadge.symbol(for: state) ?? "play.circle.fill"
}
