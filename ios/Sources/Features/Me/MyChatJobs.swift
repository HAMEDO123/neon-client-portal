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
            SectionCard(L("Handed out in chat"), subtitle: L("%d task card(s)", mine.count), symbol: "bubble.left.and.text.bubble.right.fill", hue: .cyan) {
                VStack(spacing: NeonSpace.sm) {
                    ForEach(Array(mine.enumerated()), id: \.element.0.id) { index, entry in
                        let (item, card, part) = entry
                        VStack(alignment: .leading, spacing: 8) {
                            NavigationLink(value: ChatRoute(item.conversation)) {
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack(alignment: .top) {
                                        DirText(card.title, font: .system(.callout, weight: .semibold))
                                        Spacer(minLength: 8)
                                        BadgeView(text: cardStateLabel(part.state), tone: taskStateTone(part.state))
                                    }
                                    if let description = card.description, !description.isEmpty {
                                        DirText(description, font: .neonSubtitle, color: .neonTextSecondary)
                                    }
                                    HStack(spacing: 6) {
                                        Image(systemName: "bubble.left")
                                        Text(item.conversation.title)
                                        if let due = formattedISODate(card.dueAt) {
                                            Text("·")
                                            Text(L("Due %@", due))
                                        }
                                    }
                                    .font(.neonCaption)
                                    .foregroundStyle(Color.neonTextTertiary)
                                }
                            }
                            .buttonStyle(.plain)

                            if part.state != "SUBMITTED" && part.state != "DONE" {
                                NeonButton(L("Send proof"), symbol: "camera.fill", kind: .secondary, size: .medium) {
                                    Haptic.tap()
                                    sendProof(part, card)
                                }
                            }
                        }
                        .staggered(index)
                        if item.id != mine.last?.0.id { NeonDivider() }
                    }
                }
            }
        }
    }
}
