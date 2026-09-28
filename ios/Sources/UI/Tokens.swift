import SwiftUI
import UIKit

// The kit's scales. Screens use these names instead of loose numbers, so the
// whole app keeps one rhythm and one change moves every screen together.

// MARK: - Spacing, radii, sizes

enum NeonSpace {
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 20
    static let xxl: CGFloat = 24
    static let xxxl: CGFloat = 32
    static let huge: CGFloat = 48
    /// The screen's side margin.
    static let gutter: CGFloat = 16
    /// Between the blocks of a screen.
    static let section: CGFloat = 22
}

enum NeonRadius {
    static let xs: CGFloat = 8
    static let sm: CGFloat = 12
    static let md: CGFloat = 16
    /// Cards.
    static let lg: CGFloat = 20
    static let xl: CGFloat = 24
    /// Heroes and sheets.
    static let xxl: CGFloat = 30
}

enum NeonSize {
    /// The smallest thing a finger should have to hit.
    static let touch: CGFloat = 44
    /// Text fields, pickers.
    static let field: CGFloat = 50
    static let iconTile: CGFloat = 38
    static let avatar: CGFloat = 44
}

// MARK: - Type

// Rounded display faces for headings and numbers, the system text face for
// reading. Built on text styles, so Dynamic Type scales all of it.
extension Font {
    static let neonLargeTitle = Font.system(.largeTitle, design: .rounded, weight: .bold)
    static let neonTitle = Font.system(.title, design: .rounded, weight: .bold)
    static let neonTitle2 = Font.system(.title2, design: .rounded, weight: .bold)
    static let neonTitle3 = Font.system(.title3, design: .rounded, weight: .semibold)
    static let neonHeadline = Font.system(.headline)
    static let neonBody = Font.system(.body)
    static let neonCallout = Font.system(.callout)
    static let neonSubheadline = Font.system(.subheadline)
    static let neonFootnote = Font.system(.footnote)
    static let neonCaption = Font.system(.caption, weight: .medium)
    /// Uppercase labels above sections — pair with `.tracking(0.6)`.
    static let neonOverline = Font.system(.caption2, weight: .semibold)
    /// Big figures: stat tiles, totals.
    static let neonNumber = Font.system(.title, design: .rounded, weight: .bold).monospacedDigit()
    static let neonNumberSmall = Font.system(.title3, design: .rounded, weight: .bold).monospacedDigit()
}

// MARK: - Elevation

enum NeonElevation {
    case none, low, card, raised, floating
    case glow(Color)

    fileprivate var shadow: (color: Color, radius: CGFloat, y: CGFloat) {
        switch self {
        case .none: return (.clear, 0, 0)
        case .low: return (.neonInk.opacity(0.06), 6, 2)
        case .card: return (.neonInk.opacity(0.08), 16, 8)
        case .raised: return (.neonInk.opacity(0.12), 24, 12)
        case .floating: return (.neonInk.opacity(0.18), 30, 16)
        case .glow(let color): return (color.opacity(0.38), 18, 8)
        }
    }
}

extension View {
    func neonShadow(_ elevation: NeonElevation = .card) -> some View {
        let shadow = elevation.shadow
        return self.shadow(color: shadow.color, radius: shadow.radius, x: 0, y: shadow.y)
    }
}

// MARK: - Motion

/// The kit's animation curves. Everything that moves uses one of these, so the
/// app has one feel; `withNeonAnimation` and the modifiers in Motion.swift
/// swap them for a plain fade when Reduce Motion is on.
enum NeonMotion {
    /// Selections, toggles, small state changes.
    static let snappy = Animation.spring(response: 0.3, dampingFraction: 0.82)
    /// Things arriving: a toast, a floating button, a badge.
    static let bouncy = Animation.spring(response: 0.42, dampingFraction: 0.66)
    /// Larger layout changes, content appearing.
    static let smooth = Animation.spring(response: 0.55, dampingFraction: 0.9)
    static let gentle = Animation.easeInOut(duration: 0.35)
    static let quick = Animation.easeOut(duration: 0.16)
    /// Numbers counting up, rings and bars filling.
    static let fill = Animation.spring(response: 0.9, dampingFraction: 0.88)

