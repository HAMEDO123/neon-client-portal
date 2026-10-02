import MapKit
import SwiftUI
import UIKit

/// The map under the team: Apple's map with a face for everybody whose phone
/// has sent a position today, a soft circle for how sure that position is,
/// and the office. MKMapView rather than SwiftUI's `Map`, which on iOS 16
/// can neither draw these pins nor move them smoothly as people move.
///
/// Faces glide to their new place when a newer position arrives; the map
/// fits everybody the first time it has anyone, and again whenever
/// `fitToken` changes — never on its own after the manager has moved it.
struct TeamMapCanvas: UIViewRepresentable {
    let people: [TeamLocationPerson]
    let office: OfficeSpot?
    @Binding var selection: String?
    /// False for Home's small map: no gestures, so a tap reaches the card.
    var interactive = true
    /// Small pins — a face and its point, no name — for Home's small map.
    var compact = false
    /// Change it to fit everybody again.
    var fitToken = 0
    /// The panel over the bottom of the map, kept clear when fitting.
    var bottomInset: CGFloat = 0
    /// Where the middle of the map is, as the manager moves it (setting the office).
    var onCenterChange: ((CLLocationCoordinate2D) -> Void)?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.showsCompass = false
        map.showsScale = false
        map.isRotateEnabled = false
        map.isPitchEnabled = false
        map.pointOfInterestFilter = .excludingAll
        map.register(TeamPersonAnnotationView.self, forAnnotationViewWithReuseIdentifier: TeamPersonAnnotationView.reuse)
        map.register(TeamOfficeAnnotationView.self, forAnnotationViewWithReuseIdentifier: TeamOfficeAnnotationView.reuse)
        map.register(TeamClusterAnnotationView.self, forAnnotationViewWithReuseIdentifier: MKMapViewDefaultClusterAnnotationViewReuseIdentifier)
        map.isUserInteractionEnabled = interactive
        // Amman until there is anybody to show.
        map.setRegion(
            MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 31.95, longitude: 35.91),
                               span: MKCoordinateSpan(latitudeDelta: 0.18, longitudeDelta: 0.18)),
            animated: false
        )
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.sync(map)
    }

    // MARK: - Keeping the map in step

    @MainActor
    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: TeamMapCanvas
        private var pins: [String: TeamPersonAnnotation] = [:]
        private var circles: [String: TeamAccuracyCircle] = [:]
        private var officePin: TeamOfficeAnnotation?
        private var fittedToken: Int?
        private var shownSelection: String?

        init(_ parent: TeamMapCanvas) {
            self.parent = parent
        }

        func sync(_ map: MKMapView) {
            map.isUserInteractionEnabled = parent.interactive
            let current = Dictionary(parent.people.compactMap { person in person.coordinate.map { (person.id, (person, $0)) } },
                                     uniquingKeysWith: { first, _ in first })

            // Gone from the map.
            for (id, pin) in pins where current[id] == nil {
                map.removeAnnotation(pin)
                pins[id] = nil
            }

            // Arrived, moved or changed.
            for (id, (person, coordinate)) in current {
                if let pin = pins[id] {
                    let moved = pin.coordinate.latitude != coordinate.latitude || pin.coordinate.longitude != coordinate.longitude
                    pin.person = person
                    if moved {
                        UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.8) {
                            pin.coordinate = coordinate
                        }
                    }
                    (map.view(for: pin) as? TeamPersonAnnotationView)?.show(person, selected: parent.selection == id, compact: parent.compact)
                } else {
                    let pin = TeamPersonAnnotation(person: person, coordinate: coordinate)
                    pins[id] = pin
                    map.addAnnotation(pin)
                }
            }

            syncCircles(map, current)
            syncOffice(map)
            syncSelection(map)

            let anything = !pins.isEmpty || officePin != nil
            if anything, fittedToken != parent.fitToken {
                // Fitting a map that has no size yet zooms it to the street
                // (the padding is larger than the map): wait for its layout.
                guard map.bounds.width > 1, map.bounds.height > parent.bottomInset + 100 else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self, weak map] in
                        guard let self, let map else { return }
                        self.sync(map)
                    }
                    return
                }
                fittedToken = parent.fitToken
                fit(map, animated: map.window != nil && shownOnce)
                shownOnce = true
            }
        }

        private var shownOnce = false

        /// How sure each position is: a circle as wide as the phone said,
        /// only where that is wider than the face itself.
        private func syncCircles(_ map: MKMapView, _ current: [String: (TeamLocationPerson, CLLocationCoordinate2D)]) {
            for (id, circle) in circles {
                // A circle cannot move or change colour: a new one replaces it.
                if let (person, coordinate) = current[id], let accuracy = person.accuracy, accuracy > 40,
                   circle.coordinate.latitude == coordinate.latitude, circle.coordinate.longitude == coordinate.longitude,
                   circle.radius == min(accuracy, 5000), circle.state == person.state {
                    continue
                }
                map.removeOverlay(circle)
                circles[id] = nil
            }
            for (id, (person, coordinate)) in current where circles[id] == nil {
                guard let accuracy = person.accuracy, accuracy > 40 else { continue }
                let circle = TeamAccuracyCircle(center: coordinate, radius: min(accuracy, 5000))
                circle.state = person.state
                circles[id] = circle
                map.addOverlay(circle, level: .aboveRoads)
            }
        }

        private func syncOffice(_ map: MKMapView) {
            guard let office = parent.office else {
                if let officePin { map.removeAnnotation(officePin) }
                officePin = nil
                return
            }
            if let officePin {
                if officePin.coordinate.latitude != office.latitude || officePin.coordinate.longitude != office.longitude {
                    officePin.coordinate = office.coordinate
                }
            } else {
                let pin = TeamOfficeAnnotation(coordinate: office.coordinate)
                officePin = pin
                map.addAnnotation(pin)
            }
        }

        private func syncSelection(_ map: MKMapView) {
            guard parent.selection != shownSelection else { return }
            shownSelection = parent.selection
            for pin in pins.values {
                (map.view(for: pin) as? TeamPersonAnnotationView)?.show(pin.person, selected: pin.person.id == parent.selection, compact: parent.compact)
            }
            guard let id = parent.selection, let pin = pins[id] else { return }
            // Bring them into the part of the map the panel leaves visible,
            // close enough to see the street.
            let span = map.region.span.latitudeDelta > 0.03
                ? MKCoordinateSpan(latitudeDelta: 0.012, longitudeDelta: 0.012)
                : map.region.span
            var region = MKCoordinateRegion(center: pin.coordinate, span: span)
            let shift = parent.bottomInset / max(map.bounds.height, 1) * span.latitudeDelta / 2
            region.center.latitude -= shift
            map.setRegion(region, animated: true)
        }

        private func fit(_ map: MKMapView, animated: Bool) {
            let annotations: [MKAnnotation] = Array(pins.values) + (officePin.map { [$0] } ?? [])
            // Room for a whole pin around the edges: its face stands about
            // 60 pt above the spot it marks, its name about 26 pt below.
            let padding = parent.compact
                ? UIEdgeInsets(top: 46, left: 26, bottom: 14, right: 26)
                : UIEdgeInsets(top: 66, left: 46, bottom: parent.bottomInset + 32, right: 46)
            if annotations.count == 1, let only = annotations.first {
                let region = MKCoordinateRegion(center: only.coordinate, latitudinalMeters: 1200, longitudinalMeters: 1200)
                map.setVisibleMapRect(Self.rect(of: region), edgePadding: padding, animated: animated)
                return
            }
            var rect = MKMapRect.null
            for annotation in annotations {
                let point = MKMapPoint(annotation.coordinate)
                rect = rect.union(MKMapRect(x: point.x, y: point.y, width: 0, height: 0))
            }
            // Never closer than about 600 m across, so two people in one
            // building are not fitted to a single desk.
            let minimum = MKMapPointsPerMeterAtLatitude(rect.origin.coordinate.latitude) * 600
            if rect.size.width < minimum {
                rect = rect.insetBy(dx: -(minimum - rect.size.width) / 2, dy: 0)
            }
            if rect.size.height < minimum {
                rect = rect.insetBy(dx: 0, dy: -(minimum - rect.size.height) / 2)
            }
            map.setVisibleMapRect(rect, edgePadding: padding, animated: animated)
        }

        private static func rect(of region: MKCoordinateRegion) -> MKMapRect {
            let corner1 = MKMapPoint(CLLocationCoordinate2D(latitude: region.center.latitude + region.span.latitudeDelta / 2,
                                                            longitude: region.center.longitude - region.span.longitudeDelta / 2))
            let corner2 = MKMapPoint(CLLocationCoordinate2D(latitude: region.center.latitude - region.span.latitudeDelta / 2,
                                                            longitude: region.center.longitude + region.span.longitudeDelta / 2))
            return MKMapRect(x: min(corner1.x, corner2.x), y: min(corner1.y, corner2.y),
                             width: abs(corner1.x - corner2.x), height: abs(corner1.y - corner2.y))
        }

        // MARK: MKMapViewDelegate

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if let pin = annotation as? TeamPersonAnnotation {
                let view = mapView.dequeueReusableAnnotationView(withIdentifier: TeamPersonAnnotationView.reuse, for: pin) as? TeamPersonAnnotationView
                view?.show(pin.person, selected: pin.person.id == parent.selection, compact: parent.compact)
                return view
            }
            if annotation is TeamOfficeAnnotation {
                return mapView.dequeueReusableAnnotationView(withIdentifier: TeamOfficeAnnotationView.reuse, for: annotation)
            }
            if let cluster = annotation as? MKClusterAnnotation {
                let view = mapView.dequeueReusableAnnotationView(
                    withIdentifier: MKMapViewDefaultClusterAnnotationViewReuseIdentifier, for: cluster
                ) as? TeamClusterAnnotationView
                view?.show(cluster.memberAnnotations.compactMap { ($0 as? TeamPersonAnnotation)?.person }, compact: parent.compact)
                return view
            }
            return nil
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            guard let circle = overlay as? TeamAccuracyCircle else { return MKOverlayRenderer(overlay: overlay) }
            let renderer = MKCircleRenderer(circle: circle)
            let color = UIColor(teamMapHue(circle.state).color)
            renderer.fillColor = color.withAlphaComponent(0.12)
            renderer.strokeColor = color.withAlphaComponent(0.35)
            renderer.lineWidth = 1
            return renderer
        }

        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            // Selection is the panel's; the map only reports the tap.
            mapView.deselectAnnotation(view.annotation, animated: false)
            if let cluster = view.annotation as? MKClusterAnnotation {
                Haptic.selection()
                let members = cluster.memberAnnotations.compactMap { $0 as? TeamPersonAnnotation }
                // Close enough to see the street and they still overlap:
                // they are in one place, so the first of them is chosen.
                if mapView.region.span.latitudeDelta < 0.004, let first = members.first {
                    parent.selection = first.person.id
                } else {
                    mapView.showAnnotations(cluster.memberAnnotations, animated: true)
                }
                return
            }
            guard let pin = view.annotation as? TeamPersonAnnotation else { return }
            Haptic.selection()
            parent.selection = pin.person.id
        }

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            parent.onCenterChange?(mapView.centerCoordinate)
        }
    }
}

