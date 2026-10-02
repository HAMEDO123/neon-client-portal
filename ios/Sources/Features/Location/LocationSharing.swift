import Combine
import CoreLocation
import UIKit

/// This phone's half of the team map: where it is, sent to the studio while —
/// and only while — the working day is open.
///
/// The server says when that is (`me/location`), and answers every position
/// with the same plan, so the phone stops the moment the day closes or the
/// fingerprint device sees its owner clock out. Outside the window nothing is
/// read from the phone's location at all: the location service stops, not
/// just the sending.
///
/// While sharing: the standard location service at about a hundred metres
/// (Wi-Fi and cell before GPS, for the battery); a position is sent when its
/// owner has moved 40 m, and every two minutes when they have not — the
/// service reports any move of 25 m, so no news means "still here". iOS
/// shows its blue location pill whenever this runs in the background, so the
/// person can always see that it is on.
///
/// The team's side only. The manager's phone never starts any of it.
@MainActor
final class LocationSharing: NSObject, ObservableObject {
    static let shared = LocationSharing()

    @Published private(set) var authorization: CLAuthorizationStatus
    /// Precise Location on (iOS 14+ lets somebody share only roughly where they are).
    @Published private(set) var precise: Bool
    @Published private(set) var plan: LocationPlan?
    @Published private(set) var lastSentAt: Date?
    /// The location service is on: inside the window, with permission.
    @Published private(set) var isRunning = false

    private let manager = CLLocationManager()
    private var enabled = false
    private var planReadAt: Date?
    private var lastSent: CLLocation?
    private var pending: CLLocation?
    private var sending = false
    private var heartbeat: Timer?
    private var boundary: Timer?
    private var reportedPermission: String?
    private var upgradeToAlways = false
    private var identityWatch: AnyCancellable?

    /// Moved this far since the last position sent: send again…
    private static let moveMetres: CLLocationDistance = 40
    /// …but not more often than this.
    private static let shortestGap: TimeInterval = 15
    /// Not moved: say "still here" this often.
    private static let stillHereEvery: TimeInterval = 120
    /// iOS asks "Change to Always Allow?" once; after that only Settings can.
    private static let askedAlwaysKey = "location_asked_always"

    private override init() {
        authorization = manager.authorizationStatus
        precise = manager.accuracyAuthorization == .fullAccuracy
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 25
        manager.activityType = .other
        // Never paused by iOS mid-day: a paused service does not resume by itself.
        manager.pausesLocationUpdatesAutomatically = false
    }

    #if DEBUG
    /// A copy for Debug screenshots (LocationScreens): the state is drawn,
    /// and nothing here ever starts the location service or sends anything.
    init(preview authorization: CLAuthorizationStatus, precise: Bool = true, plan: LocationPlan?, running: Bool, lastSentAt: Date? = nil) {
        self.authorization = authorization
        self.precise = precise
        super.init()
        self.plan = plan
        self.isRunning = running
        self.lastSentAt = lastSentAt
    }
    #endif

    // MARK: - Turning it on and off

    /// Signed in on the team's side: share during the working day from now
    /// on. Called at launch — including a launch by iOS in the background —
    /// and on every return to the foreground; it only ever reads the plan
    /// again and matches the service to it.
    func activate() {
        guard APIClient.shared.isLoggedIn, APIClient.shared.side == .employee else { return }
        #if DEBUG
        if DebugScreens.requested != nil || APIClient.uiTestMode { return }
        #endif
        if identityWatch == nil {
            identityWatch = APIClient.shared.$identity
                .dropFirst()
                .sink { [weak self] identity in
                    guard identity?.side != .employee else { return }
                    Task { @MainActor in self?.deactivate() }
                }
        }
        enabled = true
        Task { await evaluate() }
    }

    /// Signed out: everything stops and the plan is forgotten.
    func deactivate() {
        enabled = false
        stopService()
        boundary?.invalidate()
        boundary = nil
        plan = nil
        planReadAt = nil
        lastSent = nil
        lastSentAt = nil
        pending = nil
        reportedPermission = nil
    }

    /// "Turn on": iOS's own question — While Using first, then Always, which
    /// iOS asks separately and only once. After that, Settings.
    func askPermission() {
        switch authorization {
        case .notDetermined:
            upgradeToAlways = true
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse where !UserDefaults.standard.bool(forKey: Self.askedAlwaysKey):
            askForAlways()
        default:
            openSettings()
        }
    }

    func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

    private func askForAlways() {
        UserDefaults.standard.set(true, forKey: Self.askedAlwaysKey)
        manager.requestAlwaysAuthorization()
    }

