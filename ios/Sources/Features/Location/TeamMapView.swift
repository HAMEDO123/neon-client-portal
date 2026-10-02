import CoreLocation
import MapKit
import SwiftUI

// MARK: - The data behind the map

/// The team's positions, read again and again while a screen shows them.
@MainActor
final class TeamMapModel: ObservableObject {
    @Published private(set) var data: TeamLocations?
    @Published private(set) var errorMessage: String?
    @Published private(set) var readAt: Date?
    let source: TeamMapSource
    private var askedAt: Date?

    convenience init() {
        self.init(source: NetworkTeamMapSource.shared)
    }

    init(source: TeamMapSource) {
        self.source = source
    }

    func load() async {
        do {
            let fresh = try await source.load()
            if fresh != data {
                withNeonAnimation(.smooth) { data = fresh }
            }
            readAt = Date()
            errorMessage = nil
        } catch {
            // A failed read keeps what is on screen; only an empty screen
            // says why.
            if data == nil { errorMessage = error.localizedDescription }
        }
    }

    /// Reads every `seconds` until the calling task ends. With `askPhones`,
    /// also asks the phones whose position is old for a new one — on the way
    /// in and every two minutes after, during working hours only.
    func follow(every seconds: Double, askPhones: Bool) async {
        while !Task.isCancelled {
            await load()
            if askPhones, data?.open == true, askedAt.map({ Date().timeIntervalSince($0) >= 120 }) ?? true {
                askedAt = Date()
                await source.askForFreshPositions()
            }
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        }
    }

    func setOffice(_ coordinate: CLLocationCoordinate2D?) async throws {
        _ = try await source.setOffice(coordinate)
        await load()
    }

    func setRequired(_ required: Bool) async throws {
        _ = try await source.setRequired(required)
        await load()
    }
}

/// Place names for positions ("Abdoun, Amman"), from Apple, one at a time
/// and each spot only once — Apple allows a handful of these a minute.
@MainActor
final class TeamMapPlaces: ObservableObject {
    @Published private(set) var names: [String: String] = [:]
    private var asked: Set<String> = []
    private var queue: [(String, CLLocation)] = []
    private var working = false
    private let geocoder = CLGeocoder()

    static func key(_ coordinate: CLLocationCoordinate2D) -> String {
        String(format: "%.3f,%.3f", coordinate.latitude, coordinate.longitude)
    }

    func name(for coordinate: CLLocationCoordinate2D) -> String? {
        names[Self.key(coordinate)]
    }

    func want(_ coordinates: [CLLocationCoordinate2D]) {
        for coordinate in coordinates {
            let key = Self.key(coordinate)
            guard !asked.contains(key) else { continue }
            asked.insert(key)
            queue.append((key, CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)))
        }
        next()
    }

    private func next() {
        guard !working, !queue.isEmpty else { return }
        working = true
        let (key, location) = queue.removeFirst()
        geocoder.reverseGeocodeLocation(location, preferredLocale: AppLanguage.current.locale) { [weak self] placemarks, _ in
            Task { @MainActor in
                guard let self else { return }
                if let place = placemarks?.first {
                    let parts = [place.subLocality ?? place.thoroughfare, place.locality].compactMap { $0 }
                    var seen: [String] = []
                    for part in parts where !seen.contains(part) { seen.append(part) }
                    if !seen.isEmpty { self.names[key] = seen.joined(separator: L(", ")) }
                }
                self.working = false
                self.next()
            }
        }
    }
}

// MARK: - The screen

/// Where the team is, now: everybody's latest position on a map, and the
/// list of everybody underneath — including whoever has no position, and
/// why, in the words of what their phone or the fingerprint device said.
/// Working hours only (the server shares nothing outside them); the
/// manager's alone. Pushed from Home and More, so no stack of its own.
struct TeamMapView: View {
    @StateObject private var model: TeamMapModel
    @StateObject private var places = TeamMapPlaces()
    @Environment(\.scenePhase) private var scenePhase

