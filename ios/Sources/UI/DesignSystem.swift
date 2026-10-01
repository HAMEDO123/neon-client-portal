import SwiftUI
import UIKit

// Also compiled into the share extension (ios/Share/README.md): extension-safe
// APIs only, and nothing from the rest of the app beyond AppLanguage and L.

// MARK: - Colour

// The web app's brand hues, tuned to the owner's mockups: a cool near-black
// ink, cool greys, and vivid blue, indigo, purple, pink, orange and green.
extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }

    // Brand.
    /// The page: a cool near-white. `NeonAmbient` washes lavender over its top.
    static let neonBg = Color(hex: 0xF3F5FC)
    /// The lavender at the top of the page.
    static let neonBgSoft = Color(hex: 0xECEBFC)
    static let neonInk = Color(hex: 0x0B1020)
    static let neonCyan = Color(hex: 0x06B6D4)
    static let neonCyanStrong = Color(hex: 0x0E7490)
    static let neonBlue = Color(hex: 0x3490FA)
    static let neonBlueStrong = Color(hex: 0x2563EB)
    static let neonIndigo = Color(hex: 0x4548F0)
    static let neonIndigoStrong = Color(hex: 0x3730C8)
    static let neonPurple = Color(hex: 0x8B5CF6)
    static let neonPurpleStrong = Color(hex: 0x6D28D9)
    static let neonPink = Color(hex: 0xEC4899)
    static let neonPinkStrong = Color(hex: 0xBE185D)
    static let neonOrange = Color(hex: 0xF97316)
    static let neonOrangeStrong = Color(hex: 0xC2410C)
    static let neonAmber = Color(hex: 0xF59E0B)
    static let neonAmberStrong = Color(hex: 0xB45309)

    /// Selection: the chosen filter pill, a pinned row's edge, a link.
    static let neonAccent = Color.neonIndigo

    // Meaning. "Strong" is the one to put text and glyphs in; the plain one
    // is for fills, dots and bars.
    static let neonSuccess = Color(hex: 0x10B981)
    static let neonSuccessStrong = Color(hex: 0x04855A)
    static let neonDanger = Color(hex: 0xEF4444)
    static let neonDangerStrong = Color(hex: 0xB91C1C)
    static let neonWarning = Color.neonOrange
    static let neonWarningStrong = Color.neonOrangeStrong
    static let neonInfo = Color.neonCyan
    static let neonInfoStrong = Color.neonCyanStrong

    // Text, from loudest to quietest: cool slate greys, as in the mockups.
    static let neonText = Color.neonInk
    static let neonTextSecondary = Color(hex: 0x5D6477)
    static let neonTextTertiary = Color(hex: 0x8A91A3)
    static let neonTextFaint = Color(hex: 0xB9BFCC)

    // Surfaces and lines.
    static let neonSurface = Color.white.opacity(0.9)
    static let neonSurfaceStrong = Color.white.opacity(0.97)
    static let neonSurfaceSunken = Color.neonInk.opacity(0.045)
    static let neonLine = Color.neonInk.opacity(0.08)
    static let neonLineStrong = Color.neonInk.opacity(0.14)
    /// Every shadow's colour: a cool navy, so lifted cards read as a soft haze.
    static let neonShadowTint = Color(hex: 0x28377A)
}

/// The colour families of the mockups. Each gives the vivid colour (bars,
/// dots, filled tiles), a deeper one (glyphs on the pastel, text), the pastel
/// behind a glyph, a lighter wash for a whole tile, and a two-stop gradient.
///
///     IconTile("folder.fill", hue: .blue)
///     KPICard(L("Total Projects"), value: 4, symbol: "folder.fill", hue: .blue)
enum NeonHue: CaseIterable, Hashable {
    case blue, indigo, purple, pink, orange, amber, green, cyan, red, grey

    var color: Color {
        switch self {
        case .blue: return .neonBlue
        case .indigo: return .neonIndigo
        case .purple: return .neonPurple
        case .pink: return .neonPink
        case .orange: return .neonOrange
        case .amber: return .neonAmber
        case .green: return .neonSuccess
        case .cyan: return .neonCyan
        case .red: return .neonDanger
        case .grey: return Color(hex: 0xA3ABBD)
        }
    }

