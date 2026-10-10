import SwiftUI

// MARK: - The employee's jobs from chat

/// Jobs handed to this person on a chat task card — their own part of each,
/// with "Send proof" while it is still theirs to do.
struct MyChatJobsSection: View {
    /// One card and this person's part of it.
    struct Part: Identifiable {
        let item: ChatCardsLoader.Item
        let card: TaskCard
        let part: TaskCard.Assignment
        var id: String { item.id }
    }

    let mine: [Part]
    let sendProof: (TaskCard.Assignment, TaskCard) -> Void

    init(parts: [Part], sendProof: @escaping (TaskCard.Assignment, TaskCard) -> Void) {
        self.mine = parts
        self.sendProof = sendProof
    }

    /// This person's parts that the filter shows. A part is one of their
    /// jobs, so where it stands is that job's own answer (`standing`, by the
    /// job's id) — the same one its row in "Handed to you" is placed by; a
    /// part with no job listed is placed by its state and is never late.
    @MainActor
    static func parts(cards: ChatCardsLoader, viewer: Identity?, filter: TaskFilter, standing: [String: TaskStanding]) -> [Part] {
        cards.tasks.compactMap { item -> Part? in
            guard let card = item.message.task,
                  let part = card.assignments.first(where: { $0.employeeId == viewer?.id }) else { return nil }
            let stands = standing[part.id] ?? TaskStanding(state: part.state, late: false)
            return filter.matches(stands) ? Part(item: item, card: card, part: part) : nil
        }
    }

    var body: some View {
        if !mine.isEmpty {
            SectionCard(L("Handed out in chat"), subtitle: L("%d task card(s)", mine.count), symbol: "bubble.left.and.text.bubble.right.fill", hue: .cyan) {
                VStack(spacing: NeonSpace.sm) {
                    ForEach(Array(mine.enumerated()), id: \.element.id) { index, entry in
                        let (item, card, part) = (entry.item, entry.card, entry.part)
                        VStack(alignment: .leading, spacing: 8) {
                            NavigationLink(value: ChatRoute(item.conversation)) {
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack(alignment: .top) {
                                        DirText(card.title, font: .system(.callout, weight: .semibold), fill: false)
                                        Spacer(minLength: 8)
                                        BadgeView(text: cardStateLabel(part.state), tone: taskStateTone(part.state))
                                    }
                                    if let description = card.description, !description.isEmpty {
                                        DirText(description, font: .neonSubtitle, color: .neonTextSecondary, fill: false)
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
                        if item.id != mine.last?.id { NeonDivider() }
                    }
                }
            }
        }
    }
}
