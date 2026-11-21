import SwiftUI
import WidgetKit

// Where the team is: `team/locations`, the manager's map, as a glance —
// how many are at the office, how many phones are sending a position, and
// each person's state as the server read it. A state says what a phone or the
// fingerprint device reported, never whether somebody is working.

struct TeamPlace: Decodable {
    let open: Bool
    let people: [Person]

    struct Person: Decodable {
        let id: String
        let name: String
        let state: String
        let atOffice: Bool?
        let arrivedAt: String?
        let departedAt: String?
    }
}

struct TeamMapProvider: TimelineProvider {
    typealias Entry = NeonEntry<TeamPlace>

    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), loaded: .ready(.sample), context: WidgetShare.read())
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        if context.isPreview { return completion(placeholder(in: context)) }
        Task { completion(await entry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        Task { completion(timeline(await entry())) }
    }

    private func entry() async -> Entry {
        let (loaded, context) = await load(side: "admin") { try await WidgetAPI.read("team/locations", as: TeamPlace.self) }
        return Entry(date: Date(), loaded: loaded, context: context)
    }
}

extension TeamPlace {
    static let sample = TeamPlace(open: true, people: [
        Person(id: "1", name: "Wael", state: "live", atOffice: true, arrivedAt: nil, departedAt: nil),
        Person(id: "2", name: "Sally", state: "live", atOffice: false, arrivedAt: nil, departedAt: nil),
        Person(id: "3", name: "Salem", state: "waiting", atOffice: nil, arrivedAt: nil, departedAt: nil),
    ])

    var atOffice: Int { people.filter { $0.atOffice == true && Self.hasPosition($0.state) }.count }
    var sending: Int { people.filter { Self.hasPosition($0.state) }.count }

    static func hasPosition(_ state: String) -> Bool { ["live", "recent", "stale"].contains(state) }
}

extension TeamPlace.Person {
    func label(_ words: Words) -> String {
        if atOffice == true && TeamPlace.hasPosition(state) { return words.t("At the office", "بالمكتب") }
        switch state {
        case "live": return words.t("Live", "مباشر")
        case "recent": return words.t("A few minutes ago", "قبل دقائق")
        case "stale": return words.t("Old position", "موقع قديم")
        case "waiting": return words.t("Nothing sent yet", "ما وصل موقع")
        case "off": return words.t("Location off", "الموقع مطفي")
        case "clocked-out": return words.t("Clocked out", "بصم خروج")
        case "day-off": return words.t("Day off", "عطلة")
        default: return words.t("Outside hours", "خارج الدوام")
        }
    }

    var tint: Color {
        if atOffice == true && TeamPlace.hasPosition(state) { return Palette.green }
        switch state {
        case "live", "recent": return Palette.blue
        case "stale": return Palette.amber
        case "off": return Palette.red
        default: return Palette.grey
        }
    }
}

struct TeamMapWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "neon.team-map", provider: TeamMapProvider()) { entry in
            TeamMapView(entry: entry)
        }
        .configurationDisplayName("Team map · خريطة الفريق")
        .description("Where the team is, during working hours.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct TeamMapView: View {
    let entry: NeonEntry<TeamPlace>
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let words = entry.words
        Group {
            if case .ready(let place) = entry.loaded {
                content(place, words)
            } else {
                WidgetMessage(
                    title: words.t("Team map", "خريطة الفريق"),
                    symbol: "map.fill",
                    message: explain(entry.loaded, words, otherSide: words.t("The team map is the manager's.", "خريطة الفريق للمدير بس.")) ?? ""
                )
            }
        }
        .widgetURL(neonLink("/admin/team-map"))
        .neonWidget(words)
    }

    @ViewBuilder private func content(_ place: TeamPlace, _ words: Words) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            WidgetTitle(title: words.t("Team map", "خريطة الفريق"), symbol: "map.fill", tint: Palette.green)
            HStack(spacing: 10) {
                Figure(value: place.atOffice, label: words.t("at the office", "بالمكتب"), tint: Palette.green)
                Figure(value: place.sending, label: words.t("sending", "موقع واصل"), tint: Palette.blue)
                if family != .systemSmall {
                    Figure(value: place.people.count, label: words.t("on the team", "بالفريق"))
                }
            }
            if !place.open {
                Text(words.t("Outside working hours — nothing is shared.", "خارج الدوام — ما في مشاركة موقع."))
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Palette.muted)
                    .lineLimit(2)
            }
            if family != .systemSmall {
                let shown = Array(place.people.prefix(family == .systemLarge ? 10 : 2))
                VStack(alignment: .leading, spacing: family == .systemLarge ? 7 : 4) {
                    ForEach(shown, id: \.id) { person in
                        row(person, words)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .glassPane()
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func row(_ person: TeamPlace.Person, _ words: Words) -> some View {
        HStack(spacing: 7) {
            Circle().fill(person.tint).frame(width: 7, height: 7)
            Text(person.name)
                .font(.system(size: 12, weight: .semibold))
                .lineLimit(1)
            Spacer(minLength: 4)
            if family == .systemLarge, let arrived = WidgetDates.parse(person.arrivedAt) {
                Text(words.t("in", "دخل") + " " + WidgetDates.time(arrived, words))
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Palette.muted)
                    .lineLimit(1)
            }
            Text(person.label(words))
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(person.tint)
                .lineLimit(1)
        }
    }
}
