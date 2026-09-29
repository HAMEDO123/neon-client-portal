import SwiftUI

// "Wael is typing…" — drawn from the stream's `people` event (who is writing
// in this conversation right now, by name), the way WhatsApp draws it: a
// bubble of three bouncing dots at the foot of the conversation, and
// "typing…" under the name in the header. In a group the bubble and the
// header both say who.

/// Who is writing, as the header says it: "typing…" in a private chat, where
/// who goes without saying; "Wael is typing…" or "Wael, Sally are typing…" in
/// the team or a group. nil when nobody is.
func chatTypingLine(_ typers: [ChatPeopleSnapshot.Typing], isGroup: Bool) -> String? {
    guard !typers.isEmpty else { return nil }
    guard isGroup else { return L("typing…") }
    let names = typers.map { chatMemberName(key: $0.memberKey, name: $0.name) }
    if names.count == 1 { return L("%@ is typing…", names[0]) }
    return L("%@ are typing…", names.joined(separator: AppLanguage.current == .arabic ? "، " : ", "))
}

/// A person's name as the server gives it, with the manager's own row (which
/// the server names in English) said in the app's language.
func chatMemberName(key: String, name: String) -> String {
    key == "admin" ? L("Manager") : name
}

/// The bubble at the foot of the conversation: three dots rising and falling
/// in turn, with the writers' names above it in a group. Still dots under
/// Reduce Motion.
struct ChatTypingBubble: View {
    let typers: [ChatPeopleSnapshot.Typing]
    let isGroup: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if isGroup {
                Text(verbatim: typers.map { chatMemberName(key: $0.memberKey, name: $0.name) }.joined(separator: AppLanguage.current == .arabic ? "، " : ", "))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.neonPurpleStrong)
                    .lineLimit(1)
                    .padding(.horizontal, 6)
            }
            dots
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(Color.white, in: ChatBubbleShape(mine: false, tail: true))
                .overlay(ChatBubbleShape(mine: false, tail: true).stroke(Color.neonInk.opacity(0.07)))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(chatTypingLine(typers, isGroup: true) ?? L("typing…"))
    }

    @ViewBuilder
    private var dots: some View {
        if reduceMotion {
            HStack(spacing: 5) {
                ForEach(0..<3, id: \.self) { index in
                    Circle().fill(Color.neonInk.opacity(0.28 + 0.12 * Double(index))).frame(width: 7, height: 7)
                }
            }
        } else {
            TimelineView(.animation) { context in
                let t = context.date.timeIntervalSinceReferenceDate
                HStack(spacing: 5) {
                    ForEach(0..<3, id: \.self) { index in
                        // Each dot a third of a beat behind the one before it.
                        let phase = (t * 2.4 - Double(index) * 0.33).truncatingRemainder(dividingBy: 1)
                        let lift = max(0, sin(phase * .pi * 2))
                        Circle()
                            .fill(Color.neonInk.opacity(0.28 + 0.32 * lift))
                            .frame(width: 7, height: 7)
                            .offset(y: -4 * lift)
                    }
                }
                .frame(height: 11, alignment: .bottom)
            }
        }
    }
}

/// A message bubble's outline: a rounded rectangle, with WhatsApp's small tail
/// at the top on the sender's side for the first message in a run. The tail
/// follows the app's direction, as the bubbles do.
struct ChatBubbleShape: InsettableShape {
    let mine: Bool
    var tail: Bool = false
    /// Arabic: the sender's side is the other way round. A shape is not
    /// mirrored by the layout direction, so it is told.
    var rightToLeft: Bool = AppLanguage.current == .arabic
    var radius: CGFloat = 18
    var inset: CGFloat = 0

    func inset(by amount: CGFloat) -> ChatBubbleShape {
        var copy = self
        copy.inset += amount
        return copy
    }

    func path(in rect: CGRect) -> Path {
        let rect = rect.insetBy(dx: inset, dy: inset)
        let r = min(radius, rect.height / 2, rect.width / 2)
        // The corner the tail sits on is squared off, so the tail reads as
        // part of the bubble rather than a sticker on it.
        let small: CGFloat = tail ? 5 : r
        // Mine sit on the trailing side: the right, unless the app is in Arabic.
        let tailOnRight = mine != rightToLeft
        let topLeading = tailOnRight ? r : small
        let topTrailing = tailOnRight ? small : r
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + topLeading, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - topTrailing, y: rect.minY))
        path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.minY), tangent2End: CGPoint(x: rect.maxX, y: rect.minY + topTrailing), radius: topTrailing)
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.maxY), tangent2End: CGPoint(x: rect.maxX - r, y: rect.maxY), radius: r)
        path.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
        path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.maxY), tangent2End: CGPoint(x: rect.minX, y: rect.maxY - r), radius: r)
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + topLeading))
        path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.minY), tangent2End: CGPoint(x: rect.minX + topLeading, y: rect.minY), radius: topLeading)
        path.closeSubpath()
        return path
    }
}
