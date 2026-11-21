import SwiftUI
import WidgetKit

// What is waiting on whoever is signed in. The manager: reviews, requests,
// alerts and unread chat — the admin sidebar's counts (`home/overview`'s
// badges). The team: unread chat and alerts (`/me`'s badges). One widget for
// both sides, because both have something waiting.

struct Waiting {
    struct Count {
        let label: String
        let value: Int
        let symbol: String
        let tint: Color
        let path: String
    }

    let counts: [Count]
}

private struct AdminOverview: Decodable {
    let badges: Badges
    struct Badges: Decodable { let chat: Int; let requests: Int; let reviews: Int; let alerts: Int }
}

private struct EmployeeMe: Decodable {
    let badges: Badges?
    struct Badges: Decodable { let unread: Int; let unreadChat: Int }
}

struct WaitingProvider: TimelineProvider {
    typealias Entry = NeonEntry<Waiting>

    func placeholder(in context: Context) -> Entry {
        let words = Words(WidgetShare.read())
        return Entry(date: Date(), loaded: .ready(Self.admin(.init(chat: 3, requests: 1, reviews: 4, alerts: 2), words)), context: WidgetShare.read())
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        if context.isPreview { return completion(placeholder(in: context)) }
        Task { completion(await entry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        Task { completion(timeline(await entry())) }
    }

    private func entry() async -> Entry {
        let shared = WidgetShare.read()
        let words = Words(shared)
        let (loaded, context) = await load(side: nil) { () async throws -> Waiting in
            if shared?.side == "employee" {
                let me = try await WidgetAPI.fetch("me", as: EmployeeMe.self)
                return Self.employee(me.badges ?? .init(unread: 0, unreadChat: 0), words)
            }
            let overview = try await WidgetAPI.read("home/overview", as: AdminOverview.self)
            return Self.admin(overview.badges, words)
        }
        return Entry(date: Date(), loaded: loaded, context: context)
    }

    private static func admin(_ badges: AdminOverview.Badges, _ words: Words) -> Waiting {
        Waiting(counts: [
            .init(label: words.t("Reviews", "مراجعات"), value: badges.reviews, symbol: "tray.and.arrow.down.fill", tint: Palette.amber, path: "/admin/reviews"),
            .init(label: words.t("Unread chat", "رسائل جديدة"), value: badges.chat, symbol: "bubble.left.and.bubble.right.fill", tint: Palette.purple, path: "/admin/chat"),
            .init(label: words.t("Requests", "طلبات"), value: badges.requests, symbol: "tray.full.fill", tint: Palette.blue, path: "/admin/requests"),
            .init(label: words.t("Alerts", "تنبيهات"), value: badges.alerts, symbol: "bell.badge.fill", tint: Palette.red, path: "/admin/alerts"),
        ])
    }

    private static func employee(_ badges: EmployeeMe.Badges, _ words: Words) -> Waiting {
        Waiting(counts: [
            .init(label: words.t("Unread chat", "رسائل جديدة"), value: badges.unreadChat, symbol: "bubble.left.and.bubble.right.fill", tint: Palette.purple, path: "/employee/chat"),
            .init(label: words.t("Alerts", "تنبيهات"), value: badges.unread, symbol: "bell.badge.fill", tint: Palette.red, path: "/employee/notifications"),
        ])
    }
}

struct WaitingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "neon.waiting", provider: WaitingProvider()) { entry in
            WaitingView(entry: entry)
        }
        .configurationDisplayName("Waiting on you · بانتظارك")
        .description("Reviews, requests, alerts and unread messages.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct WaitingView: View {
    let entry: NeonEntry<Waiting>
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let words = entry.words
        Group {
            if case .ready(let waiting) = entry.loaded {
                content(waiting, words)
            } else {
                WidgetMessage(title: words.t("Waiting on you", "بانتظارك"), symbol: "tray.fill", message: explain(entry.loaded, words, otherSide: "") ?? "")
            }
        }
        .widgetURL(neonLink(firstPath(entry)))
        .neonWidget(words)
    }

    private func firstPath(_ entry: NeonEntry<Waiting>) -> String {
        guard case .ready(let waiting) = entry.loaded else { return "/admin" }
        return (waiting.counts.first { $0.value > 0 } ?? waiting.counts.first)?.path ?? "/admin"
    }

    @ViewBuilder private func content(_ waiting: Waiting, _ words: Words) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            WidgetTitle(title: words.t("Waiting on you", "بانتظارك"), symbol: "tray.fill", tint: Palette.amber)
            let columns = family == .systemSmall ? 2 : max(waiting.counts.count, 2)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: columns), alignment: .leading, spacing: 8) {
                ForEach(waiting.counts, id: \.label) { count in
                    Link(destination: neonLink(count.path)) {
                        VStack(alignment: .leading, spacing: 2) {
                            Image(systemName: count.symbol)
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(count.value > 0 ? count.tint : Palette.grey)
                            Text("\(count.value)")
                                .font(.system(size: family == .systemSmall ? 20 : 24, weight: .bold, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(count.value > 0 ? Palette.ink : Palette.grey)
                            Text(count.label)
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(Palette.muted)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
