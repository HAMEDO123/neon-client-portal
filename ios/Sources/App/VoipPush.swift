import PushKit
import UIKit

/// Calls that ring with the app closed or the phone locked: a VoIP push
/// (PushKit) wakes the app, and CallKitCenter rings the phone with the
/// iPhone's own call screen.
///
/// The token is registered at `/api/mobile/devices` beside the alert token,
/// with `kind: "voip"`; for a phone registered this way the server stops
/// sending the ordinary "Incoming call" banner. The push is sent to the topic
/// `<bundle id>.voip` when a call starts and when somebody is rung into one:
///
///     {"type": "incoming-call", "callId": "…", "callerName": "Sally",
///      "title": "Sally", "kind": "AUDIO" | "VIDEO", "isGroup": false}
///
/// `title` is what the call screen shows — the caller for a private call, the
/// group's name for a group call.
@MainActor
final class VoipPush: NSObject {
    static let shared = VoipPush()

    private var registry: PKPushRegistry?
    private var token: String?
    private static let registeredKey = "voip_registered_token"

    private override init() {
        super.init()
        // Registered on an earlier launch and not signed out since: the
        // server still rings this phone by push.
        CallKitCenter.shared.ringsByPush = UserDefaults.standard.string(forKey: Self.registeredKey) != nil
    }

    /// At launch, from the app delegate. The registry must exist before the
    /// push that launched the app is delivered, and it delivers the token on
    /// every launch — which is what re-registers it.
    func start() {
        guard registry == nil else { return }
        let registry = PKPushRegistry(queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
        self.registry = registry
    }

    /// Signed in (again): tell the server where to ring.
    func register() {
        guard let token else { return }
        Task { await send(token) }
    }

    private func send(_ token: String) async {
        guard APIClient.shared.isLoggedIn else { return }
        var body = PushCenter.deviceBody(token: token)
        body["kind"] = "voip"
        do {
            _ = try await APIClient.shared.sendJSON("POST", "devices", body)
            UserDefaults.standard.set(token, forKey: Self.registeredKey)
            CallKitCenter.shared.ringsByPush = true
        } catch {
            #if DEBUG
            print("VoIP registration failed:", error)
            #endif
        }
    }

    /// Signing out: this phone stops ringing for the person. Called while the
    /// token is still valid, with the bearer captured before sign-out.
    func unregister(bearer: String?) async {
        let registered = token ?? UserDefaults.standard.string(forKey: Self.registeredKey)
        UserDefaults.standard.removeObject(forKey: Self.registeredKey)
        CallKitCenter.shared.ringsByPush = false
        guard let registered, let bearer else { return }
        await PushCenter.releaseDevice(token: registered, bearer: bearer)
    }

    private func didUpdate(_ hex: String) {
        token = hex
        register()
    }

    /// Apple withdrew the token (it issues a new one through `didUpdate`).
    private func invalidated() {
        let bearer = APIClient.shared.token
        Task { await unregister(bearer: bearer) }
        token = nil
    }

    private func received(_ payload: [AnyHashable: Any], completion: @escaping () -> Void) {
        let isCall = payload["type"] as? String == "incoming-call"
        let callId = payload["callId"] as? String
        let title = payload["title"] as? String ?? payload["callerName"] as? String
        CallKitCenter.shared.reportIncoming(
            callId: isCall ? callId : nil,
            title: title,
            video: payload["kind"] as? String == "VIDEO",
            completion: completion
        )
    }
}

extension VoipPush: PKPushRegistryDelegate {
    // The registry's queue is the main queue (PKPushRegistry(queue: .main)).

    nonisolated func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        guard type == .voIP else { return }
        let hex = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        MainActor.assumeIsolated { didUpdate(hex) }
    }

    nonisolated func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        guard type == .voIP else { return }
        MainActor.assumeIsolated { invalidated() }
    }

    /// Reported to CallKit here, synchronously, for every push — whatever it
    /// carries (see CallKitCenter.reportIncoming).
    nonisolated func pushRegistry(
        _ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType,
        completion: @escaping () -> Void
    ) {
        let dictionary = payload.dictionaryPayload
        MainActor.assumeIsolated { received(dictionary, completion: completion) }
    }
}
