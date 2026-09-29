import SwiftUI

/// The ticks on my own last message in each conversation of the list, read
/// from the same `chat/receipts` snapshot the conversation itself draws its
/// ticks from (lib/mobile/chat-receipt-rules.ts), so a row and the room never
/// disagree.
///
/// Only conversations whose last message is mine are asked about, one at a
/// time, and a message already read by everybody is not asked about again —
/// ticks only ever move forward. A conversation the server could not answer
/// for shows no ticks at all rather than a guess, and a saved (offline) answer
/// is not used: it would say where things stood, not where they stand.
@MainActor
final class ChatListTicks: ObservableObject {
    @Published private(set) var delivery: [String: ChatDelivery] = [:]

    private var known: [String: (createdAt: String, delivery: ChatDelivery)] = [:]
    private var running = false

    func refresh(_ conversations: [ConversationSummary], api: APIClient) async {
        guard !running else { return }
        running = true
        defer { running = false }

        var next: [String: ChatDelivery] = [:]
        for conversation in conversations {
            // A call's line is the platform's, not a message anybody reads.
            guard let last = conversation.last, last.mine == true, last.kind != "CALL",
                  let createdAt = last.createdAt, let sentAt = parseISODate(createdAt) else { continue }
            if let seen = known[conversation.slug], seen.createdAt == createdAt, seen.delivery == .read {
                next[conversation.slug] = .read
                continue
            }
            guard !Task.isCancelled else { return }
            if let loaded = try? await api.fetchChatReceipts(conversation: conversation.slug), loaded.cachedAt == nil {
                let board = ChatReceiptBoard(snapshot: loaded.value, fallbackOtherKey: nil)
                let now = board.delivery(of: sentAt)
                known[conversation.slug] = (createdAt, now)
                next[conversation.slug] = now
            } else if let seen = known[conversation.slug], seen.createdAt == createdAt {
                next[conversation.slug] = seen.delivery
            }
        }
        if next != delivery {
            withNeonAnimation(NeonMotion.quick) { delivery = next }
        }
    }
}