// MARK: - What is on the map

final class TeamPersonAnnotation: NSObject, MKAnnotation {
    @objc dynamic var coordinate: CLLocationCoordinate2D
    var person: TeamLocationPerson

    init(person: TeamLocationPerson, coordinate: CLLocationCoordinate2D) {
        self.person = person
        self.coordinate = coordinate
    }

    var title: String? { person.name }
}

final class TeamOfficeAnnotation: NSObject, MKAnnotation {
    @objc dynamic var coordinate: CLLocationCoordinate2D

    init(coordinate: CLLocationCoordinate2D) {
        self.coordinate = coordinate
    }

    var title: String? { L("Office") }
}

final class TeamAccuracyCircle: MKCircle {
    var state = "live"
}

/// A face on the map: the person's photo (or initials) in a white disc with
/// a ring in their state's colour, a point at the bottom on the exact spot,
/// and their first name under it.
final class TeamPersonAnnotationView: MKAnnotationView {
    static let reuse = "team-person"
    private static let size = CGSize(width: 96, height: 84)
    /// From the top of the view to the point of the pin.
    private static let tip: CGFloat = 58

    private var host: UIHostingController<TeamMapPin>?

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(origin: .zero, size: Self.size)
        backgroundColor = .clear
        canShowCallout = false
        centerOffset = CGPoint(x: 0, y: Self.size.height / 2 - Self.tip)
        collisionMode = .circle
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(_ person: TeamLocationPerson, selected: Bool, compact: Bool = false) {
        let pin = TeamMapPin(person: person, selected: selected, compact: compact)
        let size = compact ? TeamMapPin.compactSize : Self.size
        frame.size = size
        centerOffset = CGPoint(x: 0, y: size.height / 2 - (compact ? TeamMapPin.compactTip : Self.tip))
        if let host {
            host.rootView = pin
        } else {
            let host = UIHostingController(rootView: pin)
            host.view.backgroundColor = .clear
            host.view.isUserInteractionEnabled = false
            addSubview(host.view)
            self.host = host
        }
        host?.view.frame = bounds
        zPriority = selected ? .max : (person.state == "live" ? .defaultSelected : .defaultUnselected)
        // Faces that would cover each other become one pin with a count,
        // rather than one of them silently disappearing.
        clusteringIdentifier = selected ? nil : "team"
        accessibilityLabel = person.name
    }
}

