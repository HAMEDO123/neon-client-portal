import SwiftUI
import UIKit
import UserNotifications

/// Notifications on the phone's lock screen, through Apple (APNs).
///
/// The server sends every notification it already writes — the same rows the
/// Alerts screens list — to the phone as well as to any browser, once the
/// phone has registered here (`/api/mobile/devices`). Nothing about what is
/// sent, or to whom, is decided on the phone.
@MainActor
final class PushCenter: ObservableObject {
    static let shared = PushCenter()

    /// The web path a tapped notification points at ("/employee/tasks/<id>",
    /// "/admin/chat/<slug>" …). The tab bars read it and go there.
    @Published var pendingPath: String?

    private var deviceToken: String?
    private static let registeredKey = "push_registered_token"

    private init() {}

    /// Asks once, after sign-in. A "no" is the person's answer and is left
    /// alone — iOS will not ask twice, and the Alerts screens still work.
    func start() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
        // Calls ring through their own push, which needs no permission.
        VoipPush.shared.register()
    }

    func didRegister(_ token: Data) {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        deviceToken = hex
        Task { await register(hex) }
    }

    /// What `/api/mobile/devices` is told about a token — the alert one, and
    /// (with `kind: "voip"`) the one calls ring through.
    static func deviceBody(token: String) -> [String: Any] {
        var body: [String: Any] = [
            "token": token,
            "bundleId": Bundle.main.bundleIdentifier ?? "com.neonjo.staff",
            // A Debug build from Xcode gets a sandbox token; TestFlight and the
            // App Store get production ones. Apple refuses a token at the
            // other gateway with an error that reads like a dead device.
            "sandbox": isSandbox,
            "deviceName": UIDevice.current.name,
        ]
        if let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
           let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String {
            body["appVersion"] = "\(version) (\(build))"
        }
        return body
    }

    private func register(_ token: String) async {
        let api = APIClient.shared
        guard api.isLoggedIn else { return }
        do {
            _ = try await api.sendJSON("POST", "devices", Self.deviceBody(token: token))
            UserDefaults.standard.set(token, forKey: Self.registeredKey)
        } catch {
            #if DEBUG
            print("Push registration failed:", error)
            #endif
        }
    }

    /// Signing out: this phone stops receiving the person's notifications,
    /// and stops ringing for their calls. Called while the token is still
    /// valid.
    func unregister(bearer: String?) async {
        let token = deviceToken ?? UserDefaults.standard.string(forKey: Self.registeredKey)
        UserDefaults.standard.removeObject(forKey: Self.registeredKey)
        await VoipPush.shared.unregister(bearer: bearer)
        guard let token, let bearer else { return }
        await Self.releaseDevice(token: token, bearer: bearer)
    }

    /// Takes a token off the server, with the bearer captured before sign-out
    /// cleared it.
    static func releaseDevice(token: String, bearer: String) async {
        var request = URLRequest(url: portalOrigin.appendingPathComponent("api/mobile/devices"))
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["token": token])
        _ = try? await URLSession.shared.data(for: request)
    }

    static var isSandbox: Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }
}

/// The app delegate, for the two things SwiftUI still hands to one: the APNs
/// token, and notifications arriving or being tapped.
final class NeonAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // Calls: the phone's own call screen, then the pushes that ring it —
        // both before the push that launched the app, if one did, is handed
        // over. Launched by one, the app may have no window at all yet.
        MainActor.assumeIsolated {
            CallKitCenter.shared.setUp()
            VoipPush.shared.start()
            // Somebody on the team: share the phone's position during working
            // hours — also when iOS launched the app in the background for a
            // move or for the server's silent push.
            LocationSharing.shared.activate()
        }
        return true
    }

    /// A silent push. The only kind the server sends is "location": the day
    /// has opened, or the manager's map found this phone's position old.
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        guard let neon = userInfo["neon"] as? [String: Any], neon["kind"] as? String == "location" else {
            completionHandler(.noData)
            return
        }
        Task { @MainActor in
            completionHandler(await LocationSharing.shared.wake() ? .newData : .noData)
        }
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in PushCenter.shared.didRegister(deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        #if DEBUG
        print("APNs registration failed:", error)
        #endif
    }

    /// In front of the person already: still show it, as the web portal's
    /// sound cues do while it is open.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    /// Tapped: go where it points.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let path = response.notification.request.content.userInfo["url"] as? String
        await MainActor.run { PushCenter.shared.pendingPath = path }
    }
}

/// Where a notification's web path lands in the app's tabs.
enum PushRoute {
    static func adminTab(_ path: String) -> AdminTab {
        if path.hasPrefix("/admin/chat") { return .chat }
        if path.hasPrefix("/admin/tasks") { return .tasks }
        if path.hasPrefix("/admin/projects") { return .projects }
        if path == "/admin" || path == "/admin/" { return .home }
        return .more
    }

    static func employeeTab(_ path: String) -> EmployeeTab {
        if path.hasPrefix("/employee/chat") { return .chat }
        if path.hasPrefix("/employee/tasks") || path.hasPrefix("/employee/assigned") { return .tasks }
        if path.hasPrefix("/employee/projects") { return .projects }
        if path == "/employee" || path.hasPrefix("/employee?") { return .today }
        return .more
    }
}
