import SwiftUI
import UIKit

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
}

// Matches .glass in globals.css: translucent gradient fill, hairline border,
// soft long shadow, background blur.
struct GlassCard: ViewModifier {
    var radius: CGFloat = 20

    func body(content: Content) -> some View {
        content
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(Color.neonInk.opacity(0.08), lineWidth: 1)
            )
            .shadow(color: Color.neonInk.opacity(0.10), radius: 20, x: 0, y: 10)
    }
}

extension View {
    func glassCard(radius: CGFloat = 20) -> some View {
        modifier(GlassCard(radius: radius))
    }

    // Soft blurred brand-colored blobs behind content, for the same ambient
    // depth the web app gets from its grid-overlay + glass layering.
    func neonAmbientBackground() -> some View {
        background(
            ZStack {
                Color.neonBg.ignoresSafeArea()
                Circle()
                    .fill(Color.neonPurple.opacity(0.16))
                    .frame(width: 280, height: 280)
                    .blur(radius: 70)
                    .offset(x: -120, y: -220)
                Circle()
                    .fill(Color.neonCyan.opacity(0.14))
                    .frame(width: 260, height: 260)
                    .blur(radius: 70)
                    .offset(x: 140, y: 260)
            }
            .ignoresSafeArea()
        )
    }
}

enum BadgeTone {
    case cyan, purple, pink, orange, neutral, success, warning

    var background: Color {
        switch self {
        case .cyan: return .neonCyan.opacity(0.12)
        case .purple: return .neonPurple.opacity(0.12)
        case .pink: return .neonPink.opacity(0.12)
        case .orange: return .neonOrange.opacity(0.12)
        case .neutral: return .neonInk.opacity(0.06)
        case .success: return Color.green.opacity(0.12)
        case .warning: return Color.orange.opacity(0.15)
        }
    }

    var foreground: Color {
        switch self {
        case .cyan: return .neonCyanStrong
        case .purple: return .neonPurpleStrong
        case .pink: return .neonPinkStrong
        case .orange: return .neonOrangeStrong
        case .neutral: return .neonInk.opacity(0.7)
        case .success: return Color.green
        case .warning: return Color.orange
        }
    }
}

struct BadgeView: View {
    let text: String
    let tone: BadgeTone

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.4)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
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
    static var pressable: PressableStyle { PressableStyle() }
}

enum Haptic {
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
}
