import Foundation
import Security

/// Where the session token lives.
///
/// It sat in `UserDefaults` while the app was sideloaded — a plain plist in the
/// app container — which the comment there called fine "for this first pass".
/// A signed build handed to the whole team keeps it in the Keychain instead,
/// encrypted at rest by the device.
///
/// `kSecAttrAccessibleAfterFirstUnlock` is the deliberate part: the token has
/// to be readable while the phone is locked, because a VoIP push handler has to
/// answer a call on a phone nobody has unlocked. The stricter `WhenUnlocked`
/// would fail at exactly that moment, and silently.
enum TokenStore {
    private static let service = "com.neonjo.staff"
    private static let account = "session_token"

    private static func base() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func read() -> String? {
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
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        _ = SecItemAdd(query as CFDictionary, nil)
    }

    static func delete() {
        _ = SecItemDelete(base() as CFDictionary)
    }
}
