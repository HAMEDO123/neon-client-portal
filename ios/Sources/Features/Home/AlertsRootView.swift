import SwiftUI

/// Activity: what the team has been doing, newest first. Pushed from More —
/// this owns no `NavigationStack` of its own.
struct AlertsRootView: View {
    @EnvironmentObject var api: APIClient
    @State private var data: HomeAlerts?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var clearing = false
    @State private var destination: HomeLinkDestination?
    @State private var chatRoute: ChatRoute?

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

                        ForEach(Array(data.alerts.enumerated()), id: \.element.id) { index, alert in
                            AlertRow(alert: alert)
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
        .navigationTitle(L("Activity"))
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
}

/// One family of colour per kind of alert, kept the same wherever the app
/// mentions that kind — the same rule the kit asks for tasks, chat, money.
private func insightsAlertHue(_ type: String) -> NeonHue {
    switch type {
    case "TASK_SUBMITTED": return .purple
    case "TASK_STATUS_CHANGED": return .cyan
    case "TASK_OVERDUE": return .orange
    case "SUPPLY_REQUEST": return .amber
    case "CHAT_MESSAGE": return .indigo
    default: return .grey
    }
}

private struct AlertRow: View {
    let alert: HomeAlert

    private var isUnread: Bool { alert.readAt == nil }
    private var hue: NeonHue { insightsAlertHue(alert.type) }

    var body: some View {
        HStack(alignment: .top, spacing: NeonSpace.md) {
            ZStack(alignment: .bottomTrailing) {
                IconTile(homeAlertSymbol(alert.type), hue: hue, size: NeonSize.iconTileLarge, style: isUnread ? .filled : .soft)
                if let employee = alert.employee {
                    Circle()
                        .fill(employeeFill(employee.color))
                        .frame(width: 11, height: 11)
                        .overlay(Circle().strokeBorder(Color.white, lineWidth: 2))
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                DirText(alert.title, font: .neonSubheadline.weight(.semibold), fill: false)
                DirText(alert.message, font: .neonFootnote, color: .neonTextSecondary)
                Text(formattedISODate(alert.createdAt) ?? alert.createdAt)
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextFaint)
            }
            Spacer(minLength: 4)
        }
        .padding(NeonSpace.sm)
        .rowCard(pinned: isUnread, highlighted: isUnread)
    }
}