/// Several people in one spot: their faces overlapping, and how many.
final class TeamClusterAnnotationView: MKAnnotationView {
    private static let size = CGSize(width: 110, height: 84)
    private static let tip: CGFloat = 58
    private var host: UIHostingController<TeamMapClusterPin>?

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(origin: .zero, size: Self.size)
        backgroundColor = .clear
        canShowCallout = false
        centerOffset = CGPoint(x: 0, y: Self.size.height / 2 - Self.tip)
        collisionMode = .circle
        displayPriority = .required
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(_ people: [TeamLocationPerson], compact: Bool = false) {
        let pin = TeamMapClusterPin(people: people, compact: compact)
        let size = compact ? TeamMapClusterPin.compactSize : Self.size
        frame.size = size
        centerOffset = CGPoint(x: 0, y: size.height / 2 - (compact ? TeamMapPin.compactTip : Self.tip))
        if let host {
            host.rootView = pin
        } else {
            let host = UIHostingController(rootView: pin)
            host.view.backgroundColor = .clear
            host.view.isUserInteractionEnabled = false
            addSubview(host.view)
            self.host = host
        }
        host?.view.frame = bounds
        accessibilityLabel = people.map(\.name).joined(separator: ", ")
    }
}

final class TeamOfficeAnnotationView: MKAnnotationView {
    static let reuse = "team-office"

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        let size = CGSize(width: 40, height: 40)
        frame = CGRect(origin: .zero, size: size)
        backgroundColor = .clear
        canShowCallout = false
        displayPriority = .required
        zPriority = .min
        let host = UIHostingController(rootView: TeamOfficePin())
        host.view.backgroundColor = .clear
        host.view.frame = bounds
        host.view.isUserInteractionEnabled = false
        addSubview(host.view)
        accessibilityLabel = L("Office")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
}

