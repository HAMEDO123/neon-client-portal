import SwiftUI

// The share extension's language.
//
// The app's English/Arabic switch is kept in the app's own UserDefaults, which
// an extension cannot read (that would take an App Group), so here the phone's
// language decides. Every string comes from this extension's own table,
// ar.lproj/Share.strings (and Share.stringsdict for counts).
//
// Named as the app names them because the kit files compiled into the
// extension as well (Tokens, DesignSystem, Formatting) call `AppLanguage` and
// `L`; anything new they use from the app's Localization.swift belongs here too.

enum AppLanguage: String {
    case english = "en"
    case arabic = "ar"

    static var current: AppLanguage {
        Locale.preferredLanguages.first?.hasPrefix("ar") == true ? .arabic : .english
    }

    var layoutDirection: LayoutDirection { self == .arabic ? .rightToLeft : .leftToRight }
    var locale: Locale { Locale(identifier: rawValue) }
}

private let arabicBundle: Bundle? = Bundle.main
    .path(forResource: "ar", ofType: "lproj")
    .flatMap(Bundle.init(path:))

/// English strings are the keys themselves, so only ar.lproj ships a table.
func L(_ key: String) -> String {
    guard AppLanguage.current == .arabic, let arabicBundle else { return key }
    return arabicBundle.localizedString(forKey: key, value: key, table: "Share")
}

func L(_ key: String, _ args: CVarArg...) -> String {
    String(format: L(key), arguments: args)
}

/// A count with its noun, from Share.stringsdict: Arabic has a form for one,
/// two, a few and many. Formatted with the language's locale, which is what
/// makes a stringsdict pick by Arabic rules rather than English ones.
func shareCount(_ key: String, _ n: Int) -> String {
    String(format: L(key), locale: AppLanguage.current.locale, n)
}

extension String {
    /// Folded for searching, as the app's search does: no case, no tashkeel,
    /// one alef, yaa for alef maqsura, haa for taa marbuta, Western digits.
    var shareSearchFolded: String {
        let folded = folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil)
        var out = String.UnicodeScalarView()
        for scalar in folded.unicodeScalars {
            switch scalar.value {
            case 0x0622, 0x0623, 0x0625, 0x0671: out.append(UnicodeScalar(0x0627)!)
            case 0x0649: out.append(UnicodeScalar(0x064A)!)
            case 0x0629: out.append(UnicodeScalar(0x0647)!)
            case 0x0640: continue
            case 0x064B...0x065F, 0x0670: continue
            case 0x0660...0x0669: out.append(UnicodeScalar(scalar.value - 0x0660 + 48)!)
            case 0x06F0...0x06F9: out.append(UnicodeScalar(scalar.value - 0x06F0 + 48)!)
            default: out.append(scalar)
            }
        }
        return String(out)
    }

    /// Whether every word of `query` is somewhere in this text.
    func shareMatches(_ query: String) -> Bool {
        let words = query.shareSearchFolded.split(whereSeparator: { $0.isWhitespace })
        guard !words.isEmpty else { return true }
        let haystack = shareSearchFolded
        return words.allSatisfy { haystack.contains($0) }
    }
}

/// The direction a piece of text reads in, from its first strong letter — a
/// name or a caption is laid out by what it says, not by the phone's language.
func shareTextDirection(_ text: String) -> LayoutDirection? {
    for scalar in text.unicodeScalars {
        switch scalar.value {
        case 0x0590...0x08FF, 0xFB1D...0xFDFF, 0xFE70...0xFEFF:
            return .rightToLeft
        default:
            if scalar.properties.isAlphabetic { return .leftToRight }
        }
    }
    return nil
}
