import SwiftUI

// The ticks on my own messages, WhatsApp's way: one grey tick when the server
// has it, two grey when it has reached everybody else in the conversation,
// two green when everybody else has read it — plus a clock while it is still
// on its way and a red mark when it could not be sent.
//
// The rule is lib/mobile/chat-receipt-rules.ts's `deliveryOf`, drawn from what
// the server already records and nothing else: "reached" is somebody's app or
// web page being connected when the message was saved or since (a presence
// heartbeat after it, or within the green dot's window before it), "read" is
// their read marker for this conversation being at or after it. Both only
// move forward, so ticks never go back. In the team and in a group the ticks move only when
// EVERYBODY else has got there — which is honest, because the app is told
// every member's marker. The website still draws no read tick in the team;
// that is its own decision and is left alone.

/// How far one of my messages has got.
enum ChatDelivery: Equatable {
    /// On its way from this phone (not on the server yet).
    case sending
    /// This phone could not send it; it is still here to try again.
    case failed
    case sent
    case delivered
    case read

    var label: String {
        switch self {
        case .sending: return L("Sending…")
        case .failed: return L("Not sent")
        case .sent: return L("Sent")
        case .delivered: return L("Delivered")
        case .read: return L("Read")
        }
    }
}

/// Everybody else's progress through a conversation, folded down to the two
/// moments that decide every tick: the earliest read marker among them, and
/// the earliest moment each of them was last reached (read or here, whichever
/// is later for that person). A message at or before the first is read by all;
/// at or before the second, it reached all. Built once per snapshot, so each
/// message's ticks are two comparisons rather than a pass over every member.
struct ChatReceiptBoard: Equatable {
    /// nil: somebody has never opened it (or there is nobody), so nothing is read by all.
    let readByAllUpTo: Date?
    let reachedAllUpTo: Date?
    /// Nobody else is in the conversation, or the server has not said who is.
    let isEmpty: Bool

    static let unknown = ChatReceiptBoard(readByAllUpTo: nil, reachedAllUpTo: nil, isEmpty: true)

    init(readByAllUpTo: Date?, reachedAllUpTo: Date?, isEmpty: Bool) {
        self.readByAllUpTo = readByAllUpTo
        self.reachedAllUpTo = reachedAllUpTo
        self.isEmpty = isEmpty
    }

    /// From the snapshot's members. A server that predates `members` sends
    /// none; in a private chat the one read marker it does send still says
    /// read or not, as the web's own tick does — never "delivered", which it
    /// cannot know.
    init(snapshot: ChatPeopleSnapshot, fallbackOtherKey: String?) {
        if snapshot.members.isEmpty {
            if let key = fallbackOtherKey, let mark = snapshot.reads.first(where: { $0.key == key }), let at = parseISODate(mark.at) {
                self.init(readByAllUpTo: at, reachedAllUpTo: at, isEmpty: false)
            } else {
                self = .unknown
            }
            return
        }
        var readAll: Date? = .distantFuture
        var reachedAll: Date? = .distantFuture
        for member in snapshot.members {
            let read = parseISODate(member.readAt)
            // Connected when a message was sent means a beat after it, or one
            // close enough before it that the green dot still showed them.
            let seen = parseISODate(member.seenAt)?.addingTimeInterval(Self.onlineWindow)
            let reached = [read, seen].compactMap { $0 }.max()
            readAll = Self.earliest(readAll, read)
            reachedAll = Self.earliest(reachedAll, reached)
        }
        self.init(readByAllUpTo: readAll, reachedAllUpTo: reachedAll, isEmpty: false)
    }

    /// ONLINE_WINDOW_MS in lib/presence.ts: how long after a heartbeat somebody still counts as here.
    static let onlineWindow: TimeInterval = 75

    /// The earlier of two moments, where nil (never) beats everything.
    private static func earliest(_ a: Date?, _ b: Date?) -> Date? {
        guard let a, let b else { return nil }
        return min(a, b)
    }

    func delivery(of createdAt: Date?) -> ChatDelivery {
        guard !isEmpty, let createdAt else { return .sent }
        if let readByAllUpTo, readByAllUpTo >= createdAt { return .read }
        if let reachedAllUpTo, reachedAllUpTo >= createdAt { return .delivered }
        return .sent
    }
}

/// The tick marks themselves: one or two checks, drawn rather than taken from
/// SF Symbols, which has no double check. Never mirrored in Arabic — ticks are
/// a mark, not a direction.
struct ChatTicks: View {
    let delivery: ChatDelivery
    /// The colour of a grey tick where it sits (white-ish on my own bubble,
    /// on a photo's shade; ink on the page).
    var tint: Color = Color.neonInk.opacity(0.45)
    /// The green of "read" — bright enough to tell apart on the purple bubble.
    var readTint: Color = ChatTickPalette.read

    var body: some View {
        Group {
            switch delivery {
            case .sending:
                Image(systemName: "clock")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(tint)
            case .failed:
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.neonDanger)
            case .sent:
                ChatTickShape(double: false)
                    .stroke(tint, style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
                    .frame(width: 11, height: 9)
            case .delivered:
                ChatTickShape(double: true)
                    .stroke(tint, style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
                    .frame(width: 16, height: 9)
            case .read:
                ChatTickShape(double: true)
                    .stroke(readTint, style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
                    .frame(width: 16, height: 9)
            }
        }
        .environment(\.layoutDirection, .leftToRight)
        .accessibilityElement()
        .accessibilityLabel(delivery.label)
        .animation(NeonMotion.quick, value: delivery)
    }
}

enum ChatTickPalette {
    /// WhatsApp's read green, a shade lighter so it reads on the purple bubble.
    static let read = Color(red: 0.29, green: 0.87, blue: 0.50)
    /// The same green on a white bubble or the page, where the light one fades.
    static let readOnLight = Color(red: 0.06, green: 0.66, blue: 0.40)
}

/// One check, or two overlapping ones like WhatsApp's.
struct ChatTickShape: Shape {
    let double: Bool

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let h = rect.height
        let checkWidth = double ? rect.width * 0.70 : rect.width
        func check(offset: CGFloat, withShortArm: Bool) {
            if withShortArm {
                path.move(to: CGPoint(x: offset, y: h * 0.55))
                path.addLine(to: CGPoint(x: offset + checkWidth * 0.36, y: h * 0.95))
            } else {
                path.move(to: CGPoint(x: offset + checkWidth * 0.36, y: h * 0.95))
            }
            path.addLine(to: CGPoint(x: offset + checkWidth, y: h * 0.05))
        }
        check(offset: 0, withShortArm: true)
        // The second check shares the first's baseline, its short arm hidden
        // behind the first's long one — the way the WhatsApp mark is drawn.
        if double { check(offset: rect.width - checkWidth, withShortArm: false) }
        return path
    }
}
