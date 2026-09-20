import SwiftUI

/// The chat list: the team's group and every private conversation this person
/// is in. The server decides which those are — an employee never sees a
/// conversation that is not theirs, and the app does not filter, it only draws.
struct ChatListView: View {
    @EnvironmentObject private var api: APIClient

    @State private var conversations: [ConversationSummary] = []
    @State private var loading = true
    @State private var failed = false

    var body: some View {
        NavigationStack {
            Group {
                if loading && conversations.isEmpty {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if failed && conversations.isEmpty {
                    retry
                } else {
                    list
                }
            }
            .neonAmbientBackground()
            .navigationTitle(L("Chats"))
            .navigationBarTitleDisplayMode(.large)
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private var retry: some View {
        VStack(spacing: 14) {
            Text(L("Couldn't load your chats."))
                .foregroundStyle(Color.neonInk.opacity(0.7))
            Button(L("Retry")) { Task { await load() } }
                .buttonStyle(.pressable)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                ForEach(conversations) { conversation in
                    NavigationLink {
                        ChatRoomView(conversation: conversation)
                    } label: {
                        ConversationRow(conversation: conversation)
                    }
                    .buttonStyle(.plain)
                }

                if conversations.isEmpty {
                    Text(L("No conversations yet."))
                        .foregroundStyle(Color.neonInk.opacity(0.6))
                        .padding(.top, 60)
                }
            }
            .padding(16)
        }
    }

    private func load() async {
        failed = false
        do {
            conversations = try await api.fetchConversations()
        } catch {
            failed = true
        }
        loading = false
    }
}

private struct ConversationRow: View {
    let conversation: ConversationSummary

    var body: some View {
        HStack(spacing: 12) {
            Avatar(url: conversation.avatarURL, name: conversation.title)

            VStack(alignment: .leading, spacing: 3) {
                Text(conversation.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.neonInk)
                    .lineLimit(1)

                // The preview, or the subtitle before anybody has said anything
                // — an empty grey line reads as a conversation that failed to
                // load rather than one nobody has started.
                Text(conversation.last == nil ? (conversation.subtitle ?? "") : conversation.preview)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.neonInk.opacity(0.6))
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            if conversation.unread > 0 {
                Text("\(conversation.unread)")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Color.neonPurple))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard()
    }
}

/// A picture where there is one, initials on the brand purple where there is
/// not. Never an empty circle: a face-shaped hole reads as something broken.
struct Avatar: View {
    let url: URL?
    let name: String
    var size: CGFloat = 46

    var body: some View {
        AsyncImage(url: url) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            ZStack {
                Color.neonPurple.opacity(0.18)
                Text(initials)
                    .font(.system(size: size * 0.36, weight: .semibold))
                    .foregroundStyle(Color.neonPurpleStrong)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        return parts.compactMap { $0.first }.map(String.init).joined().uppercased()
    }
}
