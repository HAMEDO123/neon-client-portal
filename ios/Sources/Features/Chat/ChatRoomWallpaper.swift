import SwiftUI
import UIKit

// The conversation's surroundings: the page it sits on, the placeholder while
// it loads, the button back to the newest message, and the edge swipe back
// that a screen with its own header would otherwise lose.

// MARK: - Wallpaper

/// The app's lavender page with a faint pattern of the studio's own things —
/// rooms, rulers, lamps — the way a messaging app's wallpaper sits behind the
/// bubbles without competing with them. Fixed: it does not scroll.
struct ChatRoomWallpaper: View {
    var body: some View {
        ZStack {
            NeonAmbient()
            ChatRoomDoodles()
        }
        .accessibilityHidden(true)
    }
}

private struct ChatRoomDoodles: View {
    private static let symbols = [
        "house", "sofa", "ruler", "lamp.floor", "pencil.and.ruler", "chair.lounge",
        "paintpalette", "cube", "lightbulb", "square.split.bottomrightquarter",
        "bed.double", "leaf", "building.2", "paintbrush.pointed",
    ]

    var body: some View {
        Canvas { context, size in
            let step: CGFloat = 66
            var row = 0
            var y: CGFloat = 18
            while y < size.height + step {
                var x: CGFloat = row.isMultiple(of: 2) ? 14 : 14 + step / 2
                var column = 0
                while x < size.width + step {
                    let index = (row * 5 + column * 3) % Self.symbols.count
                    if let symbol = context.resolveSymbol(id: index) {
                        var copy = context
                        copy.translateBy(x: x, y: y)
                        copy.rotate(by: .degrees(Double((row + column * 2) % 5 - 2) * 8))
                        copy.draw(symbol, at: .zero)
                    }
                    x += step
                    column += 1
                }
                y += step * 0.84
                row += 1
            }
        } symbols: {
            ForEach(Array(Self.symbols.enumerated()), id: \.offset) { index, name in
                Image(systemName: name)
                    .font(.system(size: 19, weight: .light))
                    .foregroundStyle(Color.neonIndigo)
                    .tag(index)
            }
        }
        .opacity(0.055)
        .allowsHitTesting(false)
    }
}

// MARK: - Loading

/// Bubbles of the conversation's shape, shimmering, until the first read answers.
struct ChatRoomSkeleton: View {
    private let rows: [(mine: Bool, width: CGFloat, height: CGFloat)] = [
        (false, 190, 38), (false, 130, 38), (true, 220, 56), (false, 250, 180),
        (true, 150, 38), (false, 170, 38), (true, 110, 38),
    ]

    var body: some View {
        VStack(spacing: 6) {
            Spacer(minLength: 0)
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                ChatBubbleShape(mine: row.mine, tail: index == 0 || rows[index - 1].mine != row.mine)
                    .fill(row.mine ? Color.neonIndigo.opacity(0.13) : Color.white.opacity(0.9))
                    .frame(width: row.width, height: row.height)
                    .frame(maxWidth: .infinity, alignment: row.mine ? .trailing : .leading)
                    .padding(.top, index > 0 && rows[index - 1].mine != row.mine ? 8 : 0)
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 16)
        .shimmer()
        .accessibilityElement()
        .accessibilityLabel(L("Loading"))
    }
}

// MARK: - Back to the newest

/// Scrolled up: a round button back to the newest message, carrying how many
/// arrived meanwhile.
struct ChatRoomJumpButton: View {
    let unseen: Int
    let action: () -> Void

    var body: some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            Image(systemName: "chevron.down")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(unseen > 0 ? Color.neonAccent : Color.neonTextSecondary)
                .frame(width: 42, height: 42)
                .background(Circle().fill(Color.white))
                .overlay(Circle().strokeBorder(Color.neonLine, lineWidth: 0.75))
                .neonShadow(.raised)
                .overlay(alignment: .top) {
                    CountBadge(unseen, size: 20)
                        .offset(y: -9)
                }
                .contentShape(Circle())
        }
        .buttonStyle(PressableStyle(scale: 0.88))
        .accessibilityLabel(unseen == 1 ? L("1 new message") : unseen > 1 ? L("%d new messages", unseen) : L("Newest messages"))
        .animation(NeonMotion.resolved(NeonMotion.bouncy), value: unseen)
    }
}

// MARK: - Edge swipe

/// The conversation draws its own header, so the system bar is hidden — and a
/// hidden bar takes the edge swipe back with it. This gives it back while the
/// conversation is on screen, and hands the gesture's old delegate back after.
struct ChatRoomSwipeBack: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> Controller { Controller() }
    func updateUIViewController(_ controller: Controller, context: Context) {}

    final class Controller: UIViewController, UIGestureRecognizerDelegate {
        private weak var previousDelegate: UIGestureRecognizerDelegate?
        private weak var gesture: UIGestureRecognizer?

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            guard let pop = navigationController?.interactivePopGestureRecognizer, pop.delegate !== self else { return }
            previousDelegate = pop.delegate
            gesture = pop
            pop.delegate = self
            pop.isEnabled = true
        }

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            if let gesture, gesture.delegate === self { gesture.delegate = previousDelegate }
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            (navigationController?.viewControllers.count ?? 0) > 1
        }
    }
}

// MARK: - Last seen

/// When the other person was last here, in the web's own words
/// (lib/presence.ts `lastSeenLabel`). nil when the platform has never seen
/// them — not knowing is not the same as being away — and while they are here.
func chatLastSeen(_ iso: String?, now: Date = Date()) -> String? {
    guard let seen = parseISODate(iso) else { return nil }
    let elapsed = now.timeIntervalSince(seen)
    guard elapsed >= ChatReceiptBoard.onlineWindow else { return nil }
    let minutes = Int(elapsed / 60)
    if minutes < 1 { return L("Last seen just now") }
    if minutes < 60 { return L("Last seen %d min ago", minutes) }
    let hours = minutes / 60
    if hours < 24 { return L("Last seen %d h ago", hours) }
    let days = hours / 24
    if days == 1 { return L("Last seen yesterday") }
    if days < 7 { return L("Last seen %d days ago", days) }
    return L("Last seen a while ago")
}
