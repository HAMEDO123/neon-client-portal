import SwiftUI

// In-app language switching (English/Arabic with RTL). The choice lives in
// UserDefaults so it survives restarts and can differ from the phone's
// language; the root view rebuilds on change so it applies instantly.
enum AppLanguage: String {
    case english = "en"
    case arabic = "ar"

    static let storageKey = "app_language"

    static var current: AppLanguage {
        if let raw = UserDefaults.standard.string(forKey: storageKey),
           let lang = AppLanguage(rawValue: raw) {
            return lang
        }
        // First launch: follow the phone's language.
        return Locale.preferredLanguages.first?.hasPrefix("ar") == true ? .arabic : .english
    }

    static func toggle() {
        UserDefaults.standard.set(
            (current == .arabic ? AppLanguage.english : .arabic).rawValue,
            forKey: storageKey
        )
    }

    var layoutDirection: LayoutDirection { self == .arabic ? .rightToLeft : .leftToRight }
    var locale: Locale { Locale(identifier: rawValue) }

    // Label shown on the toggle button — names the language you'd switch TO.
    var toggleLabel: String { self == .arabic ? "EN" : "عربي" }
}

private let arabicBundle: Bundle? = Bundle.main
    .path(forResource: "ar", ofType: "lproj")
    .flatMap(Bundle.init(path:))

// English strings are the keys themselves, so only ar.lproj ships a table.
func L(_ key: String) -> String {
    guard AppLanguage.current == .arabic, let arabicBundle else { return key }
    return arabicBundle.localizedString(forKey: key, value: key, table: nil)
}

func L(_ key: String, _ args: CVarArg...) -> String {
    String(format: L(key), arguments: args)
}

// Server enum values (PIPELINE_STATUS etc.) → translated label, falling back
// to the humanized English form ("SENT_TO_CLIENT" → "Sent To Client").
func localizedEnum(_ prefix: String, _ raw: String) -> String {
    let key = "\(prefix).\(raw)"
    let translated = L(key)
    return translated == key
        ? raw.replacingOccurrences(of: "_", with: " ").capitalized
        : translated
}
