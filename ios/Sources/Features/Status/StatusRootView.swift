import SwiftUI
import UIKit

/// The manager's "is everything running" screen: the site, its database, the
/// PC under it, the jobs that run by themselves, the backups, WhatsApp and
/// push — and the office's way out to the internet and back in through the
/// tunnel. Every row is a check the server made itself, with the fact it read
/// (src/lib/status-checks.ts); this screen counts and colours them and adds
/// nothing of its own.
///
/// Pushed, so no `NavigationStack` of its own. It refreshes itself every 15
/// seconds while it is on screen and the app is in front, and on a pull.
struct StatusRootView: View {
    @StateObject private var store: StatusStore
    @Environment(\.scenePhase) private var scenePhase

    /// The live screen, reading `ops/status`.
    init() {
        _store = StateObject(wrappedValue: StatusStore { try await APIClient.shared.opsStatus() })
    }

    /// A screen fed from somewhere other than the server — the debug fixtures.
    init(load: @escaping @MainActor () async throws -> StatusReport) {
        _store = StateObject(wrappedValue: StatusStore(load: load))
    }

    var body: some View {
        ScrollViewReader { proxy in
            NeonScroll(spacing: NeonSpace.stack) {
                content
            }
            .debugScroll(proxy)
        }
        .refreshable { await store.refresh() }
        .navigationTitle(L("Server & network"))
        // Only while the app is in front. `.task` ends when the screen goes
        // away, and a change of phase ends this one and starts the next — so
        // coming back to the app checks at once rather than in 15 seconds.
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            await store.poll(everySeconds: 15)
        }
    }

    @ViewBuilder private var content: some View {
        if let report = store.report {
            StatusHeroCard(summary: StatusSummary(report.rows), receivedAt: store.receivedAt ?? Date(), refreshing: store.isRefreshing)

            // A refresh that failed leaves the last answer on screen — said
            // in so many words, and the "checked … ago" above keeps ticking.
            if let failure = store.failure {
                StatusNote(
                    symbol: store.unreachable ? "wifi.exclamationmark" : "exclamationmark.triangle.fill",
                    tone: .danger,
                    title: store.unreachable ? L("Can't reach the server right now") : L("The last check failed"),
                    detail: L("Below is the last answer it gave. %@", failure)
                )
            }

            StatusSectionCard(
                title: L("Server"),
                subtitle: L("The site, its data and the PC"),
                symbol: "server.rack",
                hue: .indigo,
                rows: report.server
            )
            .id("server")
            StatusSectionCard(
                title: L("Network"),
                subtitle: L("Out to the internet and back in"),
                symbol: "point.3.connected.trianglepath.dotted",
                hue: .cyan,
                rows: report.network
            )
            .id("network")

            Text(L("The server runs every check itself each time this page refreshes: every 15 seconds while it is open. Hold a row to copy it."))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextTertiary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, NeonSpace.xs)
                .id("footer")
        } else if let failure = store.failure {
            if store.unreachable {
                StatusUnreachableCard { await store.refresh() }
            } else {
                ErrorState(message: failure) { await store.refresh() }
            }
        } else {
            SkeletonCard(lines: 2)
            SkeletonCard(lines: 5)
            SkeletonCard(lines: 3)
        }
    }
}

// MARK: - The data

/// The latest answer, and how the last attempt to get one went.
@MainActor
final class StatusStore: ObservableObject {
    @Published private(set) var report: StatusReport?
    /// When the answer reached this phone — what "checked … ago" counts from.
    @Published private(set) var receivedAt: Date?
    /// The last attempt's error, or nil when it succeeded.
    @Published private(set) var failure: String?
    /// The last failure was the server not being reachable at all.
    @Published private(set) var unreachable = false
    @Published private(set) var isRefreshing = false

    private let load: @MainActor () async throws -> StatusReport
    private var inFlight: Task<Void, Never>?

    init(load: @escaping @MainActor () async throws -> StatusReport) {
        self.load = load
    }

    /// One check at a time: a pull while the timer's check is running waits
    /// for that one instead of asking the server to look twice.
    func refresh() async {
        if let inFlight {
            await inFlight.value
            return
        }
        let task = Task { await fetch() }
        inFlight = task
        await task.value
        inFlight = nil
    }

