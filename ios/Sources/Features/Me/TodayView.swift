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

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if !store.warnings.isEmpty {
                        WarningsCard(warnings: store.warnings)
                    }

                    if let cachedAt { OfflineBanner(savedAt: cachedAt) }

                    if let day {
                        NowNextCard(state: day.nowNext, hours: day.hours)

                        SectionLabel(L("Today's work"))
                        if day.tasks.isEmpty {
                            EmptyState(symbol: "calendar", title: L("Nothing is scheduled on today"))
                                .glassCard(radius: 18)
                        } else {
                            TaskList(tasks: day.tasks)
                        }

                        if !day.tomorrow.isEmpty {
                            SectionLabel(L("Tomorrow"))
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
        do {
            let loaded = try await api.fetchToday()
            day = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// A task to open, by id — what every list and notification pushes.
struct TaskRoute: Hashable {
    let id: String
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
        .glassCard(radius: 20)
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
            ForEach(tasks) { task in
                NavigationLink(value: TaskRoute(id: task.id)) {
                    TaskRow(task: task)
                }
                .buttonStyle(.pressable)
            }
        }
    }
}

struct TaskRow: View {
    let task: StaffTask

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(taskStateTone(task.state).foreground)
                .frame(width: 9, height: 9)
                .padding(.top, 6)

            VStack(alignment: .leading, spacing: 5) {
                DirText(task.task.name, font: .system(size: 16, weight: .semibold))
                DirText(task.project.name, font: .system(size: 13), color: .neonInk.opacity(0.55))

                HStack(spacing: 6) {
                    BadgeView(text: taskStateLabel(task.state), tone: taskStateTone(task.state))
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
                .padding(.top, 6)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(radius: 16)
    }
}
