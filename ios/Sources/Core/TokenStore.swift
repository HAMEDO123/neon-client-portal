import Foundation
import Security

/// Where the session token lives: the Keychain, never `UserDefaults` or a file.
///
/// The token is a signed seven-day credential for the live studio server — the
/// same one the web keeps in a cookie — so it is stored encrypted at rest by
/// the device rather than in the app container's plain plist.
///
/// The item sits in a keychain group the app shares with its share extension
/// (`keychain-access-groups` on both targets in project.yml), so sharing from
/// WhatsApp or Photos sends as whoever is signed in here, and signing out here
/// signs the extension out too. This file is compiled into both.
///
/// Builds before this one kept it in `UserDefaults` under `session_token`, and
/// builds before the extension kept it in the app's own keychain group.
/// `read()` moves either across once and deletes the old copy, so the
/// manager's phone stays signed in through the update.
enum TokenStore {
    /// The app's bundle id, written out: the extension has a bundle id of its
    /// own, and both have to name the same item.
    private static let service = "com.neonjo.staff"
    private static let account = "session_token"
    private static let legacyDefaultsKey = "session_token"

    /// "<team>.com.neonjo.staff.shared", from Info.plist (`NeonKeychainGroup`),
    /// where the build fills the team in. nil when it did not; and when this
    /// build is not entitled to it (an unsigned CI build) adding to it fails,
    /// and `write` keeps the item in the app's own group, as before.
    private static let sharedGroup: String? = {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "NeonKeychainGroup") as? String,
              !group.hasPrefix("."), !group.contains("$(")
        else { return nil }
        return group
    }()

    private static func base(group: String? = nil) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group { query[kSecAttrAccessGroup as String] = group }
        return query
    }

    static func read() -> String? {
        if let legacy = UserDefaults.standard.string(forKey: legacyDefaultsKey) {
            UserDefaults.standard.removeObject(forKey: legacyDefaultsKey)
            write(legacy)
            return legacy
        }

        if let sharedGroup, let found = copy(group: sharedGroup) { return found.token }

        // Anywhere else this app can reach: an install from before the share
        // extension, whose item is in the app's own group. Moved into the
        // shared one so the extension finds it too — the old copy goes only
        // once the new one is in place, so a failure leaves it signed in.
        guard let found = copy(group: nil) else { return nil }
        if let sharedGroup, let oldGroup = found.group, oldGroup != sharedGroup,
           add(found.token, group: sharedGroup) == errSecSuccess {
            _ = SecItemDelete(base(group: oldGroup) as CFDictionary)
        }
        return found.token
    }

    static func write(_ token: String) {
        // Delete then add, rather than SecItemUpdate: one path covers both a
        // first sign-in and a later one, and nothing on the old item is worth
        // carrying over.
        delete()
        if let sharedGroup, add(token, group: sharedGroup) == errSecSuccess { return }
        // A build without the shared group in its entitlements (an unsigned CI
        // build, re-signed elsewhere): the app's own group, as before — signed
        // in, only not visible to the share extension.
        _ = add(token, group: nil)
    }

    /// Every copy in every group this app can reach, the shared one named
    /// outright: signing out here signs the share extension out as well.
    static func delete() {
        if let sharedGroup { _ = SecItemDelete(base(group: sharedGroup) as CFDictionary) }
        _ = SecItemDelete(base() as CFDictionary)
    }

    private static func copy(group: String?) -> (token: String, group: String?)? {
        var query = base(group: group)
        query[kSecReturnData as String] = true
        query[kSecReturnAttributes as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let attributes = item as? [String: Any],
              let data = attributes[kSecValueData as String] as? Data,
              let token = String(data: data, encoding: .utf8)
        else { return nil }
        return (token, attributes[kSecAttrAccessGroup as String] as? String)
    }

    private static func add(_ token: String, group: String?) -> OSStatus {
        var query = base(group: group)
        query[kSecValueData as String] = Data(token.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(query as CFDictionary, nil)
    }
}
