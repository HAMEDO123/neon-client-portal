import CoreLocation
import SwiftUI

/// Clocking in from the app (src/lib/app-clock.ts), for somebody the manager
/// has turned it on for — the website's home card, on the phone. Today's
/// punches from here, each with where it was made, and the button.
///
/// The position is asked for fresh every time, never a cached one that could
/// be from the drive over, and nothing is sent without it: the place is what
/// makes a clock-in from anywhere worth anything. The server files a punch
/// beside the fingerprint device's reads, so lateness, the clock-out and the
/// reminders follow from it unchanged.
///
///   GET get/me/clock → { allowed, punches: [{ time, link }], clockedIn }
///   POST do/me/clock args [latitude, longitude, accuracy, fixedAtISO] → { ok, time }
struct AppClockCard: View {
    @EnvironmentObject var api: APIClient
    @StateObject private var locator = ClockLocator()
    @State private var clock: AppClock?
    @State private var busy: Busy?
    @State private var done: String?
    @State private var problem: String?

    private enum Busy { case locating, saving }

    #if DEBUG
    /// The debug router's fixture, reading nothing.
    private var preview: AppClock?
    init(preview: AppClock? = nil) {
        self.preview = preview
        _clock = State(initialValue: preview)
    }
    #endif

    struct AppClock: Decodable {
        let allowed: Bool
        let punches: [Punch]
        /// Already in today, on the fingerprint or here. Missing from a server before 2026-11-21.
        let clockedIn: Bool?
        struct Punch: Decodable, Hashable {
            let time: String
            let link: String?
        }
    }

    private struct Recorded: Decodable { let time: String }

    var body: some View {
        Group {
            if let clock, clock.allowed {
                SectionCard(L("Clock in from the app"), subtitle: L("Recorded with where you are, like the fingerprint at the studio."), symbol: "location.circle.fill", hue: .indigo) {
                    VStack(alignment: .leading, spacing: 10) {
                        if !clock.punches.isEmpty {
                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(Array(clock.punches.enumerated()), id: \.offset) { index, punch in
                                    punchRow(punch, first: index == 0)
                                }
                            }
                        }
                        NeonButton(buttonTitle(clock), symbol: "mappin.and.ellipse", kind: .brand, isLoading: busy != nil) {
                            await record()
                        }
                        .disabled(busy != nil)
                        if let done {
                            Text(done).font(.neonFootnote).foregroundStyle(Color.neonSuccessStrong)
                        }
                        if let problem {
                            Text(problem)
                                .font(.neonFootnote)
                                .foregroundStyle(Color.neonDangerStrong)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
        .task { await load() }
    }

    private func buttonTitle(_ clock: AppClock) -> String {
        switch busy {
        case .locating: return L("Finding where you are…")
        case .saving: return L("Recording…")
        // In on the fingerprint counts: the button read only this app's
        // punches, so somebody in at the studio was offered "Clock in" all day.
        case nil: return (clock.clockedIn ?? !clock.punches.isEmpty) ? L("Clock out here") : L("Clock in here")
        }
    }

    private func punchRow(_ punch: AppClock.Punch, first: Bool) -> some View {
        HStack(spacing: 8) {
            Image(systemName: first ? "arrow.down.right.circle.fill" : "arrow.up.left.circle.fill")
                .foregroundStyle(first ? Color.neonSuccessStrong : Color.neonIndigoStrong)
            Text(punch.time)
                .font(.system(.subheadline, weight: .semibold))
                .monospacedDigit()
            Spacer(minLength: 0)
            if let raw = punch.link, let url = URL(string: raw) {
                Link(destination: url) {
                    Label(L("Where"), systemImage: "map")
                        .font(.neonCaption)
                }
            }
        }
    }

    private func record() async {
        guard busy == nil else { return }
        problem = nil
        done = nil
        busy = .locating
        let fix: CLLocation
        do {
            fix = try await locator.fresh()
        } catch {
            problem = error.localizedDescription
            busy = nil
            return
        }
        busy = .saving
        do {
            let iso = ISO8601DateFormatter().string(from: fix.timestamp)
            let outcome = try await api.perform("me/clock", args: [fix.coordinate.latitude, fix.coordinate.longitude, fix.horizontalAccuracy, iso])
            let time = (try? outcome.result(Recorded.self))?.time ?? ""
            Haptic.success()
            done = L("Recorded at %@, with your location.", time)
            await load()
        } catch {
            Haptic.error()
            problem = L(error.localizedDescription)
        }
        busy = nil
    }

    private func load() async {
        #if DEBUG
        if preview != nil { return }
        #endif
        clock = try? await api.readFresh("me/clock", as: AppClock.self)
    }
}

/// One fresh position, asked for when the button is pressed: the best accuracy
/// the phone has, never a cached fix.
@MainActor
final class ClockLocator: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var waiting: CheckedContinuation<CLLocation, Error>?

    struct Problem: LocalizedError {
        let errorDescription: String?
    }

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func fresh() async throws -> CLLocation {
        switch manager.authorizationStatus {
        case .denied, .restricted:
            throw Problem(errorDescription: L("Location is blocked for NEON. Allow it in Settings → NEON → Location, then try again."))
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        default:
            break
        }
        return try await withCheckedThrowingContinuation { continuation in
            waiting?.resume(throwing: CancellationError())
            waiting = continuation
            manager.requestLocation()
            // Twenty seconds, as the website waits.
            DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
                guard let self, let waiting = self.waiting else { return }
                self.waiting = nil
                waiting.resume(throwing: Problem(errorDescription: L("Your location took too long to come through. Step outside if you can and try again.")))
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let best = locations.last else { return }
        Task { @MainActor in
            self.waiting?.resume(returning: best)
            self.waiting = nil
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            guard let waiting = self.waiting else { return }
            // Still waiting for the permission answer: iOS reports that as a failure too.
            if (error as? CLError)?.code == .locationUnknown { return }
            self.waiting = nil
            waiting.resume(throwing: Problem(errorDescription: L("Your phone couldn't find where you are. Turn location on and try again.")))
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            guard self.waiting != nil else { return }
            switch manager.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
            case .denied, .restricted:
                self.waiting?.resume(throwing: Problem(errorDescription: L("Location is blocked for NEON. Allow it in Settings → NEON → Location, then try again.")))
                self.waiting = nil
            default: break
            }
        }
    }
}