    var deep: Color {
        switch self {
        case .blue: return Color(hex: 0x1877D8)
        case .indigo: return Color(hex: 0x3F3CD8)
        case .purple: return Color(hex: 0x7C3AED)
        case .pink: return Color(hex: 0xDB2777)
        case .orange: return Color(hex: 0xEA580C)
        case .amber: return Color(hex: 0xD97706)
        case .green: return Color(hex: 0x059669)
        case .cyan: return Color(hex: 0x0891B2)
        case .red: return Color(hex: 0xDC2626)
        case .grey: return Color(hex: 0x5D6477)
        }
    }

    var pastel: Color {
        switch self {
        case .blue: return Color(hex: 0xD8ECFE)
        case .indigo: return Color(hex: 0xE1E2FE)
        case .purple: return Color(hex: 0xEBE1FE)
        case .pink: return Color(hex: 0xFDDFEC)
        case .orange: return Color(hex: 0xFFE5D4)
        case .amber: return Color(hex: 0xFEF0C8)
        case .green: return Color(hex: 0xD4F5E6)
        case .cyan: return Color(hex: 0xD3F3FA)
        case .red: return Color(hex: 0xFEE0E0)
        case .grey: return Color(hex: 0xE9ECF3)
        }
    }

    var wash: Color {
        switch self {
        case .blue: return Color(hex: 0xEAF3FF)
        case .indigo: return Color(hex: 0xEEEFFF)
        case .purple: return Color(hex: 0xF2ECFF)
        case .pink: return Color(hex: 0xFFEDF5)
        case .orange: return Color(hex: 0xFFF0E8)
        case .amber: return Color(hex: 0xFFF7E3)
        case .green: return Color(hex: 0xE7FAF1)
        case .cyan: return Color(hex: 0xE8F9FC)
        case .red: return Color(hex: 0xFFEFEF)
        case .grey: return Color(hex: 0xF0F2F7)
        }
    }

    /// Light, then vivid. Bars run it top to bottom; filled tiles corner to corner.
    var gradient: [Color] {
        switch self {
        case .blue: return [Color(hex: 0x86BDFF), Color(hex: 0x2F86F6)]
        case .indigo: return [Color(hex: 0x8A8FFF), Color(hex: 0x4447EE)]
        case .purple: return [Color(hex: 0xBDA2FC), Color(hex: 0x8B5CF6)]
        case .pink: return [Color(hex: 0xF9A8D4), Color(hex: 0xEC4899)]
        case .orange: return [Color(hex: 0xFDBA8C), Color(hex: 0xF97316)]
        case .amber: return [Color(hex: 0xFCD34D), Color(hex: 0xF59E0B)]
        case .green: return [Color(hex: 0x5EE0A8), Color(hex: 0x12B886)]
        case .cyan: return [Color(hex: 0x67E8F9), Color(hex: 0x06B6D4)]
        case .red: return [Color(hex: 0xFCA5A5), Color(hex: 0xEF4444)]
        case .grey: return [Color(hex: 0xDDE1EA), Color(hex: 0xC3C9D6)]
        }
    }