    /// The delay for the n-th item of a list appearing, capped so a long list
    /// doesn't make anyone wait for its tenth row.
    static func stagger(_ index: Int, step: Double = 0.045, cap: Int = 10) -> Double {
        Double(min(max(index, 0), cap)) * step
    }

    static var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }

    /// The animation to actually run: the one asked for, or a short fade.
    static func resolved(_ animation: Animation) -> Animation {
        reduceMotion ? .easeOut(duration: 0.18) : animation
    }
}

/// `withAnimation`, honouring Reduce Motion.
@discardableResult
func withNeonAnimation<Result>(_ animation: Animation = NeonMotion.snappy, _ body: () throws -> Result) rethrows -> Result {
    try withAnimation(NeonMotion.resolved(animation), body)
}

extension AnyTransition {
    /// Scales up a touch while fading in: badges, buttons, popovers.
    static var neonPop: AnyTransition { .scale(scale: 0.9).combined(with: .opacity) }
    /// Rises a little while fading in: rows, messages, banners.
    static var neonRise: AnyTransition { .offset(y: 10).combined(with: .opacity) }
    /// From the bottom edge: bars and trays.
    static var neonSlideUp: AnyTransition { .move(edge: .bottom).combined(with: .opacity) }
    /// From the top edge: toasts and notices.
    static var neonDrop: AnyTransition { .move(edge: .top).combined(with: .opacity) }
}

// MARK: - Numbers

/// Numbers, money and days, in the app's language (not the phone's).
enum NeonFormat {
    private static func formatter(_ style: NumberFormatter.Style, decimals: Int) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.locale = AppLanguage.current.locale
        formatter.numberStyle = style
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = decimals
        return formatter
    }

    static func number(_ value: Double, decimals: Int = 0) -> String {
        formatter(.decimal, decimals: decimals).string(from: NSNumber(value: value)) ?? String(value)
    }

    static func integer(_ value: Int) -> String {
        number(Double(value))
    }

    /// "JOD 1,250" — the web's `formatCurrency` — or "١٬٢٥٠ د.أ." in Arabic.
    static func money(_ value: Double, decimals: Int = 0, currency: String = "JOD") -> String {
        let formatter = formatter(.currency, decimals: decimals)
        formatter.currencyCode = currency
        formatter.minimumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? "\(currency) \(value)"
    }

    /// `value` is 0…100.
    static func percent(_ value: Double, decimals: Int = 0) -> String {
        let formatter = formatter(.percent, decimals: decimals)
        return formatter.string(from: NSNumber(value: value / 100)) ?? "\(Int(value))%"
    }

    /// 1.2K, 3.4M — for axis labels and tight tiles.
    static func compact(_ value: Double) -> String {
        let magnitude = abs(value)
        if magnitude >= 1_000_000 { return number(value / 1_000_000, decimals: 1) + "M" }
        if magnitude >= 10_000 { return number(value / 1_000, decimals: 0) + "K" }
        if magnitude >= 1_000 { return number(value / 1_000, decimals: 1) + "K" }
        return number(value, decimals: magnitude < 10 ? 1 : 0)
    }

    /// What somebody typed, in either digit set, as a number: "١٢٫٥", "1,250.5".
    static func parse(_ text: String) -> Double? {
        var ascii = ""
        for scalar in text.unicodeScalars {
            switch scalar.value {
            case 0x0660...0x0669: ascii.append(Character(UnicodeScalar(scalar.value - 0x0660 + 48)!))
            case 0x06F0...0x06F9: ascii.append(Character(UnicodeScalar(scalar.value - 0x06F0 + 48)!))
            case 0x066B: ascii.append(".") // Arabic decimal separator
            case 0x066C, 0x2C: continue // Arabic and Latin thousands separators
            default:
                if scalar.properties.isWhitespace { continue }
                ascii.unicodeScalars.append(scalar)
            }
        }
        return ascii.isEmpty ? nil : Double(ascii)
    }

    /// The studio's day key, "YYYY-MM-DD", for a date picked on this phone.
    static func dayKey(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// The local midnight of a day key, for a date picker to start on.
    static func date(fromDayKey key: String, calendar: Calendar = .current) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}
