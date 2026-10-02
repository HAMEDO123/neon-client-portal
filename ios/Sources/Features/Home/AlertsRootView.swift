import SwiftUI

/// Alerts: what the team has been doing, newest first. Pushed from More —
/// this owns no `NavigationStack` of its own.
struct AlertsRootView: View {
    @EnvironmentObject var api: APIClient
    @State private var data: HomeAlerts?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var clearing = false
    @State private var destination: HomeLinkDestination?
    @State private var chatRoute: ChatRoute?
    /// `entryId`s the Reviews queue still lists as pending, so a
    /// TASK_SUBMITTED row can say "Waiting for you" only when that is still
    /// true right now — never "Approved"/"Sent back", which this screen has
    /// no way to tell apart from here (see insights.md).
    @State private var pendingEntryIds: Set<String> = []
    @State private var filter: InsightsAlertFilter = .all

    var body: some View {
        LoadStateView(value: data, error: errorMessage, cachedAt: cachedAt, retry: load) {
            NeonScroll { SkeletonRows(count: 6) }
        } content: { data in
            if data.alerts.isEmpty {
                NeonScroll {
                    EmptyState(
                        symbol: "bell", title: L("Nothing yet"),
                        detail: L("Task updates, finished work and supply requests land here the moment they happen."),
                        hue: .indigo, card: true
                    )
                }
            } else {
                ScrollViewReader { proxy in
                    List {
                        HStack(spacing: NeonSpace.sm) {
                            Text(L("Everything your team changes, as it happens."))
                                .font(.neonFootnote)
                                .foregroundStyle(Color.neonTextSecondary)
                            Spacer(minLength: 4)
                            CountBadge(data.unread)
                        }
                        .neonListRow(top: 0, bottom: 8)

                        PillFilterBar(
                            selection: $filter, options: InsightsAlertFilter.allCases,
                            title: { $0.label },
                            count: { option in
                                option == .needsYou ? data.alerts.filter { insightsAlertMatches(.needsYou, $0, isPending: isPending($0)) }.count : nil
                            }
                        )
                        .neonListRow(top: 0, bottom: 8)

                        let shown = Array(data.alerts.enumerated()).filter { insightsAlertMatches(filter, $0.element, isPending: isPending($0.element)) }

                        ForEach(shown, id: \.element.id) { index, alert in
                            let group = insightsAlertDayGroup(alert.createdAt)
                            let previousGroup = index > 0 ? insightsAlertDayGroup(data.alerts[index - 1].createdAt) : nil

                            if group != previousGroup {
                                SectionLabel(group)
                                    .neonListRow(top: index == 0 ? 0 : 16, bottom: 4)
                            }

                            AlertRow(alert: alert, isPending: isPending(alert))
                                .id(index == 5 ? "row-5" : "row-\(index)")
                                .neonListRow()
                                .swipeAction(L("Mark read"), symbol: "checkmark.circle", tint: .neonCyan) {
                                    Task { await markRead(alert) }
                                }
                                .contentShape(Rectangle())
                                .onTapGesture { Task { await open(alert) } }
                                .staggered(index)
                        }
                    }
                    .neonListStyle()
                    .refreshable { Haptic.tap(); await load() }
                    .debugScroll(proxy)
                }
            }
        }
        .navigationTitle(L("Alerts"))
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarBackground(Color.neonBgSoft, for: .navigationBar)
        .toolbar {
            if let data, data.unread > 0 {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await clearAll() }
                    } label: {
                        if clearing {
                            ProgressView()
                        } else {
                            Label(L("Mark all read"), systemImage: "checkmark.circle.badge.checkmark")
                        }
                    }
                    .disabled(clearing)
                }
            }
        }
        .navigationDestination(isPresented: Binding(get: { destination != nil }, set: { if !$0 { destination = nil } })) {
            homeDestinationView(destination)
        }
        .navigationDestination(isPresented: Binding(get: { chatRoute != nil }, set: { if !$0 { chatRoute = nil } })) {
            if let chatRoute { ChatRoomView(route: chatRoute) }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            let loaded = try await api.fetchHomeAlerts()
            data = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
            return
        }
        // Best-effort only: a submission row can say "Waiting for you" when
        // this confirms it, but never fails or blocks the alerts read on its
        // own account, and never guesses when it can't reach this.
        if let reviews = try? await api.fetchHomeReviews() {
            pendingEntryIds = Set(reviews.value.submissions.compactMap(\.entryId))
        }
    }

    private func clearAll() async {
        clearing = true
        defer { clearing = false }
        do {
            try await api.clearHomeAlerts()
            Haptic.success()
            await load()
        } catch {
            Toast.error(error)
        }
    }

    private func markRead(_ alert: HomeAlert) async {
        guard alert.readAt == nil else { return }
        Haptic.selection()
        do {
            try await api.markHomeAlertRead(alert.id)
            await load()
        } catch {
            Toast.error(error)
        }
    }

    /// Tapping a row: mark it read (same as before), then open the native
    /// screen its `url` points at — the tasks board, Reviews, an employee, a
    /// project, or the chat it happened in. Anything this app can't open
    /// natively says so instead of falling back to a browser.
    private func open(_ alert: HomeAlert) async {
        Haptic.tap()
        if alert.readAt == nil {
            do {
                try await api.markHomeAlertRead(alert.id)
                await load()
            } catch {
                Toast.error(error)
            }
        }

        guard let parsed = parseAdminLink(alert.url) else { return }
        switch parsed {
        case .chat(let slug):
            await openChat(slug: slug)
        case .unsupported:
            Toast.info(L("This isn't open in the app yet."))
        default:
            destination = parsed
        }
    }

    /// Resolves a chat slug from a link ("team", an employee id, …) against
    /// the manager's own conversation list, since a `ChatRoute` needs more
    /// than the id a web url carries (its title, avatar, whether it's a group).
    private func openChat(slug: String) async {
        do {
            let loaded = try await api.fetchConversations()
            if let match = loaded.value.conversations.first(where: { $0.slug == slug }) {
                chatRoute = ChatRoute(slug: match.slug, title: match.title, subtitle: match.subtitle, avatar: match.avatar, isGroup: match.isGroup)
            } else if slug == "team" {
                chatRoute = ChatRoute(slug: "team", title: L("Team chat"), subtitle: nil, avatar: "/admin-icon-192.png", isGroup: true)
            } else {
                Toast.info(L("That conversation isn't available."))
            }
        } catch {
            Toast.error(error)
        }
    }

    private func isPending(_ alert: HomeAlert) -> Bool {
        guard alert.type == "TASK_SUBMITTED", let entryId = alert.entryId else { return false }
        return pendingEntryIds.contains(entryId)
    }
}