    /// The filled tile's fill, and a progress segment's.
    var fill: LinearGradient {
        LinearGradient(colors: [gradient[0], color], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    /// The hue a kit colour belongs to, so the components that take a plain
    /// `Color` can still draw the pastel tile and the vivid glyph for it.
    init?(_ color: Color) {
        let families: [(NeonHue, [Color])] = [
            (.blue, [.neonBlue, .neonBlueStrong]),
            (.indigo, [.neonIndigo, .neonIndigoStrong]),
            (.purple, [.neonPurple, .neonPurpleStrong]),
            (.pink, [.neonPink, .neonPinkStrong]),
            (.orange, [.neonOrange, .neonOrangeStrong]),
            (.amber, [.neonAmber, .neonAmberStrong]),
            (.green, [.neonSuccess, .neonSuccessStrong]),
            (.cyan, [.neonCyan, .neonCyanStrong]),
            (.red, [.neonDanger, .neonDangerStrong]),
        ]
        guard let match = families.first(where: { $0.1.contains(color) }) else { return nil }
        self = match.0
    }
}

/// The colours a chart or a list of categories cycles through, in order.
enum NeonPalette {
    static let series: [Color] = [
        .neonBlue, .neonPurple, .neonSuccess, .neonOrange,
        .neonPink, .neonCyan, .neonIndigo, .neonAmber,
    ]

    static func color(at index: Int) -> Color {
        series[((index % series.count) + series.count) % series.count]
    }

    static let hues: [NeonHue] = [.blue, .purple, .green, .orange, .pink, .cyan, .indigo, .amber]

    static func hue(at index: Int) -> NeonHue {
        hues[((index % hues.count) + hues.count) % hues.count]
    }

    /// A stable colour for a name, so a person keeps theirs across screens and
    /// launches (`hashValue` is re-seeded every launch, so it is not used).
    static func color(for name: String) -> Color {
        accents[seed(name) % accents.count]
    }

    /// The same, as a hue: an avatar's solid fill.
    static func hue(for name: String) -> NeonHue {
        avatarHues[seed(name) % avatarHues.count]
    }

    static let accents: [Color] = [.neonPurpleStrong, .neonCyanStrong, .neonPinkStrong, .neonOrangeStrong, .neonSuccessStrong]
    private static let avatarHues: [NeonHue] = [.purple, .cyan, .pink, .orange, .green]

    private static func seed(_ name: String) -> Int {
        name.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0x7FFF_FFFF }
    }
}

extension LinearGradient {
    static let neonWordmark = LinearGradient(
        colors: [.neonCyanStrong, .neonPurple, .neonPink],
        startPoint: .leading,
        endPoint: .trailing
    )

