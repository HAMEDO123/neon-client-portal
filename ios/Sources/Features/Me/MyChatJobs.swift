import SwiftUI

// MARK: - The employee's jobs from chat

/// Jobs handed to this person on a chat task card — their own part of each,
/// with "Send proof" while it is still theirs to do.
struct MyChatJobsSection: View {
    let filter: TaskFilter
    @ObservedObject var cards: ChatCardsLoader
    let viewer: Identity?
    let sendProof: (TaskCard.Assignment, TaskCard) -> Void

    var body: some View {
        let mine = cards.tasks.compactMap { item -> (ChatCardsLoader.Item, TaskCard, TaskCard.Assignment)? in
            guard let card = item.message.task,
                  let part = card.assignments.first(where: { $0.employeeId == viewer?.id }) else { return nil }
            switch filter {
            case .open: return part.state == "DONE" ? nil : (item, card, part)
            case .completed: return part.state == "DONE" ? (item, card, part) : nil
            case .all: return (item, card, part)
            }
        }

        if !mine.isEmpty {
            SectionLabel(L("Handed out in chat"))
            ForEach(mine, id: \.0.id) { item, card, part in
                VStack(alignment: .leading, spacing: 8) {
                    NavigationLink(value: ChatRoute(item.conversation)) {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .top) {
                                DirText(card.title, font: .system(size: 16, weight: .semibold))
                                BadgeView(text: cardStateLabel(part.state), tone: taskStateTone(part.state))
                            }
                            if let description = card.description, !description.isEmpty {
                                DirText(description, font: .system(size: 13), color: .neonInk.opacity(0.6))
                            }
                            HStack(spacing: 6) {
                                Image(systemName: "bubble.left")
                                Text(item.conversation.title)
                                if let due = formattedISODate(card.dueAt) {
                                    Text("·")
                                    Text(L("Due %@", due))
                                }
                            }
                            .font(.system(size: 12))
                            .foregroundStyle(Color.neonInk.opacity(0.5))
                        }
                    }
                    .buttonStyle(.plain)

                    if part.state != "SUBMITTED" && part.state != "DONE" {
                        Button {
                            Haptic.tap()
                            sendProof(part, card)
                        } label: {
                            Label(L("Send proof"), systemImage: "camera.fill")
                                .font(.system(size: 13, weight: .semibold))
                                .frame(maxWidth: .infinity)
                                .frame(height: 36)
                                .foregroundStyle(.white)
                                .background(Color.neonInk, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        .buttonStyle(.pressable)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .glassCard(radius: 16)
            }
        }
    }
}
