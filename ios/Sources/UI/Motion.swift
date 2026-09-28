import SwiftUI

// How things arrive, wait and react. Every modifier here checks Reduce Motion
// and falls back to a plain fade (or to nothing) when it is on.

// MARK: - Arriving

/// Fades and rises into place the first time the view appears.
struct NeonAppear: ViewModifier {
    var delay: Double = 0
    var distance: CGFloat = 14
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : distance)
            .onAppear {
                guard !shown else { return }
                if reduceMotion {
                    withAnimation(.easeOut(duration: 0.2)) { shown = true }
                } else {
                    withAnimation(NeonMotion.smooth.delay(delay)) { shown = true }
                }
            }
    }
}

extension View {
    /// Fades and rises in on first appearance.
    func neonAppear(delay: Double = 0, distance: CGFloat = 14) -> some View {
        modifier(NeonAppear(delay: delay, distance: distance))
    }

    /// The n-th row of a list arriving just after the one before it.
    func staggered(_ index: Int) -> some View {
        modifier(NeonAppear(delay: NeonMotion.stagger(index), distance: 12))
    }
}

// MARK: - Waiting

/// A light sweeping across the view: loading placeholders.
struct Shimmer: ViewModifier {
    var active = true
    @State private var phase: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @ViewBuilder
    func body(content: Content) -> some View {
        if active {
            content
                .overlay {
                    GeometryReader { proxy in
                        let width = proxy.size.width
                        LinearGradient(
                            colors: [.white.opacity(0), .white.opacity(reduceMotion ? 0 : 0.65), .white.opacity(0)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: max(width * 0.55, 80))
                        .offset(x: -max(width * 0.55, 80) + phase * (width + max(width * 0.55, 80)))
                    }
                    .mask(content)
                    .allowsHitTesting(false)
                }
                .opacity(reduceMotion ? 1 - 0.3 * phase : 1)
                .onAppear {
                    phase = 0
                    withAnimation(.linear(duration: reduceMotion ? 1.2 : 1.35).repeatForever(autoreverses: reduceMotion)) {
                        phase = 1
                    }
                }
        } else {
            content
        }
    }
}

extension View {
    func shimmer(_ active: Bool = true) -> some View {
        modifier(Shimmer(active: active))
    }

    /// Draws the view as grey blocks with a shimmer while `isLoading`, from
    /// the view's own layout — give it sample content of the right shape.
    func skeleton(_ isLoading: Bool) -> some View {
        redacted(reason: isLoading ? .placeholder : [])
            .shimmer(isLoading)
            .allowsHitTesting(!isLoading)
            .accessibilityHidden(isLoading)
    }
}

/// A grey block for building a loading placeholder by hand.
struct SkeletonBlock: View {
    var width: CGFloat?
    var height: CGFloat = 14
    var radius: CGFloat = 7

    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(Color.neonInk.opacity(0.07))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}

// MARK: - Reacting

/// A horizontal shake, for a refused form. Change `trigger` to shake once.
struct ShakeEffect: GeometryEffect {
    var travel: CGFloat = 7
    var animatableData: CGFloat

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: travel * sin(animatableData * .pi * 4), y: 0))
    }
}

extension View {
    /// Shakes once every time `trigger` changes (increment it on an error).
    func shake(_ trigger: Int) -> some View {
        modifier(ShakeEffect(animatableData: CGFloat(trigger)))
            .animation(NeonMotion.reduceMotion ? nil : .linear(duration: 0.42), value: trigger)
    }
}

/// A slow bob up and down — an empty state's symbol breathing.
struct NeonFloat: ViewModifier {
    var distance: CGFloat = 4
    @State private var up = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .offset(y: up && !reduceMotion ? -distance : 0)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 2.2).repeatForever(autoreverses: true)) { up = true }
            }
    }
}

/// A soft repeating pulse — something live: a running state, a call.
struct NeonPulse: ViewModifier {
    var active = true
    @State private var on = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .scaleEffect(active && on && !reduceMotion ? 1.35 : 1)
            .opacity(active && on ? 0.55 : 1)
            .onAppear {
                guard active else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { on = true }
            }
    }
}

extension View {
    func neonFloat(_ distance: CGFloat = 4) -> some View { modifier(NeonFloat(distance: distance)) }
    func neonPulse(_ active: Bool = true) -> some View { modifier(NeonPulse(active: active)) }

    /// The lifted preview of a context menu takes the card's rounded shape
    /// instead of a hard rectangle.
    func neonContextShape(radius: CGFloat = NeonRadius.lg) -> some View {
        contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}