// MARK: - The pins, drawn in SwiftUI

struct TeamMapPin: View {
    let person: TeamLocationPerson
    let selected: Bool
    var compact = false

    static let compactSize = CGSize(width: 40, height: 44)
    static let compactTip: CGFloat = 42

    var body: some View {
        if compact { small } else { full }
    }

    private var small: some View {
        let hue = teamMapHue(person.state)
        return VStack(spacing: 0) {
            ZStack {
                Circle().fill(Color.white).frame(width: 36, height: 36)
                AvatarView(url: facePhotoURL(person.photoUrl), name: person.name, size: 30, style: .solid)
                    .saturation(person.state == "stale" ? 0.35 : 1)
                Circle().strokeBorder(hue.color, lineWidth: 2.5).frame(width: 36, height: 36)
            }
            .shadow(color: Color.neonShadowTint.opacity(0.28), radius: 4, y: 2)
            TeamMapPinPoint().fill(hue.color).frame(width: 9, height: 6)
        }
        .frame(width: Self.compactSize.width, height: Self.compactSize.height, alignment: .top)
    }

    private var full: some View {
        let hue = teamMapHue(person.state)
        return VStack(spacing: 0) {
            ZStack {
                Circle()
                    .fill(Color.white)
                    .frame(width: 52, height: 52)
                AvatarView(url: facePhotoURL(person.photoUrl), name: person.name, size: 44, style: .solid)
                    .saturation(person.state == "stale" ? 0.35 : 1)
                Circle()
                    .strokeBorder(hue.color, lineWidth: selected ? 3.5 : 3)
                    .frame(width: 52, height: 52)
            }
            .shadow(color: Color.neonShadowTint.opacity(0.28), radius: 6, y: 3)
            TeamMapPinPoint()
                .fill(hue.color)
                .frame(width: 12, height: 7)
            Text(firstName)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.neonInk)
                .lineLimit(1)
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(Capsule().fill(Color.white.opacity(0.94)))
                .shadow(color: Color.neonShadowTint.opacity(0.18), radius: 3, y: 1)
                .padding(.top, 3)
        }
        .scaleEffect(selected ? 1.12 : 1, anchor: UnitPoint(x: 0.5, y: 58 / 84))
        .frame(width: 96, height: 84, alignment: .top)
    }

    private var firstName: String {
        person.name.split(separator: " ").first.map(String.init) ?? person.name
    }
}

