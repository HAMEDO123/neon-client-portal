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

/// The colour a person's name wears over their messages in a group — the
/// same family their initials avatar is drawn in, so the two read as one.
func chatAuthorColor(_ name: String) -> Color {
    NeonPalette.hue(for: name).deep
}

/// The bubble at the foot of the conversation: three dots rising and falling
/// in turn, with the writers' names above it in a group. Still dots under
/// Reduce Motion.
struct ChatTypingBubble: View {
    let typers: [ChatPeopleSnapshot.Typing]
    let isGroup: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            // In a group, the same column as everybody else's bubbles, under
            // the (first) writer's initials.
            if isGroup {
                ChatAuthorBadge(name: typers.first.map { chatMemberName(key: $0.memberKey, name: $0.name) })
            }
            bubble
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(chatTypingLine(typers, isGroup: true) ?? L("typing…"))
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 3) {
            if isGroup {
                Text(verbatim: typers.map { chatMemberName(key: $0.memberKey, name: $0.name) }.joined(separator: AppLanguage.current == .arabic ? "، " : ", "))
                    .font(.system(.caption, weight: .semibold))
                    .foregroundStyle(typers.count == 1 ? chatAuthorColor(typers[0].name) : Color.neonAccent)
                    .lineLimit(1)
                    .padding(.leading, ChatBubbleShape.tailWidth + 6)
            }
            ChatTypingDots(tint: .neonTextTertiary, size: 7)
                .padding(.leading, 14 + ChatBubbleShape.tailWidth)
                .padding(.trailing, 14)
                .padding(.vertical, 13)
                .background(ChatBubbleShape(mine: false, tail: true).fill(Color.white))
                .overlay(ChatBubbleShape(mine: false, tail: true).stroke(Color.neonLine, lineWidth: 0.75))
                .neonShadow(.low)
        }
    }
}

/// Three dots rising and falling in turn — in the typing bubble, and small
/// beside "typing…" in the header. Still under Reduce Motion.
struct ChatTypingDots: View {
    var tint: Color
    var size: CGFloat = 7

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if reduceMotion {
            HStack(spacing: size * 0.7) {
                ForEach(0..<3, id: \.self) { index in
                    Circle().fill(tint.opacity(0.55 + 0.15 * Double(index))).frame(width: size, height: size)
                }
            }
        } else {
            TimelineView(.animation) { context in
                let t = context.date.timeIntervalSinceReferenceDate
                HStack(spacing: size * 0.7) {
                    ForEach(0..<3, id: \.self) { index in
                        // Each dot a third of a beat behind the one before it.
                        let phase = (t * 2.4 - Double(index) * 0.33).truncatingRemainder(dividingBy: 1)
                        let lift = max(0, sin(phase * .pi * 2))
                        Circle()
                            .fill(tint.opacity(0.45 + 0.55 * lift))
                            .frame(width: size, height: size)
                            .offset(y: -size * 0.55 * lift)
                    }
                }
                .frame(height: size * 1.6, alignment: .bottom)
            }
        }
    }
}

/// A message bubble's outline, WhatsApp's way: a rounded rectangle with a
/// small curved tail at the top on the sender's side, for the first message
/// of a run. Every bubble leaves the tail's width free on that side, tail or
/// not, so the bubbles of one run line up under the first.
struct ChatBubbleShape: InsettableShape {
    let mine: Bool
    var tail: Bool = false
    /// Arabic: the sender's side is the other way round. A shape is not
    /// mirrored by the layout direction, so it is told.
    var rightToLeft: Bool = AppLanguage.current == .arabic
    var radius: CGFloat = 18
    var inset: CGFloat = 0

    /// How far the tail reaches past the bubble's body.
    static let tailWidth: CGFloat = 7

    func inset(by amount: CGFloat) -> ChatBubbleShape {
        var copy = self
        copy.inset += amount
        return copy
    }

    func path(in rect: CGRect) -> Path {
        let rect = rect.insetBy(dx: inset, dy: inset)
        let t = Self.tailWidth
        // Drawn with the tail on the right, then mirrored when it belongs on the left.
        let body = CGRect(x: rect.minX, y: rect.minY, width: max(0, rect.width - t), height: rect.height)
        let r = min(radius, body.height / 2, body.width / 2)
        var path = Path()
        path.move(to: CGPoint(x: body.minX + r, y: body.minY))
        if tail {
            let drop = min(13, max(4, body.height - r))
            path.addLine(to: CGPoint(x: body.maxX + t - 1.6, y: body.minY))
            // A softened tip, then a concave sweep back into the bubble's side.
            path.addQuadCurve(to: CGPoint(x: body.maxX + t - 1.4, y: body.minY + 2.4),
                              control: CGPoint(x: body.maxX + t + 0.6, y: body.minY + 0.5))
            path.addQuadCurve(to: CGPoint(x: body.maxX, y: body.minY + drop),
                              control: CGPoint(x: body.maxX + 1.2, y: body.minY + drop * 0.45))
        } else {
            path.addLine(to: CGPoint(x: body.maxX - r, y: body.minY))
            path.addArc(tangent1End: CGPoint(x: body.maxX, y: body.minY), tangent2End: CGPoint(x: body.maxX, y: body.minY + r), radius: r)
        }
        path.addLine(to: CGPoint(x: body.maxX, y: body.maxY - r))
        path.addArc(tangent1End: CGPoint(x: body.maxX, y: body.maxY), tangent2End: CGPoint(x: body.maxX - r, y: body.maxY), radius: r)
        path.addLine(to: CGPoint(x: body.minX + r, y: body.maxY))
        path.addArc(tangent1End: CGPoint(x: body.minX, y: body.maxY), tangent2End: CGPoint(x: body.minX, y: body.maxY - r), radius: r)
        path.addLine(to: CGPoint(x: body.minX, y: body.minY + r))
        path.addArc(tangent1End: CGPoint(x: body.minX, y: body.minY), tangent2End: CGPoint(x: body.minX + r, y: body.minY), radius: r)
        path.closeSubpath()

        // Mine sit on the trailing side: the right, unless the app is in Arabic.
        let tailOnRight = mine != rightToLeft
        guard !tailOnRight else { return path }
        return path.applying(CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: rect.minX + rect.maxX, ty: 0))
    }
}