    @State private var selection: String?
    @State private var fitToken = 0
    @State private var placingOffice = false
    @State private var mapCenter: CLLocationCoordinate2D?
    @State private var removingOffice = false
    @State private var savingOffice = false

    @MainActor init() {
        self.init(source: NetworkTeamMapSource.shared)
    }

    /// The same screen over another source — Debug screenshots draw their
    /// own, and may open with somebody already chosen.
    init(source: TeamMapSource, selection: String? = nil) {
        _model = StateObject(wrappedValue: TeamMapModel(source: source))
        _selection = State(initialValue: selection)
    }

    private var people: [TeamLocationPerson] { model.data?.people ?? [] }
    private var selected: TeamLocationPerson? { people.first { $0.id == selection } }

    var body: some View {
        GeometryReader { proxy in
            let panelHeight = min(380, max(250, proxy.size.height * 0.42))
            ZStack(alignment: .bottom) {
                TeamMapCanvas(
                    people: model.data?.onMap ?? [],
                    office: model.data?.office,
                    selection: $selection,
                    fitToken: fitToken,
                    bottomInset: placingOffice ? 120 : panelHeight,
                    onCenterChange: { mapCenter = $0 }
                )
                .ignoresSafeArea(edges: .bottom)

                if placingOffice {
                    officeCrosshair
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(.bottom, 120)
                        .allowsHitTesting(false)
                    officeBar
                        .transition(.neonSlideUp)
                } else {
                    panel(height: panelHeight)
                        .transition(.neonSlideUp)
                }
            }
            .overlay(alignment: .top) { topNote.padding(.horizontal, NeonSpace.gutter).padding(.top, 8) }
        }
        .navigationTitle(L("Team map"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { menu }
        }
        .animation(NeonMotion.resolved(NeonMotion.smooth), value: placingOffice)
        .animation(NeonMotion.resolved(NeonMotion.smooth), value: selection)
        // Read every 15 s while the map is in front and the app is active;
        // the phones with an old position are asked for a new one.
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            await model.follow(every: 15, askPhones: true)
        }
        .onChange(of: model.data?.onMap.compactMap(\.coordinate).map(TeamMapPlaces.key) ?? []) { _ in
            places.want((model.data?.onMap ?? []).compactMap(\.coordinate))
        }
        .onAppear {
            places.want((model.data?.onMap ?? []).compactMap(\.coordinate))
        }
        .confirmDestructive(
            L("Remove the office location?"),
            message: L("The map stops showing who is at the office. Positions are not affected."),
            actionTitle: L("Remove"),
            isPresented: $removingOffice
        ) {
            Task { await saveOffice(nil) }
        }
    }

    // MARK: Top

    @ViewBuilder
    private var topNote: some View {
        if let data = model.data, !data.open {
            StatusNote(symbol: "moon.zzz.fill", tone: .info, title: L("Outside working hours"), detail: closedDetail(data))
                .neonShadow(.card)
                .transition(.neonDrop)
        } else if let errorMessage = model.errorMessage, model.data == nil {
            StatusNote(symbol: "wifi.exclamationmark", tone: .warning, title: L("The team map isn't available"), detail: errorMessage)
                .neonShadow(.card)
        } else if let data = model.data, data.open, data.onMap.isEmpty, !placingOffice {
            StatusNote(
                symbol: "location.magnifyingglass",
                tone: .info,
                title: L("No positions yet"),
                detail: L("A phone shares its position once NEON has location turned on during working hours. The phones have been asked.")
            )
            .neonShadow(.card)
            .transition(.neonDrop)
        }
    }

