import Foundation
import Security

/// Where the session token lives: the Keychain, never `UserDefaults` or a file.
///
/// The token is a signed seven-day credential for the live studio server — the
/// same one the web keeps in a cookie — so it is stored encrypted at rest by
/// the device rather than in the app container's plain plist.
///
/// Builds before this one kept it in `UserDefaults` under `session_token`.
/// `read()` moves such a token across once and deletes the old copy, so the
/// manager's phone stays signed in through the update.
enum TokenStore {
    private static let service = Bundle.main.bundleIdentifier ?? "com.neon.admin"
    private static let account = "session_token"
    private static let legacyDefaultsKey = "session_token"

    private static func base() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func read() -> String? {
        if let legacy = UserDefaults.standard.string(forKey: legacyDefaultsKey) {
            UserDefaults.standard.removeObject(forKey: legacyDefaultsKey)
            write(legacy)
            return legacy
        }

        var query = base()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ token: String) {
        // Delete then add, rather than SecItemUpdate: one path covers both a
        // first sign-in and a later one, and nothing on the old item is worth
        // carrying over.
        delete()
        var query = base()
        query[kSecValueData as String] = Data(token.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        _ = SecItemAdd(query as CFDictionary, nil)
    }

    static func delete() {
        _ = SecItemDelete(base() as CFDictionary)
    }
}