struct TeamMapClusterPin: View {
    let people: [TeamLocationPerson]
    var compact = false

    static let compactSize = CGSize(width: 72, height: 44)

    var body: some View {
        if compact { small } else { full }
    }

    private var small: some View {
        let hue = teamMapHue(bestState)
        let width = 36 + CGFloat(min(people.count, 3) - 1) * 14
        return VStack(spacing: 0) {
            ZStack {
                Capsule().fill(Color.white).frame(width: width, height: 36)
                HStack(spacing: -16) {
                    ForEach(people.prefix(3)) { person in
                        AvatarView(url: facePhotoURL(person.photoUrl), name: person.name, size: 30, ring: true, style: .solid)
                    }
                }
                Capsule().strokeBorder(hue.color, lineWidth: 2.5).frame(width: width, height: 36)
            }
            .overlay(alignment: .topTrailing) {
                Text(verbatim: "\(people.count)")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(minWidth: 17, minHeight: 17)
                    .background(Circle().fill(hue.deep))
                    .overlay(Circle().strokeBorder(Color.white, lineWidth: 1.5))
                    .offset(x: 5, y: -5)
            }
            .shadow(color: Color.neonShadowTint.opacity(0.28), radius: 4, y: 2)
            TeamMapPinPoint().fill(hue.color).frame(width: 9, height: 6)
        }
        .frame(width: Self.compactSize.width, height: Self.compactSize.height, alignment: .top)
    }

    /// The freshest state of the group colours its ring.
    private var bestState: String {
        let order = ["live", "recent", "stale", "off"]
        return people.map(\.state).min { (order.firstIndex(of: $0) ?? 9) < (order.firstIndex(of: $1) ?? 9) } ?? "live"
    }

    private var full: some View {
        let hue = teamMapHue(bestState)
        return VStack(spacing: 0) {
            ZStack {
                Capsule()
                    .fill(Color.white)
                    .frame(width: 52 + CGFloat(min(people.count, 3) - 1) * 22, height: 52)
                HStack(spacing: -22) {
                    ForEach(people.prefix(3)) { person in
                        AvatarView(url: facePhotoURL(person.photoUrl), name: person.name, size: 44, ring: true, style: .solid)
                    }
                }
                Capsule()
                    .strokeBorder(hue.color, lineWidth: 3)
                    .frame(width: 52 + CGFloat(min(people.count, 3) - 1) * 22, height: 52)
            }
            .overlay(alignment: .topTrailing) {
                Text(verbatim: "\(people.count)")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(minWidth: 22, minHeight: 22)
                    .background(Circle().fill(hue.deep))
                    .overlay(Circle().strokeBorder(Color.white, lineWidth: 2))
                    .offset(x: 6, y: -6)
            }
            .shadow(color: Color.neonShadowTint.opacity(0.28), radius: 6, y: 3)
            TeamMapPinPoint()
                .fill(hue.color)
                .frame(width: 12, height: 7)
            Text(people.map { $0.name.split(separator: " ").first.map(String.init) ?? $0.name }.joined(separator: L(", ")))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.neonInk)
                .lineLimit(1)
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(Capsule().fill(Color.white.opacity(0.94)))
                .shadow(color: Color.neonShadowTint.opacity(0.18), radius: 3, y: 1)
                .padding(.top, 3)
                .frame(maxWidth: 110)
        }
        .frame(width: 110, height: 84, alignment: .top)
    }
}

struct TeamMapPinPoint: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

struct TeamOfficePin: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .fill(LinearGradient.neonBrand)
            Image(systemName: "building.2.fill")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.white)
        }
        .frame(width: 36, height: 36)
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(Color.white, lineWidth: 2))
        .shadow(color: Color.neonShadowTint.opacity(0.3), radius: 5, y: 2)
        .frame(width: 40, height: 40)
    }
}

/// One colour per state, the same on the map, the list and Home.
func teamMapHue(_ state: String) -> NeonHue {
    switch state {
    case "live": return .green
    case "recent": return .amber
    case "off": return .red
    case "clocked-out": return .indigo
    default: return .grey
    }
}