    private func closedDetail(_ data: TeamLocations) -> String {
        if let starts = data.starts, let ends = data.ends, let next = data.nextStart, Calendar.current.isDateInToday(next) {
            return L("Positions show from %@ to %@ on working days. Nothing is shared outside them.", locationClock(starts), locationClock(ends))
        }
        if let next = data.nextStart {
            return L("Positions show again %@. Nothing is shared outside working hours.", locationClock(next))
        }
        return L("Positions show during working hours only.")
    }

    // MARK: The panel

    private func panel(height: CGFloat) -> some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Color.neonLineStrong)
                .frame(width: 36, height: 5)
                .padding(.top, 8)
                .padding(.bottom, 6)
            if let selected {
                TeamMapPersonDetail(
                    person: selected,
                    place: selected.coordinate.flatMap(places.name(for:)),
                    onClose: { selection = nil }
                )
                .padding(.horizontal, NeonSpace.gutter)
                .padding(.bottom, NeonSpace.md)
                .transition(.opacity)
            } else {
                summary
                    .padding(.horizontal, NeonSpace.gutter)
                    .padding(.bottom, NeonSpace.sm)
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(people.enumerated()), id: \.element.id) { index, person in
                            Button {
                                Haptic.selection()
                                selection = person.id
                            } label: {
                                TeamMapRow(person: person, place: person.coordinate.flatMap(places.name(for:)))
                            }
                            .buttonStyle(.pressable)
                            if index < people.count - 1 {
                                NeonDivider().padding(.leading, 76)
                            }
                        }
                        if model.data == nil && model.errorMessage == nil {
                            SkeletonRows(count: 3)
                        }
                    }
                    .padding(.horizontal, NeonSpace.gutter)
                    .padding(.bottom, NeonSpace.lg)
                }
            }
        }
        .frame(height: selected == nil ? height : nil)
        .frame(maxWidth: .infinity)
        .background(
            UnevenTopRoundedRectangle(radius: NeonRadius.xl)
                .fill(Color.white)
                .shadow(color: Color.neonShadowTint.opacity(0.16), radius: 18, y: -4)
                .ignoresSafeArea(edges: .bottom)
        )
    }

    private var summary: some View {
        let counts = TeamMapCounts(people)
        return HStack(spacing: 8) {
            if model.data?.open == false {
                TeamMapChip(text: L("Working hours only"), hue: .grey)
            } else {
                TeamMapChip(text: L("%d on the map", counts.onMap), hue: .green)
                if counts.off > 0 { TeamMapChip(text: L("%d location off", counts.off), hue: .red) }
                if counts.waiting > 0 { TeamMapChip(text: L("%d no position yet", counts.waiting), hue: .grey) }
            }
            Spacer(minLength: 0)
            if let readAt = model.readAt {
                Text(locationAgo(readAt))
                    .font(.neonMeta)
                    .foregroundStyle(Color.neonTextTertiary)
            }
        }
    }

    // MARK: The office

    private var menu: some View {
        Menu {
            Button {
                fitToken += 1
            } label: {
                Label(L("Show everybody"), systemImage: "person.3.fill")
            }
            Button {
                selection = nil
                placingOffice = true
            } label: {
                Label(model.data?.office == nil ? L("Set the office location") : L("Move the office location"), systemImage: "building.2.fill")
            }
            if model.data?.office != nil {
                Button(role: .destructive) {
                    removingOffice = true
                } label: {
                    Label(L("Remove the office location"), systemImage: "trash")
                }
            }
            Divider()
            // Whether the team can use the app without allowing location.
            Toggle(isOn: Binding(
                get: { model.data?.required ?? true },
                set: { value in Task { await saveRequired(value) } }
            )) {
                Label(L("Location required for the team"), systemImage: "lock.fill")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.system(size: 17, weight: .semibold))
        }
        .accessibilityLabel(Text(L("Map options")))
    }

    private var officeCrosshair: some View {
        VStack(spacing: 0) {
            TeamOfficePin()
            TeamMapPinPoint()
                .fill(Color.neonIndigoStrong)
                .frame(width: 12, height: 8)
        }
        .offset(y: -24)
    }

    private var officeBar: some View {
        VStack(alignment: .leading, spacing: NeonSpace.md) {
            Text(L("Move the map until the pin is on the office"))
                .font(.neonHeadline)
                .foregroundStyle(Color.neonText)
            Text(L("Somebody within about 150 m of it shows as at the office."))
                .font(.neonSubtitle)
                .foregroundStyle(Color.neonTextSecondary)
            HStack(spacing: NeonSpace.md) {
                NeonButton(L("Cancel"), kind: .secondary, size: .medium, fullWidth: true) {
                    placingOffice = false
                }
                NeonButton(L("Set office here"), symbol: "checkmark", size: .medium, fullWidth: true, isLoading: savingOffice) {
                    guard let mapCenter else { return }
                    await saveOffice(mapCenter)
                }
            }
        }
        .padding(NeonSpace.card)
        .padding(.bottom, NeonSpace.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            UnevenTopRoundedRectangle(radius: NeonRadius.xl)
                .fill(Color.white)
                .shadow(color: Color.neonShadowTint.opacity(0.16), radius: 18, y: -4)
                .ignoresSafeArea(edges: .bottom)
        )
    }

    private func saveRequired(_ required: Bool) async {
        do {
            try await model.setRequired(required)
            Haptic.success()
            Toast.success(required ? L("Location is required for the team") : L("Location is no longer required"),
                          detail: required ? L("Phones without it can't open the app until they allow it.") : nil)
        } catch {
            Toast.error(error)
        }
    }

    private func saveOffice(_ coordinate: CLLocationCoordinate2D?) async {
        savingOffice = true
        defer { savingOffice = false }
        do {
            try await model.setOffice(coordinate)
            Haptic.success()
            Toast.success(coordinate == nil ? L("Office location removed") : L("Office location saved"))
            placingOffice = false
        } catch {
            Toast.error(error)
        }
    }
}