    func poll(everySeconds seconds: UInt64) async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
        }
    }

    private func fetch() async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let fresh = try await load()
            withNeonAnimation(NeonMotion.gentle) {
                report = fresh
                receivedAt = Date()
                failure = nil
                unreachable = false
            }
        } catch {
            failure = error.localizedDescription
            if case APIError.network = error {
                unreachable = true
            } else {
                unreachable = false
            }
        }
    }
}

// MARK: - The hero

/// The summary in one look: a green, amber or red tile, the sentence, when it
/// was checked (ticking), and a count for each state.
private struct StatusHeroCard: View {
    let summary: StatusSummary
    let receivedAt: Date
    let refreshing: Bool

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            HeroHeader(
                summary.title,
                subtitle: statusCheckedLabel(receivedAt, now: context.date),
                symbol: summary.symbol,
                tint: summary.state.strong
            ) {
                FlowRow(spacing: 6) {
                    ForEach(summary.badges, id: \.state) { badge in
                        StateBadge("\(NeonFormat.integer(badge.count)) \(badge.state.label)", tone: badge.state.tone)
                    }
                    if refreshing {
                        ProgressView()
                            .controlSize(.small)
                            .tint(Color.neonTextTertiary)
                            .frame(height: 24)
                            .accessibilityLabel(Text(L("Checking…")))
                    }
                }
            }
        }
    }
}

/// The first check could not reach the server at all. On this screen that is
/// the answer, not an error to retry past: it is red, and it says what it can
/// and cannot know from here.
private struct StatusUnreachableCard: View {
    let retry: () async -> Void

    var body: some View {
        HeroHeader(
            L("Can't reach the server"),
            subtitle: L("This phone could not reach clients.neonjo.com. Either the phone is offline, or the studio's PC, its internet or the tunnel is down — from here there is no telling which."),
            symbol: "wifi.exclamationmark",
            tint: .neonDangerStrong
        ) {
            NeonButton(L("Retry"), symbol: "arrow.clockwise", kind: .secondary, size: .medium) {
                await retry()
            }
            .padding(.top, 4)
        }
    }
}

// MARK: - The sections

private struct StatusSectionCard: View {
    let title: String
    let subtitle: String
    let symbol: String
    let hue: NeonHue
    let rows: [StatusRow]

    var body: some View {
        let summary = StatusSummary(rows)
        SectionCard(title, subtitle: subtitle, symbol: symbol, hue: hue, spacing: 4) {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    StatusCheckRow(row: row)
                    if index < rows.count - 1 {
                        NeonDivider().padding(.leading, NeonSize.iconTile + 12)
                    }
                }
            }
        } trailing: {
            if summary.attention == 0 {
                StateBadge(L("All healthy"), tone: .success)
            } else {
                StateBadge(L("To check: %@", NeonFormat.integer(summary.attention)), tone: summary.state.tone)
            }
        }
    }
}

/// One check: its tile in the state's colour, its title, the server's
/// sentence (in its own direction — it is English on an Arabic screen), the
/// state's pill and the short figure.
private struct StatusCheckRow: View {
    let row: StatusRow

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconTile(statusSymbol(row.id), hue: row.state.hue, size: NeonSize.iconTile)
            VStack(alignment: .leading, spacing: 3) {
                Text(L(row.title))
                    .font(.system(.callout, weight: .semibold))
                    .foregroundStyle(Color.neonInk)
                    .fixedSize(horizontal: false, vertical: true)
                DirText(row.detail, font: .system(.footnote), color: .neonTextSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 5) {
                StateBadge(row.state.label, tone: row.state.tone)
                if let value = row.value, !value.isEmpty {
                    DirText(value, font: .system(.caption, weight: .semibold).monospacedDigit(), color: .neonTextTertiary, fill: false, lineLimit: 1)
                }
            }
            .fixedSize()
        }
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        // A sentence worth sending to whoever fixes it.
        .contextMenu {
            Button {
                UIPasteboard.general.string = "\(L(row.title)) — \(row.state.label): \(row.detail)"
                Toast.success(L("Copied"))
            } label: {
                Label(L("Copy"), systemImage: "doc.on.doc")
            }
        }
    }
}
