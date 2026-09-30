import Foundation

// The same small pure rules src/lib/calls.ts states for the web, ported so
// this device's WebRTC session behaves identically to a browser's: who
// offers first, who yields when both renegotiate at once, and how a
// connection's numbers turn into "good/fair/poor".

/// Of two devices in a call, the one that makes the first offer: whoever
/// joined later calls those already there, and a tie goes to the larger key.
func callInitiates(mine: (key: String, joinedAt: Date), other: (key: String, joinedAt: Date)) -> Bool {
    if mine.joinedAt == other.joinedAt { return mine.key > other.key }
    return mine.joinedAt > other.joinedAt
}

/// "Perfect negotiation": the polite side yields its own offer when both
/// renegotiate at once.
func callIsPolite(me: String, other: String) -> Bool { me < other }

enum CallQuality: String {
    case good, fair, poor, unknown
}

struct CallStatsSample {
    var rttMs: Double?
    var lossRatio: Double?
    var jitterMs: Double?
}

func callQualityOf(_ sample: CallStatsSample) -> CallQuality {
    if sample.rttMs == nil, sample.lossRatio == nil, sample.jitterMs == nil { return .unknown }
    if (sample.rttMs ?? 0) > 400 || (sample.lossRatio ?? 0) > 0.08 || (sample.jitterMs ?? 0) > 60 { return .poor }
    if (sample.rttMs ?? 0) > 200 || (sample.lossRatio ?? 0) > 0.03 || (sample.jitterMs ?? 0) > 30 { return .fair }
    return .good
}

/// Loud enough to count as speaking, with a lower bar to stop: a word's
/// quiet end does not flicker the ring.
func callIsSpeaking(level: Double, wasSpeaking: Bool) -> Bool {
    wasSpeaking ? level > 0.02 : level > 0.045
}

/// Columns and rows for a grid of people, matching gridFor in lib/calls.ts.
func callGridFor(count: Int, narrow: Bool) -> (columns: Int, rows: Int) {
    if count <= 1 { return (1, 1) }
    if count == 2 { return narrow ? (1, 2) : (2, 1) }
    if count <= 4 { return (2, 2) }
    if count <= 6 { return narrow ? (2, 3) : (3, 2) }
    if count <= 9 { return (3, 3) }
    let columns = narrow ? 3 : 4
    return (columns, Int(ceil(Double(count) / Double(columns))))
}

/// "0:45", "4:32", "1:02:05" — in the app's own digits ("٤:٣٢" in Arabic),
/// the same set NeonFormat gives the people count beside it, so one bar never
/// mixes two kinds of numerals.
func callDurationText(_ seconds: Int) -> String {
    let total = max(0, seconds)
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let rest = callDigits(total % 60, width: 2)
    if hours > 0 { return "\(callDigits(hours)):\(callDigits(minutes, width: 2)):\(rest)" }
    return "\(callDigits(minutes)):\(rest)"
}

private func callDigits(_ value: Int, width: Int = 1) -> String {
    let formatter = NumberFormatter()
    formatter.locale = AppLanguage.current.locale
    formatter.numberStyle = .none
    formatter.usesGroupingSeparator = false
    formatter.minimumIntegerDigits = width
    return formatter.string(from: NSNumber(value: value)) ?? String(value)
}