// MARK: - Pieces

/// How many are where, for the chips and Home's line.
struct TeamMapCounts {
    let onMap: Int
    let off: Int
    let waiting: Int
    let atOffice: Int

    init(_ people: [TeamLocationPerson]) {
        onMap = people.filter { $0.coordinate != nil }.count
        off = people.filter { $0.state == "off" }.count
        waiting = people.filter { $0.state == "waiting" }.count
        atOffice = people.filter { $0.atOffice == true && $0.coordinate != nil }.count
    }
}

struct TeamMapChip: View {
    let text: String
    let hue: NeonHue

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(hue.color).frame(width: 7, height: 7)
            Text(text)
                .font(.neonCaption.weight(.semibold))
                .foregroundStyle(hue == .grey ? Color.neonTextSecondary : hue.deep)
                .lineLimit(1)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(Capsule().fill(hue.wash))
    }
}

/// One person in the list: face, name, and what is known — where, and how
/// long ago; or why there is no position.
struct TeamMapRow: View {
    let person: TeamLocationPerson
    let place: String?

    var body: some View {
        HStack(spacing: 12) {
            TeamMapFace(person: person, size: 46)
            VStack(alignment: .leading, spacing: 3) {
                DirText(person.name, font: .neonRowTitle, lineLimit: 1)
                Text(teamMapStatus(person, place: place))
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextSecondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            if person.coordinate != nil {
                Image(systemName: "location.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(teamMapHue(person.state).deep)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(teamMapHue(person.state).wash))
            }
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// A face with its state's ring.
struct TeamMapFace: View {
    let person: TeamLocationPerson
    var size: CGFloat = 46

    var body: some View {
        AvatarView(url: facePhotoURL(person.photoUrl), name: person.name, size: size - 6, style: .solid)
            .padding(3)
            .overlay(Circle().strokeBorder(teamMapHue(person.state).color, lineWidth: 2.5))
            .opacity(person.coordinate == nil && person.state != "off" ? 0.75 : 1)
    }
}

/// What the list says about somebody — a fact, never a verdict: "No
/// position yet" is what the phone has (not) sent, never that they are not
/// working.
func teamMapStatus(_ person: TeamLocationPerson, place: String?, now: Date = Date()) -> String {
    let ago = person.fixed.map { locationAgo($0, now: now) }
    var whereText: String {
        if person.atOffice == true { return L("At the office") }
        if let metres = person.metresFromOffice { return L("%@ from the office", locationDistance(metres)) }
        return place ?? L("On the map")
    }
    switch person.state {
    case "live", "recent":
        return [whereText, ago].compactMap { $0 }.joined(separator: " · ")
    case "stale":
        return [ago.map { L("Last position %@", $0) }, whereText].compactMap { $0 }.joined(separator: " · ")
    case "off":
        if let ago { return L("Location turned off · last position %@", ago) }
        return L("Location is off on their phone")
    case "waiting":
        if let arrived = person.arrived { return L("No position yet · clocked in %@", locationClock(arrived)) }
        return L("No position yet today")
    case "clocked-out":
        if let departed = person.departed { return L("Clocked out at %@ · not shared after that", locationClock(departed)) }
        return L("Clocked out · not shared after that")
    case "day-off":
        return L("Day off")
    default:
        return L("Shared during working hours only")
    }
}

/// The selected person: who, where, how sure, and the two things to do.
struct TeamMapPersonDetail: View {
    let person: TeamLocationPerson
    let place: String?
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.md) {
            HStack(spacing: 12) {
                TeamMapFace(person: person, size: 56)
                VStack(alignment: .leading, spacing: 3) {
                    DirText(person.name, font: .neonHeadline, lineLimit: 1)
                    if let role = person.role, !role.isEmpty {
                        DirText(role, font: .neonSubtitle, color: .neonTextSecondary, lineLimit: 1)
                    }
                }
                Spacer(minLength: 8)
                IconButton("xmark", label: L("Close"), size: 34) { onClose() }
            }
            VStack(alignment: .leading, spacing: 6) {
                MetaLabel(teamMapStatus(person, place: place), symbol: "location.fill")
                if let place, person.atOffice == true || person.metresFromOffice != nil {
                    MetaLabel(place, symbol: "mappin.and.ellipse")
                }
                if let accuracy = person.accuracy {
                    MetaLabel(L("Accurate to about %@", locationDistance(accuracy)), symbol: "scope")
                }
                if person.precise == false {
                    MetaLabel(L("Precise Location is off on this phone"), symbol: "exclamationmark.circle")
                }
            }
            HStack(spacing: NeonSpace.md) {
                NeonButton(L("Message"), symbol: "bubble.left.fill", kind: .secondary, size: .medium, fullWidth: true) {
                    PushCenter.shared.pendingPath = "/admin/chat/\(person.id)"
                }
                NeonButton(L("Directions"), symbol: "arrow.triangle.turn.up.right.diamond.fill", size: .medium, fullWidth: true) {
                    openDirections()
                }
                .disabled(person.coordinate == nil)
            }
        }
    }

    private func openDirections() {
        guard let coordinate = person.coordinate else { return }
        let item = MKMapItem(placemark: MKPlacemark(coordinate: coordinate))
        item.name = person.name
        item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving])
    }
}

/// A panel's shape: round at the top, square at the bottom edge of the screen.
struct UnevenTopRoundedRectangle: Shape {
    let radius: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
        path.addArc(center: CGPoint(x: rect.minX + radius, y: rect.minY + radius), radius: radius,
                    startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        path.addLine(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
        path.addArc(center: CGPoint(x: rect.maxX - radius, y: rect.minY + radius), radius: radius,
                    startAngle: .degrees(270), endAngle: .degrees(0), clockwise: false)
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}