    static let neonAmbient = LinearGradient(
        colors: [.neonBlue.opacity(0.14), .neonPurple.opacity(0.14), .neonPink.opacity(0.08)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// The brand's accent fill: the hero card, the brand button, rings.
    /// Sky blue through indigo to violet, as on the Home hero.
    static let neonBrand = LinearGradient(
        colors: [Color(hex: 0x3AA3F5), Color(hex: 0x5B78F4), Color(hex: 0x8A5CF6)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Selection and the primary button: a solid-looking indigo blue.
    static let neonAccent = LinearGradient(
        colors: [Color(hex: 0x5058F7), Color(hex: 0x3F3AE6)],
        startPoint: .top,
        endPoint: .bottom
    )

    /// The floating action button: indigo into violet.
    static let neonAction = LinearGradient(
        colors: [Color(hex: 0x4F46E5), Color(hex: 0x7C3AED)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// The page, top to bottom: lavender into a cool white.
    static let neonPage = LinearGradient(
        colors: [Color.neonBgSoft, Color(hex: 0xF1F3FC), Color.neonBg, Color(hex: 0xF6F7FC)],
        startPoint: .top,
        endPoint: .bottom
    )

    /// Dark hero cards.
    static let neonInkHero = LinearGradient(
        colors: [Color(hex: 0x14172B), Color(hex: 0x2C2A55)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// A card: near-opaque white, a touch brighter at the top.
    static let neonGlass = LinearGradient(
        colors: [.white.opacity(0.94), .white.opacity(0.86)],
        startPoint: .top,
        endPoint: .bottom
    )

    /// `.glass-strong`.
    static let neonGlassStrong = LinearGradient(
        colors: [.white.opacity(0.99), .white.opacity(0.93)],
        startPoint: .top,
        endPoint: .bottom
    )

    /// A card's hairline: lit at the top, a cool line at the bottom.
    static let neonGlassEdge = LinearGradient(
        colors: [.white.opacity(0.9), Color.neonShadowTint.opacity(0.12)],
        startPoint: .top,
        endPoint: .bottom
    )

    static func neonTint(_ color: Color) -> LinearGradient {
        LinearGradient(colors: [color.opacity(0.78), color], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

extension AngularGradient {
    /// An unseen story's ring: the brand's colours all the way round.
    static let neonStory = AngularGradient(
        colors: [.neonBlue, .neonIndigo, .neonPurple, .neonPink, .neonOrange, .neonBlue],
        center: .center
    )
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
                .neonShadow(.card)
        case .strong:
            shape.fill(LinearGradient.neonGlassStrong)
                .neonShadow(.raised)
        case .solid:
            shape.fill(Color.white)
                .neonShadow(.low)
        case .sunken:
            shape.fill(Color.neonSurfaceSunken)
        case .outline:
            shape.fill(Color.clear)
        case .tinted(let color):
            shape.fill(NeonHue(color)?.wash ?? color.opacity(0.10))
        case .ink:
            shape.fill(LinearGradient.neonInkHero)
                .shadow(color: .neonShadowTint.opacity(0.3), radius: 22, x: 0, y: 12)
        case .brand:
            shape.fill(LinearGradient.neonBrand)
                .shadow(color: .neonIndigo.opacity(0.3), radius: 22, x: 0, y: 12)
        case .frosted:
            shape.fill(.ultraThinMaterial)
                .shadow(color: .black.opacity(0.12), radius: 14, x: 0, y: 6)
        }
    }

    @ViewBuilder
    private func border(_ shape: RoundedRectangle) -> some View {
        switch surface {
        case .glass, .strong, .solid:
            shape.strokeBorder(LinearGradient.neonGlassEdge, lineWidth: 1)
        case .sunken:
            shape.strokeBorder(Color.neonInk.opacity(0.04), lineWidth: 1)
        case .outline:
            shape.strokeBorder(Color.neonLineStrong, lineWidth: 1)
        case .tinted(let color):
            shape.strokeBorder(color.opacity(0.16), lineWidth: 1)
        case .ink, .brand, .frosted:
            shape.strokeBorder(Color.white.opacity(0.16), lineWidth: 1)
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

/// The page behind every screen: lavender at the top fading into a cool
/// white, with two soft glows (sky and violet) under the header.
struct NeonAmbient: View {
    var animated = false
    @State private var drift = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let moving = animated && drift && !reduceMotion
        GeometryReader { proxy in
            let width = proxy.size.width
            ZStack(alignment: .top) {
                LinearGradient.neonPage
                Circle()
                    .fill(Color(hex: 0xBFD8FF).opacity(0.55))
                    .frame(width: width * 0.9, height: width * 0.9)
                    .blur(radius: 80)
                    .offset(x: -width * (moving ? 0.28 : 0.38), y: -width * (moving ? 0.28 : 0.4))
                Circle()
                    .fill(Color(hex: 0xD6CCFF).opacity(0.6))
                    .frame(width: width * 0.9, height: width * 0.9)
                    .blur(radius: 80)
                    .offset(x: width * (moving ? 0.26 : 0.36), y: -width * (moving ? 0.22 : 0.32))
                Circle()
                    .fill(Color(hex: 0xE3E8FF).opacity(0.7))
                    .frame(width: width, height: width)
                    .blur(radius: 90)
                    .offset(y: proxy.size.height * 0.62)
            }
            .frame(width: width, height: proxy.size.height, alignment: .top)
            .clipped()
        }
        .onAppear {
            guard animated, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 9).repeatForever(autoreverses: true)) { drift = true }
        }
    }
}

// MARK: - Badges

enum BadgeTone {
    case cyan, purple, pink, orange, neutral, success, warning, danger, info, blue

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
        case .blue: return .neonBlue.opacity(0.13)
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
        case .blue: return .neonBlueStrong
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
        case .blue: return .neonBlue
        }
    }

    var hue: NeonHue {
        switch self {
        case .cyan, .info: return .cyan
        case .purple: return .purple
        case .pink: return .pink
        case .orange, .warning: return .orange
        case .neutral: return .grey
        case .success: return .green
        case .danger: return .red
        case .blue: return .blue
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
