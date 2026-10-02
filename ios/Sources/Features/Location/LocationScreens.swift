#if DEBUG
import CoreLocation
import SwiftUI

/// The team map and the team's location card for the debug router
/// (App/DebugScreens.swift): `-neonScreen <id>` opens one straight from
/// launch, for screenshots. None of them reads a phone's location or the
/// network: the answers are written here, around an office in Amman, with
/// made-up people.
///
/// - team-map: the manager's map during working hours
/// - team-map-person: the same, with somebody chosen
/// - team-map-closed: outside working hours
/// - team-map-empty: working hours, nobody's position yet
/// - home-team-map: Home's card
/// - location-card-ask, -on, -while-open, -off, -closed: the team's card
/// - team-map-live: the real map, read from the server (read-only)
enum LocationScreens {
    static let ids: [String] = [
        "team-map", "team-map-person", "team-map-closed", "team-map-empty", "home-team-map",
        "location-card-ask", "location-card-on", "location-card-while-open", "location-card-off", "location-card-closed",
        "team-map-live", "location-required-ask", "location-required-always", "location-required-settings", "location-required-precise",
    ]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "team-map": return debugPushed(TeamMapView(source: TeamMapFixtureSource()))
        case "team-map-person": return debugPushed(TeamMapView(source: TeamMapFixtureSource(), selection: "p2"))
        case "team-map-closed": return debugPushed(TeamMapView(source: TeamMapFixtureSource(open: false)))
        case "team-map-empty": return debugPushed(TeamMapView(source: TeamMapFixtureSource(nobodyYet: true)))
        case "team-map-live": return debugPushed(TeamMapView())
        case "home-team-map": return AnyView(HomeTeamMapFixtureHost())
        case "location-card-ask": return card(.notDetermined, running: false, plan: plan(sharing: true))
        case "location-card-on": return card(.authorizedAlways, running: true, plan: plan(sharing: true), sent: Date().addingTimeInterval(-70))
        case "location-card-while-open": return card(.authorizedWhenInUse, running: true, plan: plan(sharing: true), sent: Date().addingTimeInterval(-20))
        case "location-card-off": return card(.denied, running: false, plan: plan(sharing: true))
        case "location-card-closed": return card(.authorizedAlways, running: false, plan: plan(sharing: false))
        case "location-required-ask": return required(.notDetermined)
        case "location-required-always": return required(.authorizedWhenInUse)
        case "location-required-settings": return required(.denied)
        case "location-required-precise": return required(.authorizedAlways, precise: false)
        default: return nil
        }
    }

    @MainActor private static func required(_ status: CLAuthorizationStatus, precise: Bool = true) -> AnyView {
        let sharing = LocationSharing(preview: status, precise: precise, plan: plan(sharing: true), running: false, required: true)
        return AnyView(LocationRequiredView(sharing: sharing))
    }

    @MainActor private static func card(_ status: CLAuthorizationStatus, running: Bool, plan: LocationPlan, sent: Date? = nil) -> AnyView {
        let sharing = LocationSharing(preview: status, plan: plan, running: running, lastSentAt: sent)
        return AnyView(
            NeonScroll(spacing: NeonSpace.stack) {
                LocationSharingCard(sharing: sharing)
            }
            .neonAmbientBackground()
        )
    }

    private static func plan(sharing: Bool) -> LocationPlan {
        let today = Calendar.current.startOfDay(for: Date())
        let start = today.addingTimeInterval(11 * 3600)
        let end = today.addingTimeInterval(19 * 3600)
        let iso = ISO8601DateFormatter()
        return LocationPlan(
            sharing: sharing,
            reason: sharing ? nil : "after-hours",
            startsAt: iso.string(from: start),
            endsAt: iso.string(from: end),
            nextStartsAt: iso.string(from: start.addingTimeInterval(sharing ? 86400 : 86400))
        )
    }
}

/// Fixed answers for the map: six people around an office in Amman.
@MainActor
final class TeamMapFixtureSource: TeamMapSource {
    private let open: Bool
    private let nobodyYet: Bool

