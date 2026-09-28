import SwiftUI

// Reactions and pins, drawn from the live snapshot every open conversation
// keeps (see ChatStream's `reactions` event and APIClient.fetchChatReactions):
// the fixed six lib/chat-reactions.ts offers, a tally under each message, and
// the pinned strip at the top of a conversation.

/// The six — REACTIONS in lib/chat-reactions.ts. A fixed set, not whatever the
/// keyboard can produce: a tally is only a tally while everybody is counting
/// the same things.
let chatReactionSet = ["👍", "❤️", "😂", "🙏", "👀", "✅"]

/// The four canned replies over the composer, in the words the platform
/// already uses for a 👍 reaction — agreeing with a tap and a reply mean the
/// same thing here.
let chatQuickReplies: [(symbol: String, text: String)] = [
    ("hand.thumbsup.fill", "👍 Got it"),
    ("checkmark.circle.fill", "✅ On it"),
    ("calendar", "📅 Will update"),
    ("lightbulb.fill", "💡 Need review"),
]

/// One emoji's tally under a message: how many, and whether the viewer is one
/// of them — the same shape lib/chat-reactions.ts's `tally` computes.
struct ChatReactionTally: Identifiable {
    let emoji: String
    let count: Int
    let mine: Bool
    let names: [String]
    var id: String { emoji }
}

func chatTally(_ rows: [ChatReactionSnapshot.Reaction], messageId: String, myKey: String) -> [ChatReactionTally] {
    let order = Dictionary(uniqueKeysWithValues: chatReactionSet.enumerated().map { ($1, $0) })
    var byEmoji: [String: (count: Int, mine: Bool, names: [String])] = [:]
    for row in rows where row.messageId == messageId {
        var entry = byEmoji[row.emoji] ?? (0, false, [])
        entry.count += 1
        entry.names.append(row.memberName)
        if row.memberKey == myKey { entry.mine = true }
        byEmoji[row.emoji] = entry
    }
    return byEmoji.map { ChatReactionTally(emoji: $0.key, count: $0.value.count, mine: $0.value.mine, names: $0.value.names) }
        .sorted { a, b in
            if a.count != b.count { return a.count > b.count }
            let left = order[a.emoji] ?? chatReactionSet.count
            let right = order[b.emoji] ?? chatReactionSet.count
            if left != right { return left < right }
            return a.emoji < b.emoji
        }
}

/// The row of tallies under a bubble, each tappable to toggle the viewer's own.
struct ChatReactionRow: View {
    let tallies: [ChatReactionTally]
    let onToggle: (String) -> Void

    var body: some View {
        if !tallies.isEmpty {
            FlowRow(spacing: 5) {
                ForEach(tallies) { tally in
                    Button {
                        Haptic.tap()
                        onToggle(tally.emoji)
                    } label: {
                        HStack(spacing: 3) {
                            Text(tally.emoji).font(.system(size: 12))
                            if tally.count > 1 {
                                Text("\(tally.count)").font(.system(size: 11, weight: .semibold))
                            }
                        }
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(
                            Capsule().fill(tally.mine ? Color.neonPurple.opacity(0.18) : Color.neonInk.opacity(0.06))
                        )
                        .overlay(Capsule().strokeBorder(tally.mine ? Color.neonPurpleStrong.opacity(0.4) : .clear))
                        .foregroundStyle(tally.mine ? Color.neonPurpleStrong : Color.neonInk.opacity(0.65))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// Every pinned message, as a horizontal strip a person can flick through and
/// tap to jump to. Empty when nothing is pinned — never shown as a bar with
/// nothing in it.
struct ChatPinnedStrip: View {
    let pinned: [ChatReactionSnapshot.Pinned]
    let onOpen: (String) -> Void
    let onUnpin: (String) -> Void

    var body: some View {
        if !pinned.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(pinned) { item in
                        Button { onOpen(item.id) } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "pin.fill").font(.system(size: 10))
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(item.authorName).font(.system(size: 10, weight: .semibold))
                                    DirText(pinnedPreview(item), font: .system(size: 12), lineLimit: 1)
                                }
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Color.neonPurple.opacity(0.12), in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button(role: .destructive) { onUnpin(item.id) } label: { Label(L("Unpin"), systemImage: "pin.slash") }
                        }
                    }
                }
                .padding(.horizontal, 12)
            }
            .padding(.vertical, 6)
            .background(Color.white.opacity(0.6))
        }
    }

    private func pinnedPreview(_ item: ChatReactionSnapshot.Pinned) -> String {
        switch item.kind {
        case "IMAGE": return L("📷 Photo")
        case "FILE": return "📎 " + (item.attachmentName ?? L("File"))
        case "VOICE": return L("🎤 Voice message")
        case "TASK": return "✅ " + (item.body ?? L("Task"))
        case "MEETING": return "📅 " + (item.body ?? L("Meeting"))
        default: return item.body ?? ""
        }
    }
}
