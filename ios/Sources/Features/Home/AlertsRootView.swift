import SwiftUI

/// Activity: what the team has been doing, newest first. Pushed from More —
/// this owns no `NavigationStack` of its own.
struct AlertsRootView: View {
    @EnvironmentObject var api: APIClient
    @State private var data: HomeAlerts?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var clearing = false

    var body: some View {
        LoadStateView(value: data, error: errorMessage, cachedAt: cachedAt, retry: load) {
            NeonScroll { SkeletonRows(count: 6) }
        } content: { data in
            if data.alerts.isEmpty {
                NeonScroll {
                    EmptyState(symbol: "bell", title: L("Nothing yet"), detail: L("Task updates, finished work and supply requests land here the moment they happen."))
                }
            } else {
                List {
                    Text(subtitle)
                        .font(.neonFootnote)
                        .foregroundStyle(Color.neonTextSecondary)
                        .neonListRow(top: 0, bottom: 8)

                    ForEach(data.alerts) { alert in
                        AlertRow(alert: alert)
                            .neonListRow()
                            .swipeAction(L("Mark read"), symbol: "checkmark.circle", tint: .neonCyan) {
                                Task { await markRead(alert) }
                            }
                            .contentShape(Rectangle())
                            .onTapGesture { Task { await markRead(alert) } }
                    }
                }
                .neonListStyle()
                .refreshable { Haptic.tap(); await load() }
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
        .task { await load() }
    }

    private var subtitle: String {
        guard let data else { return "" }
        return data.unread > 0 ? L("Everything your team changes, as it happens. %d new.", data.unread) : L("Everything your team changes, as it happens.")
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
}

private struct AlertRow: View {
    let alert: HomeAlert

    private var isUnread: Bool { alert.readAt == nil }

    var body: some View {
        HStack(alignment: .top, spacing: NeonSpace.sm) {
            Circle()
                .fill(alert.employee.map { employeeFill($0.color) } ?? Color.neonTextFaint)
                .frame(width: 8, height: 8)
                .padding(.top, 6)

            IconTile(homeAlertSymbol(alert.type), tint: .neonPurpleStrong, size: 34, style: .soft)

            VStack(alignment: .leading, spacing: 3) {
                DirText(alert.title, font: .neonSubheadline.weight(.semibold), fill: false)
                DirText(alert.message, font: .neonFootnote, color: .neonTextSecondary)
                Text(formattedISODate(alert.createdAt) ?? alert.createdAt)
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextFaint)
            }

            Spacer(minLength: 4)
        }
        .padding(.vertical, 6)
        .padding(.horizontal, NeonSpace.sm)
        .neonSurface(isUnread ? .tinted(.neonPink) : .glass, radius: NeonRadius.md)
        .overlay(alignment: .leading) {
            if isUnread {
                RoundedRectangle(cornerRadius: 1.5).fill(Color.neonPink).frame(width: 3).padding(.vertical, 4)
            }
        }
    }
}
