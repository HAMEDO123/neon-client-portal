#if targetEnvironment(macCatalyst)
import Foundation
import SwiftUI

/// Local backend (dashboard.py) — the "hands" that talk to Meta. The app and widget only read/write through it.
enum Backend {
    static let base = URL(string: "http://127.0.0.1:8793")!
}

/// A number that Meta sometimes sends as a string ("5.97"), a number, or null.
struct Flex: Codable, Hashable {
    let v: Double?
    init(_ v: Double?) { self.v = v }
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { v = nil }
        else if let d = try? c.decode(Double.self) { v = d }
        else if let s = try? c.decode(String.self) { v = Double(s) }
        else if let b = try? c.decode(Bool.self) { v = b ? 1 : 0 }
        else { v = nil }
    }
    func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); try c.encode(v) }
}

extension Optional where Wrapped == Flex {
    var d: Double { self?.v ?? 0 }
    var opt: Double? { self?.v }
}

// MARK: - Widget summary (/api/widget)

struct WidgetToday: Codable, Hashable { var spend: Double; var conv: Int }

struct Scenario: Codable, Hashable, Identifiable {
    var key: String
    var label: String
    var daily: Double
    var extra_spend: Double
    var conv: Int
    var delta: Int
    var note: String
    var id: String { key }
}

/// Live advice from advisor.py (rules from Claude's analysis applied to live Meta numbers)
struct Advice: Codable, Hashable {
    var action: String
    var title: String
    var reasons: [String]
    var cp: Double? = nil
    var basis: String? = nil
    var good: Double? = nil
    var bad: Double? = nil
    var budget: Double? = nil
    var days_left: Double? = nil
    var hours_running: Double? = nil
    var learning: Bool? = nil
    var scenarios: [Scenario] = []
    var updated: String? = nil

    var color: Color {
        switch action {
        case "raise": return Brand.accent
        case "pause": return Brand.bad
        case "lower": return Brand.warn
        case "hold", "wait": return Brand.ok
        default: return Brand.gray
        }
    }
    var icon: String {
        switch action {
        case "raise": return "arrow.up.circle.fill"
        case "pause": return "pause.circle.fill"
        case "lower": return "arrow.down.circle.fill"
        case "wait": return "hourglass.circle.fill"
        default: return "checkmark.circle.fill"
        }
    }
}

/// neon://ads?c=<campaign>&a=<raise|lower|pause|resume|hold> — opens NEON on the confirmation sheet.
func actionURL(_ campaign: String, _ action: String) -> URL {
    URL(string: "neon://ads?c=\(campaign)&a=\(action)")!
}

struct WidgetCampaign: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var spend: Double
    var conv: Int
    var cpconv: Double?
    var reach: Int
    var end: String?
    var verdict: String?
    var verdict_label: String?
    var review: String?
    // the same ad (Page post) across every campaign that ever ran it — today and since day one
    var ad_conv_total: Int? = nil
    var ad_conv_today: Int? = nil
    var ad_spend_total: Double? = nil
    var ad_spend_today: Double? = nil
    var ad_cpconv: Double? = nil
    var advice: Advice? = nil
}

struct WidgetData: Codable, Hashable {
    var ok: Bool
    var error: String? = nil
    var updated: String? = nil
    var today: WidgetToday? = nil
    var campaigns: [WidgetCampaign]? = nil

    static let placeholder = WidgetData(ok: true, error: nil, updated: "12:00",
        today: WidgetToday(spend: 5.11, conv: 3),
        campaigns: [WidgetCampaign(id: "1", name: "صمّم مساحتك · واتساب", spend: 11.06, conv: 6, cpconv: 1.84,
                                   reach: 1946, end: "2026-11-27", verdict: "continue",
                                   verdict_label: "كمّلها", review: "2026-11-24",
                                   ad_conv_total: 6, ad_conv_today: 3, ad_spend_total: 11.17, ad_spend_today: 5.17, ad_cpconv: 1.86)])
}

// MARK: - Shared look

enum Brand {
    // Directive V2 palette (light-first)
    static let bg = Color(red: 0xF7/255, green: 0xF8/255, blue: 0xFC/255)
    static let card = Color.white
    static let surface = Color(red: 0xEE/255, green: 0xF2/255, blue: 0xF8/255)
    static let text = Color(red: 0x17/255, green: 0x20/255, blue: 0x33/255)
    static let text2 = Color(red: 0x66/255, green: 0x70/255, blue: 0x85/255)
    static let ink = text
    static let accent = Color(red: 0x25/255, green: 0x63/255, blue: 0xEB/255)
    static let accent2 = Color(red: 0x7C/255, green: 0x3A/255, blue: 0xED/255)
    static let ok = Color(red: 0x05/255, green: 0x96/255, blue: 0x69/255)
    static let warn = Color(red: 0xD9/255, green: 0x77/255, blue: 0x06/255)
    static let bad = Color(red: 0xDC/255, green: 0x26/255, blue: 0x26/255)
    static let gray = text2

    static func verdictColor(_ v: String?) -> Color {
        switch v {
        case "continue": return ok
        case "scale": return accent
        case "pause": return bad
        case "fix": return warn
        default: return gray
        }
    }

    /// cost per conversation: ≤2.5 good, ≥4 bad
    static func cpColor(_ v: Double?) -> Color {
        guard let v else { return .secondary }
        return v <= 2.5 ? ok : v >= 4 ? bad : warn
    }
}

func usd(_ v: Double?) -> String {
    guard let v else { return "—" }
    return String(format: "$%.2f", v)
}

func num(_ v: Double?) -> String {
    guard let v else { return "—" }
    let f = NumberFormatter(); f.numberStyle = .decimal; f.locale = Locale(identifier: "en_US")
    return f.string(from: NSNumber(value: v)) ?? "\(Int(v))"
}

#endif
