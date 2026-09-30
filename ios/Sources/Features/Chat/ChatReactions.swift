import SwiftUI

// Reactions and pins, drawn from the live snapshot every open conversation
// keeps (see ChatStream's `reactions` event and APIClient.fetchChatReactions):
// the fixed six lib/chat-reactions.ts offers, a tally under each message, and
// the pinned strip at the top of a conversation.

/// The six — REACTIONS in lib/chat-reactions.ts. A fixed set, not whatever the
/// keyboard can produce: a tally is only a tally while everybody is counting
/// the same things.
let chatReactionSet = ["👍", "❤️", "😂", "🙏", "👀", "✅"]

/// One canned reply over the composer: drawn as a chip with its glyph, sent
/// as the website sends it — its emoji, then its words — in the words of the
/// app's language, so an Arabic room is answered in Arabic.
struct ChatQuickReply: Identifiable {
    let emoji: String
    let symbol: String
    let hue: NeonHue
    /// The English words, which are also the key of their translation.
    let words: String

    var id: String { words }
    var title: String { L(words) }
    var text: String { "\(emoji) \(title)" }
}

/// The four answers a team gives all day (quick-replies.tsx), in the words
/// the platform already uses for a 👍 reaction — agreeing with a tap and a
/// reply mean the same thing here. They are the team's answers to the
/// manager, as on the website's studio side, so the manager is not offered
/// them (and nothing here reads as approving work: that is the task card's).
let chatQuickReplies: [ChatQuickReply] = [
    ChatQuickReply(emoji: "👍", symbol: "hand.thumbsup.fill", hue: .blue, words: "Got it"),
    ChatQuickReply(emoji: "✅", symbol: "checkmark.circle.fill", hue: .green, words: "On it"),
    ChatQuickReply(emoji: "📅", symbol: "calendar", hue: .orange, words: "Will update"),
    ChatQuickReply(emoji: "💡", symbol: "lightbulb.fill", hue: .amber, words: "Need review"),
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

/// The row of tallies under a bubble, each tappable to toggle the viewer's
/// own: white pills tucked up against the bubble's lower edge, WhatsApp's
/// way, the viewer's own tinted.
struct ChatReactionRow: View {
    let tallies: [ChatReactionTally]
    let onToggle: (String) -> Void

    var body: some View {
        if !tallies.isEmpty {
            FlowRow(spacing: 4) {
                ForEach(tallies) { tally in
                    Button {
                        Haptic.selection()
                        onToggle(tally.emoji)
                    } label: {
                        HStack(spacing: 3) {
                            Text(tally.emoji).font(.system(size: 13))
                            if tally.count > 1 {
                                Text(NeonFormat.integer(tally.count))
                                    .font(.system(.caption2, weight: .bold))
                                    .monospacedDigit()
                            }
                        }
                        .foregroundStyle(tally.mine ? NeonHue.indigo.deep : Color.neonTextSecondary)
                        .padding(.horizontal, 7)
                        .frame(minHeight: 24)
                        .background(Capsule().fill(tally.mine ? NeonHue.indigo.wash : Color.white))
                        .overlay(Capsule().strokeBorder(tally.mine ? Color.neonIndigo.opacity(0.35) : Color.neonLine, lineWidth: 1))
                        .neonShadow(.low)
                        .contentShape(Capsule())
                    }
                    .buttonStyle(PressableStyle(scale: 0.9))
                    .transition(.neonPop)
                    .accessibilityLabel(Text(verbatim: "\(tally.emoji) \(tally.names.joined(separator: ", "))"))
                    .accessibilityAddTraits(tally.mine ? .isSelected : [])
                }
            }
            .animation(NeonMotion.resolved(NeonMotion.bouncy), value: tallies.map { "\($0.emoji)\($0.count)\($0.mine)" })
        }
    }
}

/// Every pinned message, as a strip under the header a person can flick
/// through and tap to jump to. Empty when nothing is pinned — never shown as
/// a bar with nothing in it.
struct ChatPinnedStrip: View {
    let pinned: [ChatReactionSnapshot.Pinned]
    let onOpen: (String) -> Void
    let onUnpin: (String) -> Void

    @Environment(\.chatRoomPalette) private var palette

    var body: some View {
        if !pinned.isEmpty {
            HStack(spacing: 10) {
                IconTile("pin.fill", hue: .indigo, size: 30)
                    .overlay(alignment: .topTrailing) {
                        if pinned.count > 1 {
                            CountBadge(pinned.count, tone: .blue, size: 16).offset(x: 6, y: -6)
                        }
                    }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(pinned) { item in
                            Button {
                                Haptic.tap()
                                onOpen(item.id)
                            } label: {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(item.authorName)
                                        .font(.system(.caption2, weight: .semibold))
                                        .foregroundStyle(palette.nameColor(key: nil, name: item.authorName))
                                        .lineLimit(1)
                                    DirText(pinnedPreview(item), font: .system(.footnote), color: .neonText, fill: false, lineLimit: 1)
                                }
                                .frame(maxWidth: 220, alignment: .leading)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(Capsule().fill(NeonHue.indigo.wash))
                                .overlay(Capsule().strokeBorder(Color.neonIndigo.opacity(0.12), lineWidth: 1))
                                .contentShape(Capsule())
                            }
                            .buttonStyle(PressableStyle(scale: 0.95))
                            .contextMenu {
                                Button(role: .destructive) { onUnpin(item.id) } label: { Label(L("Unpin"), systemImage: "pin.slash") }
                            }
                            .accessibilityHint(L("Shows the message"))
                        }
                    }
                    .padding(.trailing, NeonSpace.gutter)
                }
            }
            .padding(.leading, NeonSpace.gutter)
            .padding(.vertical, 8)
            .transition(.neonRise)
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
