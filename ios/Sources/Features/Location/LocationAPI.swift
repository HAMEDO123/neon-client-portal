import CoreLocation
import Foundation

// Where the team is — during working hours, and only then. An employee's
// phone reports its position while the studio's working day is open; the
// manager's map reads everybody's latest. src/lib/staff-location.ts has the
// rules:
//
//   GET  get/me/location             → LocationPlan: share now or not, and until when
//   POST do/me/location/report       → [lat, lng, accuracy, fixedAt, precise] → LocationPlan
//   POST do/me/location/permission   → [permission, precise]
//   GET  get/team/locations          → TeamLocations (the manager's alone)
//   POST do/team/locations/refresh   → asks phones with an old position for a new one
//   POST do/team/locations/office    → [lat, lng] sets the office, [] clears it
//
// The server decides when the day is open (Settings' hours and working days,
// and not once the fingerprint device has seen somebody clock out), refuses
// a position outside it, keeps only the latest one per person, and wipes
// them when the day's hours end.

// MARK: - The employee's side

/// Whether this phone should be sharing now, and the window around now.
struct LocationPlan: Decodable, Equatable {
    let sharing: Bool
    /// Why not: "before-hours", "after-hours", "day-off", "clocked-out"; nil when sharing.
    let reason: String?
    let startsAt: String?
    let endsAt: String?
    let nextStartsAt: String?

    var starts: Date? { parseISODate(startsAt) }
    var ends: Date? { parseISODate(endsAt) }
    var nextStart: Date? { parseISODate(nextStartsAt) }
}

// MARK: - The manager's map

struct TeamLocations: Decodable, Equatable {
    /// Today's working hours are running now.
    let open: Bool
    let startsAt: String?
    let endsAt: String?
    let nextStartsAt: String?
    let office: OfficeSpot?
    let people: [TeamLocationPerson]

    var starts: Date? { parseISODate(startsAt) }
    var ends: Date? { parseISODate(endsAt) }
    var nextStart: Date? { parseISODate(nextStartsAt) }

    /// Everybody with a position to draw.
    var onMap: [TeamLocationPerson] { people.filter { $0.coordinate != nil } }
}

struct OfficeSpot: Decodable, Equatable {
    let latitude: Double
    let longitude: Double

    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
}

/// One person, as the server read them: their phone's last position and
/// what is known around it. Nothing here is a verdict about whether they
/// are working — it is what the phone and the fingerprint device said.
struct TeamLocationPerson: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let photoUrl: String?
    let role: String?
    /// "live" (≤ 5 min), "recent" (≤ 20 min), "stale" (older, today), "waiting"
    /// (nothing yet today), "off" (location turned off on the phone),
    /// "clocked-out", "day-off", "closed" (outside working hours).
    let state: String
    let latitude: Double?
    let longitude: Double?
    let accuracy: Double?
    let fixedAt: String?
    let precise: Bool?
    /// "always", "when-in-use", "denied", "restricted", "not-determined", "unknown".
    let permission: String?
    let atOffice: Bool?
    let metresFromOffice: Double?
    let arrivedAt: String?
    let departedAt: String?

    var coordinate: CLLocationCoordinate2D? {
        guard let latitude, let longitude else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    var fixed: Date? { parseISODate(fixedAt) }
    var arrived: Date? { parseISODate(arrivedAt) }
    var departed: Date? { parseISODate(departedAt) }
}

// MARK: - Where the map reads from

/// The map's three calls, so a Debug screenshot can draw it from fixed answers.
@MainActor
protocol TeamMapSource: AnyObject {
    func load() async throws -> TeamLocations
    /// Asks the phones whose position is old for a new one. Quiet: a refusal
    /// changes nothing on screen.
    func askForFreshPositions() async
    func setOffice(_ coordinate: CLLocationCoordinate2D?) async throws -> OfficeSpot?
}

/// The studio's server.
@MainActor
final class NetworkTeamMapSource: TeamMapSource {
    static let shared = NetworkTeamMapSource()

    func load() async throws -> TeamLocations {
        // Never kept on disk: where people were is not something to leave in
        // a file on a phone, and an old copy would draw them where they are not.
        try await APIClient.shared.readFresh("team/locations", as: TeamLocations.self)
    }

    func askForFreshPositions() async {
        // Straight to the route rather than `perform`: asking the phones
        // changes nothing the other screens show, so none should re-read.
        _ = try? await APIClient.shared.sendJSON("POST", "do/team/locations/refresh", ["args": [Any]()])
    }

    func setOffice(_ coordinate: CLLocationCoordinate2D?) async throws -> OfficeSpot? {
        let args: [Any] = coordinate.map { [$0.latitude, $0.longitude] } ?? []
        let outcome = try await APIClient.shared.perform("team/locations/office", args: args)
        struct Answer: Decodable { let office: OfficeSpot? }
        return try outcome.result(Answer.self)?.office
    }
}
