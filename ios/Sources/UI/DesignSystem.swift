import SwiftUI
import UIKit

// MARK: - Colour

// Ported 1:1 from the web app's design tokens (src/app/globals.css) so the
// native app is visually the same product, not a reinterpretation.
extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }

    // Brand — the web's own variables.
    static let neonBg = Color(hex: 0xF7F6FB)
    static let neonBgSoft = Color(hex: 0xEEF0FA)
    static let neonInk = Color(hex: 0x15131F)
    static let neonCyan = Color(hex: 0x06B6D4)
    static let neonCyanStrong = Color(hex: 0x0E7490)
    static let neonPurple = Color(hex: 0x8B5CF6)
    static let neonPurpleStrong = Color(hex: 0x6D28D9)
    static let neonPink = Color(hex: 0xEC4899)
    static let neonPinkStrong = Color(hex: 0xBE185D)
    static let neonOrange = Color(hex: 0xF59E0B)
    static let neonOrangeStrong = Color(hex: 0xB45309)

    // Meaning. "Strong" is the one to put text and glyphs in; the plain one
    // is for fills, dots and bars.
    static let neonSuccess = Color(hex: 0x10B981)
    static let neonSuccessStrong = Color(hex: 0x047857)
    static let neonDanger = Color(hex: 0xEF4444)
    static let neonDangerStrong = Color(hex: 0xB91C1C)
    static let neonWarning = Color.neonOrange
    static let neonWarningStrong = Color.neonOrangeStrong
    static let neonInfo = Color.neonCyan
    static let neonInfoStrong = Color.neonCyanStrong

    // Text, from loudest to quietest.
    static let neonText = Color.neonInk
    static let neonTextSecondary = Color.neonInk.opacity(0.62)
    static let neonTextTertiary = Color.neonInk.opacity(0.44)
    static let neonTextFaint = Color.neonInk.opacity(0.28)

    // Surfaces and lines — the web's --glass and --line.
    static let neonSurface = Color.white.opacity(0.72)
    static let neonSurfaceStrong = Color.white.opacity(0.94)
    static let neonSurfaceSunken = Color.neonInk.opacity(0.045)
    static let neonLine = Color.neonInk.opacity(0.09)
    static let neonLineStrong = Color.neonInk.opacity(0.16)
}

/// The colours a chart or a list of categories cycles through, in order.
enum NeonPalette {
    static let series: [Color] = [
        .neonPurple, .neonCyan, .neonPink, .neonOrange,
        .neonSuccess, .neonPurpleStrong, .neonCyanStrong, .neonPinkStrong,
    ]

    static func color(at index: Int) -> Color {
        series[((index % series.count) + series.count) % series.count]
    }

    /// A stable colour for a name, so a person keeps theirs across screens and
    /// launches (`hashValue` is re-seeded every launch, so it is not used).
    static func color(for name: String) -> Color {
        let seed = name.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0x7FFF_FFFF }
        return accents[seed % accents.count]
    }

    static let accents: [Color] = [.neonPurpleStrong, .neonCyanStrong, .neonPinkStrong, .neonOrangeStrong, .neonSuccessStrong]
}

extension LinearGradient {
    static let neonWordmark = LinearGradient(
        colors: [.neonCyanStrong, .neonPurple, .neonPink],
        startPoint: .leading,
        endPoint: .trailing
    )

