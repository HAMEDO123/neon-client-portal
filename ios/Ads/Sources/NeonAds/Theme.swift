#if targetEnvironment(macCatalyst)
import SwiftUI

// MARK: - Liquid Glass theme (macOS 26, through Mac Catalyst), with a material fallback on older systems

/// ImageRenderer can't draw Liquid Glass, so snapshot mode uses the material fallback.
let glassOn: Bool = !CommandLine.arguments.contains("-neonAdsSnapshot")

extension View {
    @ViewBuilder
    func glassCard(_ radius: CGFloat = 18, tint: Color? = nil) -> some View {
        if tint == nil {
            self.surfaceCard(radius)
        } else if #available(iOS 26.0, *), glassOn {
            self.glassEffect(Glass.regular.tint(tint!.opacity(0.55)), in: .rect(cornerRadius: radius))
        } else {
            self.background(RoundedRectangle(cornerRadius: radius).fill(tint.map { AnyShapeStyle($0.opacity(0.85)) } ?? AnyShapeStyle(.ultraThinMaterial)))
                .overlay(RoundedRectangle(cornerRadius: radius).stroke(.white.opacity(0.18)))
        }
    }

    @ViewBuilder
    func glassButton(prominent: Bool = false) -> some View {
        if #available(iOS 26.0, *), glassOn {
            if prominent { self.buttonStyle(.glassProminent) } else { self.buttonStyle(.glass) }
        } else {
            if prominent { self.buttonStyle(.borderedProminent) } else { self.buttonStyle(.bordered) }
        }
    }

    @ViewBuilder
    func glassPill(_ tint: Color? = nil) -> some View {
        if #available(iOS 26.0, *), glassOn {
            self.glassEffect(tint.map { Glass.regular.tint($0.opacity(0.35)) } ?? .regular, in: .capsule)
        } else {
            self.background(Capsule().fill(.ultraThinMaterial))
        }
    }
}

/// Calm light canvas (directive V2: gradients only where they reinforce the identity).
struct AuroraBackground: View {
    @Environment(\.colorScheme) var scheme
    var body: some View {
        (scheme == .dark ? Color(red: 0.06, green: 0.07, blue: 0.10) : Brand.bg).ignoresSafeArea()
    }
}

extension View {
    /// White card with hairline border + soft shadow (primary surface).
    func surfaceCard(_ radius: CGFloat = 16) -> some View {
        self.background(RoundedRectangle(cornerRadius: radius).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(Color.primary.opacity(0.07)))
            .shadow(color: .black.opacity(0.04), radius: 10, y: 3)
    }
}


/// ScrollView in the app; a plain stack in -snapshot mode (ImageRenderer can't draw scroll content).
struct MaybeScroll<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        if glassOn { ScrollView { content } } else { content }
    }
}

#endif
