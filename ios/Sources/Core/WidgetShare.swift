import Foundation
import Security
#if canImport(WidgetKit)
import WidgetKit
#endif

// What the widgets need to know that only the app knows: which side the
// signed-in person is on (the manager's widgets and the team's read different
// things) and the language the app is in (the app chooses its own, so the
// system's is not it). Compiled into the app and the widget extension.
//
// Kept in the Keychain beside the session token, in the same shared group
// (TokenStore.swift) — the one store the app and its extensions already
// share without an App Group to register. The token itself stays in
// TokenStore; the widget reads it from there.

struct WidgetContext: Codable, Equatable {
    /// "admin" or "employee", as the server's `side`.
    var side: String
    /// "ar" or "en".
    var language: String
}

enum WidgetShare {
    private static let service = "com.neonjo.staff"
    private static let account = "widget_context"

    private static let group: String? = {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "NeonKeychainGroup") as? String,
              !group.hasPrefix("."), !group.contains("$(")
        else { return nil }
        return group
    }()

    private static func query() -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group { query[kSecAttrAccessGroup as String] = group }
        return query
    }

    static func read() -> WidgetContext? {
        var query = query()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return try? JSONDecoder().decode(WidgetContext.self, from: data)
    }

    /// Saved by the app whenever who is signed in or the language changes;
    /// nil when signed out. The widgets are asked to draw again either way.
    static func save(_ context: WidgetContext?) {
        if context == read() && context != nil { return }
        _ = SecItemDelete(query() as CFDictionary)
        if let context, let data = try? JSONEncoder().encode(context) {
            var add = query()
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            _ = SecItemAdd(add as CFDictionary, nil)
        }
        reload()
    }

    static func reload() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }
}