    static let neonAmbient = LinearGradient(
        colors: [.neonCyan.opacity(0.18), .neonPurple.opacity(0.14), .neonPink.opacity(0.12)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// The brand's accent fill: floating buttons, the brand button, rings.
    static let neonBrand = LinearGradient(
        colors: [.neonCyan, .neonPurple, .neonPink],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Dark hero cards and the primary button.
    static let neonInkHero = LinearGradient(
        colors: [Color(hex: 0x15131F), Color(hex: 0x2C2347)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// `.glass` in globals.css: translucent white, brighter at the top.
    static let neonGlass = LinearGradient(
        colors: [.white.opacity(0.82), .white.opacity(0.56)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// `.glass-strong`.
    static let neonGlassStrong = LinearGradient(
        colors: [.white.opacity(0.96), .white.opacity(0.74)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// A lit top edge and a dark hairline at the bottom — the glass border.
    static let neonGlassEdge = LinearGradient(
        colors: [.white.opacity(0.95), .neonInk.opacity(0.08)],
        startPoint: .top,
        endPoint: .bottom
    )

    static func neonTint(_ color: Color) -> LinearGradient {
        LinearGradient(colors: [color, color.opacity(0.72)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

// MARK: - Surfaces

/// What a card is made of. `.glass` is the web's `.glass`, and the default
/// everywhere; the others are for emphasis.
enum NeonSurface {
    /// Translucent white with a lit edge and a long soft shadow.
    case glass
    /// `.glass-strong`: more opaque, lifted higher. Sheets, sign-in, heroes.
    case strong
    /// Plain white, barely lifted. Dense lists.
    case solid
    /// Pressed into the page: grouped controls, empty wells.
    case sunken
    /// A hairline and nothing else.
    case outline
    /// A wash of one colour: a warning, a highlighted card.
    case tinted(Color)
    /// The dark hero card. Put white text on it.
    case ink
    /// The brand gradient. Put white text on it.
    case brand
    /// Real blur, for cards that sit on photographs.
    case frosted
}

struct NeonSurfaceBackground: ViewModifier {
    let surface: NeonSurface
    var radius: CGFloat = NeonRadius.lg

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background { fill(shape) }
            .overlay { border(shape) }
    }

    @ViewBuilder
    private func fill(_ shape: RoundedRectangle) -> some View {
        switch surface {
        case .glass:
            shape.fill(LinearGradient.neonGlass)
                .shadow(color: .neonInk.opacity(0.07), radius: 16, x: 0, y: 8)
        case .strong:
            shape.fill(LinearGradient.neonGlassStrong)
                .shadow(color: .neonInk.opacity(0.10), radius: 24, x: 0, y: 14)
        case .solid:
            shape.fill(Color.white)
                .shadow(color: .neonInk.opacity(0.05), radius: 8, x: 0, y: 3)
        case .sunken:
            shape.fill(Color.neonSurfaceSunken)
        case .outline:
            shape.fill(Color.clear)
        case .tinted(let color):
            shape.fill(color.opacity(0.10))
        case .ink:
            shape.fill(LinearGradient.neonInkHero)
                .shadow(color: .neonInk.opacity(0.28), radius: 22, x: 0, y: 12)
        case .brand:
            shape.fill(LinearGradient.neonBrand)
                .shadow(color: .neonPurple.opacity(0.35), radius: 22, x: 0, y: 12)
        case .frosted:
            shape.fill(.ultraThinMaterial)
                .shadow(color: .black.opacity(0.12), radius: 14, x: 0, y: 6)
        }
    }

    @ViewBuilder
    private func border(_ shape: RoundedRectangle) -> some View {
        switch surface {
        case .glass, .strong:
            shape.strokeBorder(LinearGradient.neonGlassEdge, lineWidth: 1)
        case .solid:
            shape.strokeBorder(Color.neonInk.opacity(0.06), lineWidth: 1)
        case .sunken:
            shape.strokeBorder(Color.neonInk.opacity(0.04), lineWidth: 1)
        case .outline:
            shape.strokeBorder(Color.neonLineStrong, lineWidth: 1)
        case .tinted(let color):
            shape.strokeBorder(color.opacity(0.20), lineWidth: 1)
        case .ink, .brand, .frosted:
            shape.strokeBorder(Color.white.opacity(0.14), lineWidth: 1)
        }
    }
}

// Kept for every screen already calling it: the glass surface at a radius.
struct GlassCard: ViewModifier {
    var radius: CGFloat = 20

    func body(content: Content) -> some View {
        content.modifier(NeonSurfaceBackground(surface: .glass, radius: radius))
    }
}

extension View {
    func glassCard(radius: CGFloat = 20) -> some View {
        modifier(GlassCard(radius: radius))
    }

    /// Puts the view on one of the kit's surfaces. Padding is the caller's.
    func neonSurface(_ surface: NeonSurface = .glass, radius: CGFloat = NeonRadius.lg) -> some View {
        modifier(NeonSurfaceBackground(surface: surface, radius: radius))
    }

    /// Soft blurred brand-coloured blobs behind content, for the same ambient
    /// depth the web app gets from its grid-overlay + glass layering.
    /// `animated` lets them drift slowly (sign-in, heroes); lists keep them still.
    func neonAmbientBackground(animated: Bool = false) -> some View {
        background(NeonAmbient(animated: animated).ignoresSafeArea())
    }
}

/// The page behind every screen.
struct NeonAmbient: View {
    var animated = false
    @State private var drift = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let moving = animated && drift && !reduceMotion
        ZStack {
            Color.neonBg
            Circle()
                .fill(Color.neonPurple.opacity(0.16))
                .frame(width: 300, height: 300)
                .blur(radius: 70)
                .offset(x: moving ? -80 : -120, y: moving ? -180 : -230)
            Circle()
                .fill(Color.neonCyan.opacity(0.14))
                .frame(width: 280, height: 280)
                .blur(radius: 70)
                .offset(x: moving ? 110 : 150, y: moving ? 300 : 260)
            Circle()
                .fill(Color.neonPink.opacity(animated ? 0.10 : 0.06))
                .frame(width: 220, height: 220)
                .blur(radius: 70)
                .offset(x: moving ? 130 : 90, y: moving ? -60 : -10)
        }
        .onAppear {
            guard animated, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 9).repeatForever(autoreverses: true)) { drift = true }
        }
    }
}

// MARK: - Badges

enum BadgeTone {
    case cyan, purple, pink, orange, neutral, success, warning, danger, info

    var background: Color {
        switch self {
        case .cyan: return .neonCyan.opacity(0.13)
        case .purple: return .neonPurple.opacity(0.13)
        case .pink: return .neonPink.opacity(0.13)
        case .orange: return .neonOrange.opacity(0.15)
        case .neutral: return .neonInk.opacity(0.06)
        case .success: return .neonSuccess.opacity(0.14)
        case .warning: return .neonOrange.opacity(0.16)
        case .danger: return .neonDanger.opacity(0.12)
        case .info: return .neonCyan.opacity(0.13)
        }
    }

    /// Text and glyphs on `background`.
    var foreground: Color {
        switch self {
        case .cyan: return .neonCyanStrong
        case .purple: return .neonPurpleStrong
        case .pink: return .neonPinkStrong
        case .orange: return .neonOrangeStrong
        case .neutral: return .neonInk.opacity(0.68)
        case .success: return .neonSuccessStrong
        case .warning: return .neonOrangeStrong
        case .danger: return .neonDangerStrong
        case .info: return .neonCyanStrong
        }
    }

    /// The tone as a solid colour: dots, bars, a filled icon.
    var color: Color {
        switch self {
        case .cyan, .info: return .neonCyan
        case .purple: return .neonPurple
        case .pink: return .neonPink
        case .orange, .warning: return .neonOrange
        case .neutral: return .neonInk.opacity(0.35)
        case .success: return .neonSuccess
        case .danger: return .neonDanger
        }
    }
}

/// A small uppercase label: a state, a count, a tag.
struct BadgeView: View {
    let text: String
    let tone: BadgeTone
    var symbol: String?

    var body: some View {
        HStack(spacing: 4) {
            if let symbol {
                Image(systemName: symbol).font(.system(size: 9, weight: .bold))
            }
            Text(text.uppercased())
                .lineLimit(1)
        }
        .font(.system(size: 11, weight: .semibold))
        .tracking(0.4)
        .padding(.horizontal, 9)
        .padding(.vertical, 4.5)
        .background(tone.background, in: Capsule())
        .foregroundStyle(tone.foreground)
    }
}

func publishTone(_ state: String) -> BadgeTone {
    switch state {
    case "PUBLISHED": return .success
    case "ARCHIVED": return .neutral
    default: return .warning
    }
}

/// A tone for the platform's status words, so the same word wears the same
/// colour on every screen. Task states go through `taskStateTone` (Core).
/// "INVITED" and "PLANNED" are deliberately calm: silence is not a verdict.
func statusTone(_ raw: String) -> BadgeTone {
    switch raw {
    case "TODO", "IN_PROGRESS", "SUBMITTED", "DONE", "TOMORROW":
        return taskStateTone(raw)
    case "APPROVED", "ACCEPTED", "PUBLISHED", "RESOLVED", "VISITED", "COMPLETED", "PURCHASED", "PAID", "ANALYZED", "JOINED", "SENT":
        return .success
    case "PENDING", "INTERNAL_REVIEW", "CLIENT_REVIEWING", "SENT_TO_CLIENT", "RINGING":
        return .warning
    case "REJECTED", "FAILED", "MISSED", "EXPIRED":
        return .danger
    case "CHANGES_REQUESTED":
        return .pink
    case "PLANNED", "OPEN", "ACTIVE", "EXECUTION", "ONLINE":
        return .cyan
    case "HIGH":
        return .pink
    case "MEDIUM":
        return .orange
    default:
        return .neutral
    }
}

// MARK: - Touch

// Springy press feedback for tappable cards and buttons — the whole surface
// visibly responds to touch instead of behaving like static text.
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.96

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == PressableStyle {
    /// Buttons, chips, small tiles.
    static var pressable: PressableStyle { PressableStyle() }
    /// A whole card: a gentler squeeze, so a big surface doesn't jump.
    static var pressableCard: PressableStyle { PressableStyle(scale: 0.985) }
}

enum Haptic {
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func soft() { UIImpactFeedbackGenerator(style: .soft).impactOccurred() }
    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .medium) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }
    /// A picker, a chip, a segment: the selection moved.
    static func selection() { UISelectionFeedbackGenerator().selectionChanged() }
}
