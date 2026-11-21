import SwiftUI
import WidgetKit

// The team's own tasks: `me/tasks/mine`, the same list the Tasks tab narrows.
// The numbers follow the tab's buttons (TaskListFilter.swift): open is what is
// still theirs to do and not late; late has its own number; sent for review
// is the manager's move. The rows are what is open, the jobs handed to them
// first, as the tab lists them.

struct MyTasks: Decodable {
    let todayKey: String
    let tasks: [Step]
    let jobs: [Job]

    struct Step: Decodable {
        let id: String
        let state: String
        let priority: String?
        let dueKey: String?
        let late: Bool?
        let task: Name
        let project: Name?
    }

    struct Job: Decodable {
        let id: String
        let title: String
        let state: String
        let priority: String?
        let dueKey: String?
        let late: Bool?
    }

    struct Name: Decodable { let name: String }

    struct Row {
        let id: String
        let title: String
        let detail: String?
        let state: String
        let priority: String?
        let dueKey: String?
        let late: Bool
    }

    var rows: [Row] {
        jobs.map { Row(id: $0.id, title: $0.title, detail: nil, state: $0.state, priority: $0.priority, dueKey: $0.dueKey, late: $0.late ?? false) }
            + tasks.map { Row(id: $0.id, title: $0.task.name, detail: $0.project?.name, state: $0.state, priority: $0.priority, dueKey: $0.dueKey, late: $0.late ?? false) }
    }

    var open: [Row] { rows.filter { $0.state != "DONE" && $0.state != "SUBMITTED" && !$0.late } }
    var late: Int { rows.filter(\.late).count }
    var review: Int { rows.filter { $0.state == "SUBMITTED" }.count }

    /// What to show first: today's and high priority at the top.
    var next: [Row] {
        open.enumerated().sorted { a, b in
            func rank(_ row: Row) -> Int { (row.priority == "HIGH" ? 0 : 2) + ((row.dueKey ?? "9") <= todayKey ? 0 : 1) }
            let (ra, rb) = (rank(a.element), rank(b.element))
            return ra != rb ? ra < rb : a.offset < b.offset
        }.map(\.element)
    }
}

struct MyTasksProvider: TimelineProvider {
    typealias Entry = NeonEntry<MyTasks>

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
        let (loaded, context) = await load(side: "employee") { try await WidgetAPI.read("me/tasks/mine", as: MyTasks.self) }
        return Entry(date: Date(), loaded: loaded, context: context)
    }
}

extension MyTasks {
    static let sample = MyTasks(todayKey: "2026-01-01", tasks: [], jobs: [
        Job(id: "1", title: "Photograph the site board", state: "TODO", priority: "MEDIUM", dueKey: "2026-01-01", late: false),
        Job(id: "2", title: "Marble samples for the client", state: "IN_PROGRESS", priority: "HIGH", dueKey: "2026-01-01", late: false),
    ])
}

struct MyTasksWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "neon.my-tasks", provider: MyTasksProvider()) { entry in
            MyTasksView(entry: entry)
        }
        .configurationDisplayName("My tasks · مهامي")
        .description("What is still yours to do, and what is late.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct MyTasksView: View {
    let entry: NeonEntry<MyTasks>
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let words = entry.words
        Group {
            if case .ready(let mine) = entry.loaded {
                content(mine, words)
            } else {
                WidgetMessage(
                    title: words.t("My tasks", "مهامي"),
                    symbol: "checklist",
                    message: explain(entry.loaded, words, otherSide: words.t("This is the team's widget. Add “Today's tasks” instead.", "هاد للموظفين. ضيف ويدجت «مهام اليوم» بداله.")) ?? ""
                )
            }
        }
        .widgetURL(neonLink("/employee/tasks"))
        .neonWidget(words)
    }

    @ViewBuilder private func content(_ mine: MyTasks, _ words: Words) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            WidgetTitle(title: words.t("My tasks", "مهامي"), symbol: "checklist")
            HStack(spacing: 10) {
                Figure(value: mine.open.count, label: words.t("open", "مفتوحة"), tint: Palette.purple)
                Figure(value: mine.late, label: words.t("late", "متأخرة"), tint: mine.late > 0 ? Palette.red : Palette.grey)
                if family != .systemSmall {
                    Figure(value: mine.review, label: words.t("for review", "للمراجعة"), tint: Palette.blue)
                }
            }
            if family != .systemSmall {
                if mine.open.isEmpty {
                    Text(words.t("Nothing open right now.", "ما في إشي مفتوح هلا."))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Palette.muted)
                } else {
                    VStack(alignment: .leading, spacing: family == .systemLarge ? 7 : 4) {
                        ForEach(Array(mine.next.prefix(family == .systemLarge ? 9 : 2)), id: \.id) { row in
                            line(row, words)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .glassPane()
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func line(_ row: MyTasks.Row, _ words: Words) -> some View {
        let (word, tint) = stateWord(row.state, words)
        return HStack(spacing: 7) {
            Circle().fill(row.priority == "HIGH" ? Palette.red : tint).frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 0) {
                Text(row.title)
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
                if family == .systemLarge, let detail = row.detail {
                    Text(detail)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(Palette.muted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            Text(word)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(tint)
                .lineLimit(1)
        }
    }
}