    /// The server asked for a position now (a silent push, sent when the day
    /// opens and when the manager's map finds this phone's position old).
    /// Answers whether one was sent.
    func wake() async -> Bool {
        activate()
        await evaluate(force: true)
        guard isRunning else { return false }
        let before = lastSentAt
        // The service has just been (re)started: give it a moment to find
        // where it is, as an answer to the server's question.
        for _ in 0..<20 {
            if lastSentAt != before { return true }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        if let location = manager.location {
            send(location, stillHere: true)
            try? await Task.sleep(nanoseconds: 3_000_000_000)
        }
        return lastSentAt != before
    }

    // MARK: - The plan

    /// Reads the plan (at most once a minute, unless asked to) and starts or
    /// stops the location service to match it.
    func evaluate(force: Bool = false) async {
        guard enabled, APIClient.shared.isLoggedIn, APIClient.shared.side == .employee else {
            stopService()
            return
        }
        reportPermissionIfChanged()
        if force || planIsOld {
            if let fresh = try? await APIClient.shared.readFresh("me/location", as: LocationPlan.self) {
                plan = fresh
                planReadAt = Date()
            }
        }
        apply()
    }

    private var planIsOld: Bool {
        guard let plan, let planReadAt else { return true }
        if Date().timeIntervalSince(planReadAt) > 60 { return true }
        // The window opened or closed since the plan was read.
        let edge = plan.sharing ? plan.ends : plan.nextStart
        return edge.map { $0 <= Date() } ?? false
    }

    private var hasPermission: Bool {
        authorization == .authorizedAlways || authorization == .authorizedWhenInUse
    }

    private func apply() {
        if enabled && plan?.sharing == true && hasPermission {
            startService()
            if let pending {
                self.pending = nil
                received(pending)
            }
        } else {
            pending = nil
            stopService()
        }
        scheduleBoundary()
    }

    /// A timer for the window's next edge — the end while sharing, the next
    /// start while not — for a phone that is open at that moment.
    private func scheduleBoundary() {
        boundary?.invalidate()
        boundary = nil
        guard enabled, let plan else { return }
        guard let edge = plan.sharing ? plan.ends : plan.nextStart else { return }
        let wait = edge.timeIntervalSinceNow + 2
        guard wait > 0, wait < 16 * 3600 else { return }
        boundary = Timer.scheduledTimer(withTimeInterval: wait, repeats: false) { [weak self] _ in
            Task { @MainActor in await self?.evaluate(force: true) }
        }
    }

    // MARK: - The location service

    private func startService() {
        if !isRunning {
            // Keeps reporting with the app in the background — and while it
            // does, iOS shows the blue location pill.
            manager.allowsBackgroundLocationUpdates = true
            manager.showsBackgroundLocationIndicator = true
            manager.startUpdatingLocation()
            isRunning = true
            heartbeat?.invalidate()
            heartbeat = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.beat() }
            }
        }
        if authorization == .authorizedAlways {
            // The safety net: if iOS ends the app mid-day, a move of about
            // 500 m launches it again to carry on. Stopped with the day.
            manager.startMonitoringSignificantLocationChanges()
        }
    }

    private func stopService() {
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        if isRunning {
            manager.allowsBackgroundLocationUpdates = false
            isRunning = false
        }
        heartbeat?.invalidate()
        heartbeat = nil
    }

    private func beat() {
        guard isRunning, !sending else { return }
        let since = lastSentAt.map { Date().timeIntervalSince($0) } ?? .infinity
        guard since >= Self.stillHereEvery, let location = manager.location else { return }
        // The service is on and reports any move of 25 m, so nothing new
        // since the last position means still there — sent as of now.
        send(location, stillHere: true)
    }

    private func received(_ location: CLLocation) {
        guard location.horizontalAccuracy >= 0 else { return }
        guard isRunning else {
            // Launched by iOS for a move while the plan is unknown: read it
            // first; the position goes once the day is known to be open.
            if enabled {
                pending = location
                Task { await evaluate() }
            }
            return
        }
        let since = lastSentAt.map { Date().timeIntervalSince($0) } ?? .infinity
        let moved = lastSent.map { location.distance(from: $0) } ?? .infinity
        if (moved >= Self.moveMetres && since >= Self.shortestGap) || since >= Self.stillHereEvery {
            send(location, stillHere: false)
        }
    }

    // MARK: - Telling the studio

    private func send(_ location: CLLocation, stillHere: Bool) {
        guard !sending, plan?.sharing == true else { return }
        sending = true
        let args: [Any] = [
            location.coordinate.latitude,
            location.coordinate.longitude,
            max(0, location.horizontalAccuracy),
            Self.iso(stillHere ? Date() : location.timestamp),
            precise,
        ]
        Task {
            defer { sending = false }
            do {
                // Straight to the route rather than `perform`: a position
                // every two minutes is not news for the screens to reload on.
                let data = try await APIClient.shared.sendJSON("POST", "do/me/location/report", ["args": args])
                lastSent = location
                lastSentAt = Date()
                if let answer = try? ActionOutcome(data: data).result(LocationPlan.self) {
                    plan = answer
                    planReadAt = Date()
                    apply()
                }
            } catch {
                // Offline or refused: the next move or the next beat tries again.
            }
        }
    }

    /// What the manager's map says about this phone's switch — so a phone with
    /// location off reads as "location is off", never as somebody missing.
    private func reportPermissionIfChanged() {
        let word = Self.word(for: authorization)
        let key = "\(word)|\(precise)"
        guard enabled, key != reportedPermission else { return }
        reportedPermission = key
        let precise = self.precise
        Task {
            do {
                _ = try await APIClient.shared.sendJSON("POST", "do/me/location/permission", ["args": [word, precise]])
            } catch {
                if reportedPermission == key { reportedPermission = nil }
            }
        }
    }

    nonisolated static func word(for status: CLAuthorizationStatus) -> String {
        switch status {
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "when-in-use"
        case .denied: return "denied"
        case .restricted: return "restricted"
        default: return "not-determined"
        }
    }

    private static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    fileprivate func authorizationChanged(_ status: CLAuthorizationStatus, precise: Bool) {
        authorization = status
        self.precise = precise
        if status == .authorizedWhenInUse, upgradeToAlways, !UserDefaults.standard.bool(forKey: Self.askedAlwaysKey) {
            // Straight after While Using: iOS's second question, so the
            // sharing carries on while the app is closed.
            askForAlways()
        }
        if status != .notDetermined { upgradeToAlways = false }
        Task { await evaluate() }
    }
}

extension LocationSharing: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        let precise = manager.accuracyAuthorization == .fullAccuracy
        Task { @MainActor in self.authorizationChanged(status, precise: precise) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        Task { @MainActor in self.received(location) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // "Location unknown" passes by itself; "denied" arrives as an
        // authorization change. Nothing to do here.
    }
}