    init(open: Bool = true, nobodyYet: Bool = false) {
        self.open = open
        self.nobodyYet = nobodyYet
    }

    func load() async throws -> TeamLocations {
        let iso = ISO8601DateFormatter()
        let now = Date()
        let today = Calendar.current.startOfDay(for: now)
        func ago(_ minutes: Double) -> String { iso.string(from: now.addingTimeInterval(-minutes * 60)) }
        func at(_ hour: Double) -> String { iso.string(from: today.addingTimeInterval(hour * 3600)) }
        let office = OfficeSpot(latitude: 31.9566, longitude: 35.8617)

        func person(_ id: String, _ name: String, _ role: String, _ state: String,
                    _ lat: Double? = nil, _ lng: Double? = nil, accuracy: Double? = nil, fixed: Double? = nil,
                    atOffice: Bool? = nil, metres: Double? = nil, permission: String = "always",
                    arrived: Double? = nil, departed: Double? = nil, precise: Bool = true) -> TeamLocationPerson {
            TeamLocationPerson(
                id: id, name: name, photoUrl: nil, role: role, state: open ? state : "closed",
                latitude: open && !nobodyYet ? lat : nil, longitude: open && !nobodyYet ? lng : nil,
                accuracy: open && !nobodyYet ? accuracy : nil, fixedAt: open && !nobodyYet ? fixed.map(ago) : nil,
                precise: precise, permission: permission, atOffice: open && !nobodyYet ? atOffice : nil,
                metresFromOffice: open && !nobodyYet ? metres : nil,
                arrivedAt: arrived.map(at), departedAt: departed.map(at)
            )
        }

        var people = [
            person("p1", "Layla Haddad", "Interior designer", "live", 31.95668, 35.86181, accuracy: 22, fixed: 0.5, atOffice: true, metres: 18, arrived: 10.95),
            person("p2", "Omar Khalil", "Site engineer", "live", 31.98402, 35.89711, accuracy: 35, fixed: 1.5, atOffice: false, metres: 4200, arrived: 11.05),
            person("p3", "Rana Saleh", "3D visualiser", "recent", 31.95702, 35.86139, accuracy: 60, fixed: 11, atOffice: true, metres: 52, arrived: 11.0),
            person("p4", "Yazan Nasser", "Draughtsman", "stale", 31.93915, 35.88402, accuracy: 120, fixed: 46, atOffice: false, metres: 2600, arrived: 11.2, precise: false),
            person("p5", "Dana Qasem", "Project coordinator", "off", permission: "denied", arrived: 10.9),
            person("p6", "Kareem Faris", "Junior designer", "waiting", arrived: 11.3),
        ]
        if nobodyYet {
            people = people.map { p in
                TeamLocationPerson(id: p.id, name: p.name, photoUrl: nil, role: p.role, state: p.state == "off" ? "off" : "waiting",
                                   latitude: nil, longitude: nil, accuracy: nil, fixedAt: nil, precise: true, permission: p.permission,
                                   atOffice: nil, metresFromOffice: nil, arrivedAt: p.arrivedAt, departedAt: nil)
            }
        }
        return TeamLocations(
            open: open,
            startsAt: at(11),
            endsAt: at(19),
            nextStartsAt: open ? iso.string(from: today.addingTimeInterval(35 * 3600)) : at(11 + 24),
            office: office,
            people: people,
            required: true
        )
    }

    func askForFreshPositions() async {}

    func setOffice(_ coordinate: CLLocationCoordinate2D?) async throws -> OfficeSpot? {
        coordinate.map { OfficeSpot(latitude: $0.latitude, longitude: $0.longitude) }
    }

    func setRequired(_ required: Bool) async throws -> Bool { required }
}

private struct HomeTeamMapFixtureHost: View {
    @StateObject private var model = TeamMapModel(source: TeamMapFixtureSource())

    var body: some View {
        NeonScroll(spacing: NeonSpace.stack) {
            if model.data != nil {
                HomeTeamMapCard(model: model, onOpen: {})
            }
        }
        .neonAmbientBackground()
        .task { await model.load() }
    }
}
#endif
