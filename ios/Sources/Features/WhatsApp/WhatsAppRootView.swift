import SwiftUI

/// The studio's one WhatsApp number, for whoever the manager has trusted with
/// it — the manager always, a ticked employee too (`requireWhatsAppAccess`,
/// mirrored by `whatsapp/inbox`). Pushed from More, so it does not own a
/// `NavigationStack` of its own: the one it appears in belongs to More.
///
/// `readInbox` never throws — a worker that cannot be read comes back as
/// `{ chats: [], error: "…" }`, not a thrown error, because "not linked" and
/// "the worker is down" each want their own screen, never an empty list that
/// reads as "no messages".
struct WhatsAppRootView: View {
    @EnvironmentObject var api: APIClient
    @State private var inbox: WhatsAppInboxResponse?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var query = ""

    var body: some View {
        Group {
            if let inbox, inbox.error == nil {
                content(inbox)
            } else if let inbox, let message = inbox.error {
                Unavailable(
                    message: message,
                    notLinked: inbox.notLinked,
                    canManage: inbox.canManageLine,
                    retry: { await load() }
                )
            } else if let errorMessage {
                ErrorState(message: errorMessage) { await load() }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack { SkeletonRows(count: 7) }
                    .padding(NeonSpace.gutter)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .neonAmbientBackground()
        .navigationTitle(L("WhatsApp"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if inbox?.canManageLine == true {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        WhatsAppSettingsView()
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel(L("WhatsApp settings"))
                }
            }
        }
        .task {
            await load()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 20 * 1_000_000_000)
                if Task.isCancelled { break }
                await load()
            }
        }
    }

    @ViewBuilder
    private func content(_ inbox: WhatsAppInboxResponse) -> some View {
        let shown = inbox.chats.filter {
            matchesSearch(query, $0.name, $0.number, $0.lastMessage?.body)
        }

        VStack(spacing: 0) {
            SearchField(text: $query, prompt: L("Search chats"))
                .padding(.horizontal, NeonSpace.gutter)
                .padding(.top, NeonSpace.sm)
                .padding(.bottom, NeonSpace.xs)

            if let cachedAt {
                OfflineBanner(savedAt: cachedAt)
                    .padding(.horizontal, NeonSpace.gutter)
                    .padding(.bottom, NeonSpace.xs)
            }

            ScrollView {
                LazyVStack(spacing: NeonSpace.sm) {
                    if shown.isEmpty {
                        EmptyState(
                            symbol: inbox.chats.isEmpty ? "bubble.left.and.bubble.right" : "magnifyingglass",
                            title: inbox.chats.isEmpty ? L("No conversations on this number yet.") : L("Nothing matches that.")
                        )
                    } else {
                        ForEach(Array(shown.enumerated()), id: \.element.id) { index, chat in
                            NavigationLink {
                                WhatsAppThreadView(chat: chat, timeZone: inbox.timeZone)
                            } label: {
                                WhatsAppChatRow(chat: chat, timeZone: inbox.timeZone)
                            }
                            .buttonStyle(.pressableCard)
                            .staggered(index)
                        }
                    }
                }
                .padding(.horizontal, NeonSpace.gutter)
                .padding(.bottom, NeonSpace.xxl)
            }
            .refreshable {
                Haptic.tap()
                await load()
            }
        }
    }

    private func load() async {
        do {
            let loaded = try await api.fetchWhatsAppInbox()
            inbox = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            if inbox == nil { errorMessage = error.localizedDescription }
        }
    }
}

private struct WhatsAppChatRow: View {
    let chat: WhatsAppChat
    let timeZone: String

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(Color.neonInk.opacity(0.06))
                Image(systemName: chat.isGroup ? "person.2.fill" : "message.fill")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.neonInk.opacity(0.4))
            }
            .frame(width: 46, height: 46)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    DirText(chat.displayName, font: .system(size: 15.5, weight: .semibold), fill: false, lineLimit: 1)
                    Spacer(minLength: 6)
                    let when = whatsAppTimeLabel(chat.timestamp, timeZone: timeZone)
                    if !when.isEmpty {
                        Text(when)
                            .font(.system(size: 11))
                            .foregroundStyle(chat.unreadCount > 0 ? Color.neonSuccessStrong : Color.neonTextTertiary)
                    }
                }
                HStack(spacing: 6) {
                    DirText(whatsAppPreview(chat.lastMessage), font: .system(size: 13), color: .neonTextSecondary, fill: false, lineLimit: 1)
                    Spacer(minLength: 0)
                    CountBadge(chat.unreadCount, tone: .success)
                }
            }
        }
        .padding(12)
        .neonSurface(.glass, radius: NeonRadius.lg)
    }
}

/// The two ways a chat list can be unreadable, each with the fix that
/// actually applies — never a generic "something went wrong".
private struct Unavailable: View {
    let message: String
    let notLinked: Bool
    let canManage: Bool
    let retry: () async -> Void

    var body: some View {
        VStack {
            Spacer()
            EmptyState(
                symbol: "bubble.left.and.bubble.right",
                title: notLinked ? L("The studio's number is not linked yet") : L("WhatsApp cannot be read right now"),
                detail: notLinked
                    ? (canManage
                        ? L("Link it once from Settings — scan the code with the phone that holds the company number, and the chats appear here.")
                        : L("Ask the manager to link it from Settings."))
                    : message
            )
            if notLinked && canManage {
                NavigationLink {
                    WhatsAppSettingsView()
                } label: {
                    Text(L("Open settings"))
                }
                .buttonStyle(.neon(.tinted(.neonSuccessStrong), size: .medium))
                .frame(maxWidth: 220)
            } else {
                NeonButton(L("Try again"), symbol: "arrow.clockwise", kind: .secondary, size: .medium) { await retry() }
                    .frame(maxWidth: 220)
            }
            Spacer()
        }
        .padding(NeonSpace.xxl)
        .neonAmbientBackground()
    }
}