/// One family of colour per kind of alert, kept the same wherever the app
/// mentions that kind — the same rule the kit asks for tasks, chat, money.
/// A recognised state-change row overrides this with `insightsStateHue`, so
/// the tile agrees with the state it is telling you about rather than
/// reading as one fixed "something changed" colour.
private func insightsAlertHue(_ type: String) -> NeonHue {
    switch type {
    case "TASK_SUBMITTED": return .purple
    case "TASK_STATUS_CHANGED": return .cyan
    case "TASK_OVERDUE": return .orange
    case "SUPPLY_REQUEST": return .amber
    case "CHAT_MESSAGE": return .indigo
    case "ATTENDANCE": return .red
    case "LOCATION": return .green
    default: return .grey
    }
}

/// The Analytics legend's own hues for a task's state (`insightsDaySegments`
/// in AnalyticsRootView.swift), so a status tile and the "Done"/"In
/// progress" dot it is describing always agree, and moving forward reads
/// differently from moving back.
private func insightsStateHue(_ state: String) -> NeonHue {
    switch state {
    case "DONE": return .green
    case "SUBMITTED": return .purple
    case "IN_PROGRESS": return .cyan
    case "TOMORROW": return .orange
    default: return .grey
    }
}

/// `EMPLOYEE_STATE_LABEL` in src/lib/task-board.ts — the fixed English words
/// a "moved from X to Y." message is built from, read back into the state
/// codes `StateBadge(state:)` takes. Vocabulary, not user text, so it's kept
/// literal rather than sent through `L()`.
private let insightsStateLabelToCode: [String: String] = [
    "Pending": "TODO",
    "In progress": "IN_PROGRESS",
    "Sent for review": "SUBMITTED",
    "Completed": "DONE",
    "Planned for tomorrow": "TOMORROW",
]

private struct InsightsStateChange {
    let subject: String
    let fromState: String
    let toState: String
}

/// Recovers the one shape task-status.ts and my-assigned-actions.ts both
/// write, `"<title>[ — <project>] moved from <From> to <To>."`, so the title
/// can be shown on its own line and the change as two `StateBadge`s rather
/// than as one bidi-broken English sentence wrapped around an Arabic name.
/// Every other TASK_STATUS_CHANGED message (a daily report, a site visit, an
/// automation rule, a project addition) fails this parse on purpose and
/// falls back to the plain message.
private func parseInsightsStateChange(_ message: String) -> InsightsStateChange? {
    guard message.hasSuffix(".") else { return nil }
    let body = message.dropLast()
    guard let moveRange = body.range(of: " moved from ") else { return nil }
    let subject = String(body[..<moveRange.lowerBound])
    guard !subject.isEmpty else { return nil }
    let rest = body[moveRange.upperBound...]
    guard let toRange = rest.range(of: " to ") else { return nil }
    let fromLabel = String(rest[..<toRange.lowerBound])
    let toLabel = String(rest[toRange.upperBound...])
    guard let fromState = insightsStateLabelToCode[fromLabel], let toState = insightsStateLabelToCode[toLabel] else { return nil }
    return InsightsStateChange(subject: subject, fromState: fromState, toState: toState)
}

