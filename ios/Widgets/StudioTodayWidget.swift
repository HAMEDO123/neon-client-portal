import SwiftUI
import WidgetKit

// Today's tasks for the whole studio: `home/today`, the Home tab's "Today's
// Tasks" — board steps due today, jobs running today and meetings starting
// today, with who has each. Only what the calendar really holds: a quiet day
// says so.

struct StudioToday: Decodable {
    let dayKey: String
    let items: [Item]

    struct Item: Decodable {
        let kind: String
        let id: String
        let title: String
        let projectName: String?
        let person: Person?
        let state: String?
        let priority: String?
        let at: String?
    }

    struct Person: Decodable { let name: String }
}

struct StudioTodayProvider: TimelineProvider {
    typealias Entry = NeonEntry<StudioToday>

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
        let (loaded, context) = await load(side: "admin") { try await WidgetAPI.read("home/today", as: StudioToday.self) }
        return Entry(date: Date(), loaded: loaded, context: context)
    }
}

extension StudioToday {
    static let sample = StudioToday(dayKey: "", items: [
        Item(kind: "job", id: "1", title: "Marble samples for the client", projectName: nil, person: Person(name: "Wael"), state: "IN_PROGRESS", priority: "HIGH", at: nil),
        Item(kind: "cell", id: "2", title: "Working drawings", projectName: "Villa", person: Person(name: "Sally"), state: "TODO", priority: "MEDIUM", at: nil),
    ])

    var work: [Item] { items.filter { $0.kind != "meeting" } }
    var done: Int { work.filter { $0.state == "DONE" }.count }
    var review: Int { work.filter { $0.state == "SUBMITTED" }.count }
    var meetings: Int { items.filter { $0.kind == "meeting" }.count }

    /// Still to do first — high priority at the top — then what is with the
    /// manager, then what is finished.
    var ordered: [Item] {
        func rank(_ item: Item) -> Int {
            switch item.state {
            case "DONE": return 3
            case "SUBMITTED": return 2
            default: return item.priority == "HIGH" ? 0 : 1
            }
        }
        return items.enumerated().sorted { a, b in
            let (ra, rb) = (rank(a.element), rank(b.element))
            return ra != rb ? ra < rb : a.offset < b.offset
        }.map(\.element)
    }
}

func stateWord(_ state: String?, _ words: Words) -> (String, Color) {
    switch state {
    case "DONE": return (words.t("Done", "تم"), Palette.green)
    case "SUBMITTED": return (words.t("For review", "للمراجعة"), Palette.purple)
    case "IN_PROGRESS": return (words.t("In progress", "قيد التنفيذ"), Palette.blue)
    case "REJECTED": return (words.t("Rejected", "مرفوض"), Palette.red)
    case "TOMORROW": return (words.t("Tomorrow", "بكرة"), Palette.muted)
    default: return (words.t("To do", "للتنفيذ"), Palette.muted)
    }
}

struct StudioTodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "neon.studio-today", provider: StudioTodayProvider()) { entry in
            StudioTodayView(entry: entry)
        }
        .configurationDisplayName("Today's tasks · مهام اليوم")
        .description("The studio's work for today, and who has each task.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct StudioTodayView: View {
    let entry: NeonEntry<StudioToday>
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let words = entry.words
        Group {
            if case .ready(let today) = entry.loaded {
                content(today, words)
            } else {
                WidgetMessage(
                    title: words.t("Today's tasks", "مهام اليوم"),
                    symbol: "checklist",
                    message: explain(entry.loaded, words, otherSide: words.t("This is the manager's widget. Add “My tasks” instead.", "هاد للمدير. ضيف ويدجت «مهامي» بداله.")) ?? ""
                )
            }
        }
        .widgetURL(neonLink("/admin/tasks"))
        .neonWidget(words)
    }

    @ViewBuilder private func content(_ today: StudioToday, _ words: Words) -> some View {
        VStack(alignment: .leading, spacing: family == .systemSmall ? 6 : 8) {
            WidgetTitle(title: words.t("Today's tasks", "مهام اليوم"), symbol: "checklist")
            HStack(spacing: 10) {
                Figure(value: today.work.count - today.done, label: words.t("still open", "لسا مفتوحة"), tint: Palette.purple)
                Figure(value: today.done, label: words.t("done", "تمّت"), tint: Palette.green)
                if family != .systemSmall {
                    Figure(value: today.review, label: words.t("for review", "للمراجعة"), tint: Palette.blue)
                    Figure(value: today.meetings, label: words.t("meetings", "اجتماعات"))
                }
            }
            if today.items.isEmpty {
                Text(words.t("Nothing on the calendar today.", "ما في إشي على جدول اليوم."))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Palette.muted)
            } else if family != .systemSmall {
                VStack(alignment: .leading, spacing: family == .systemLarge ? 7 : 4) {
                    ForEach(Array(today.ordered.prefix(family == .systemLarge ? 9 : 3)), id: \.id) { item in
                        row(item, words)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func row(_ item: StudioToday.Item, _ words: Words) -> some View {
        let (word, tint) = stateWord(item.state, words)
        return HStack(spacing: 7) {
            Circle()
                .fill(item.priority == "HIGH" && item.state != "DONE" ? Palette.red : tint)
                .frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 0) {
                Text(item.title)
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
                if family == .systemLarge, let name = item.person?.name ?? item.projectName {
                    Text(name)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(Palette.muted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            if item.kind == "meeting", let at = WidgetDates.parse(item.at) {
                Text(WidgetDates.time(at, words))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Palette.muted)
            } else {
                if family == .systemMedium, let name = item.person?.name {
                    Text(name)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(Palette.muted)
                        .lineLimit(1)
                }
                Text(word)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(tint)
                    .lineLimit(1)
            }
        }
    }
}