/// Recovers the task's own name out of task-proof.ts's one fixed sentence,
/// `"<name>. A photo is waiting for your review."` — the "is waiting" claim
/// itself is never shown, since the server writes it once and never updates
/// it once the submission is decided.
private func parseInsightsSubmissionSubject(_ message: String) -> String? {
    let suffix = ". A photo is waiting for your review."
    guard message.hasSuffix(suffix) else { return nil }
    let subject = String(message.dropLast(suffix.count))
    return subject.isEmpty ? nil : subject
}

/// "Today" / "Yesterday" / a short date, in the device's own calendar — kept
/// local (not `formattedDay`, which reads a `@db.Date` day-key in UTC) since
/// `createdAt` is a real moment and grouping it by a fixed UTC day would
/// disagree with the "9:44 PM" a row shows right next to it.
private func insightsAlertDayGroup(_ iso: String) -> String {
    guard let date = parseISODate(iso) else { return iso }
    if Calendar.current.isDateInToday(date) { return L("Today") }
    if Calendar.current.isDateInYesterday(date) { return L("Yesterday") }
    return date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: AppLanguage.current.locale))
}

private enum InsightsAlertFilter: CaseIterable, Hashable {
    case all, needsYou, tasks, reports

    var label: String {
        switch self {
        case .all: return L("All")
        case .needsYou: return L("Needs you")
        case .tasks: return L("Tasks")
        case .reports: return L("Reports")
        }
    }
}

private func insightsAlertMatches(_ filter: InsightsAlertFilter, _ alert: HomeAlert, isPending: Bool) -> Bool {
    switch filter {
    case .all:
        return true
    case .needsYou:
        guard alert.readAt == nil else { return false }
        switch alert.type {
        case "TASK_SUBMITTED": return isPending
        case "TASK_OVERDUE", "SUPPLY_REQUEST": return true
        default: return false
        }
    case .tasks:
        if alert.type == "TASK_SUBMITTED" || alert.type == "TASK_OVERDUE" { return true }
        return alert.type == "TASK_STATUS_CHANGED" && parseInsightsStateChange(alert.message) != nil
    case .reports:
        return alert.type == "TASK_STATUS_CHANGED" && parseInsightsStateChange(alert.message) == nil
    }
}

private struct AlertRow: View {
    let alert: HomeAlert
    let isPending: Bool

    private var isUnread: Bool { alert.readAt == nil }
    private var stateChange: InsightsStateChange? {
        alert.type == "TASK_STATUS_CHANGED" ? parseInsightsStateChange(alert.message) : nil
    }
    private var submissionSubject: String? {
        alert.type == "TASK_SUBMITTED" ? parseInsightsSubmissionSubject(alert.message) : nil
    }
    private var hue: NeonHue {
        if let stateChange { return insightsStateHue(stateChange.toState) }
        return insightsAlertHue(alert.type)
    }
    private var isActionable: Bool {
        guard let parsed = parseAdminLink(alert.url) else { return false }
        if case .unsupported = parsed { return false }
        return true
    }

    var body: some View {
        HStack(alignment: .top, spacing: NeonSpace.md) {
            leadingTile

            VStack(alignment: .leading, spacing: 4) {
                if alert.type == "TASK_SUBMITTED", let employee = alert.employee {
                    // Sending proof starts a check, not a completion — only
                    // the manager's approval makes work Done.
                    DirText(L("%@ sent proof for review", employee.name), font: .neonSubheadline.weight(.semibold), fill: false)
                    if let submissionSubject {
                        DirText(submissionSubject, font: .neonRowTitle, fill: false)
                    }
                } else {
                    DirText(alert.title, font: .neonSubheadline.weight(.semibold), fill: false)
                    if let stateChange {
                        DirText(stateChange.subject, font: .neonRowTitle, fill: false)
                        HStack(spacing: 6) {
                            StateBadge(state: stateChange.fromState)
                            Image(systemName: "arrow.forward")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(Color.neonTextTertiary)
                            StateBadge(state: stateChange.toState)
                        }
                    } else {
                        DirText(alert.message, font: .neonFootnote, color: .neonTextSecondary, lineLimit: 3)
                    }
                }
            }

            Spacer(minLength: 4)

            VStack(alignment: .trailing, spacing: 6) {
                if isPending {
                    BadgeView(text: L("Waiting for you"), tone: .purple)
                }
                Text(shortTime(alert.createdAt) ?? "")
                    .font(.neonMeta)
                    .foregroundStyle(Color.neonTextTertiary)
                if isActionable {
                    Image(systemName: "chevron.forward")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.neonTextFaint)
                }
            }
        }
        .padding(NeonSpace.card)
        .rowCard(pinned: isUnread, highlighted: isUnread)
    }

    @ViewBuilder private var leadingTile: some View {
        if let employee = alert.employee {
            ZStack(alignment: .bottomTrailing) {
                AvatarView(url: facePhotoURL(employee.photoUrl), name: employee.name, size: NeonSize.avatar)
                IconTile(homeAlertSymbol(alert.type), hue: hue, size: 20, style: isUnread ? .filled : .soft)
            }
        } else {
            IconTile(homeAlertSymbol(alert.type), hue: hue, size: NeonSize.iconTileLarge, style: isUnread ? .filled : .soft)
        }
    }
}
