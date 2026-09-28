#if DEBUG
import SwiftUI

// Every component of the kit on one scrolling page, with sample content —
// for building screens and checking the look in both languages. Debug builds
// only: launch with `-neonKitGallery` to open it instead of sign-in.
// The sample words are developer text and deliberately not localised.

struct NeonKitGallery: View {
    private enum Filter: String, CaseIterable, Hashable {
        case all, open, review, done
        var title: String {
            switch self {
            case .all: return "All"
            case .open: return "Open"
            case .review: return "To review"
            case .done: return "Done"
            }
        }
    }

    private enum Pane: String, CaseIterable, Hashable {
        case day, week, month
    }

    @State private var filter: Filter = .all
    @State private var pane: Pane = .week
    @State private var query = ""
    @State private var name = ""
    @State private var note = ""
    @State private var amount: Double? = 1250
    @State private var hours = 6
    @State private var due = Date()
    @State private var start = Date()
    @State private var optionalDate: Date?
    @State private var priority: String? = "MEDIUM"
    @State private var people: Set<String> = ["Sally"]
    @State private var notify = true
    @State private var confirmDelete = false
    @State private var showSheet = false
    @State private var progress = 0.64
    @State private var shakes = 0
    @State private var loading = false

    private let team = ["Sally", "Salem", "Amro", "Wael", "حنين", "سفيان"]

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
            NeonScroll(spacing: 22) {
                HeroHeader(
                    "Villa Al Fulan",
                    subtitle: "Abdoun, Amman · Design stage",
                    eyebrow: "Project",
                    symbol: "house.fill"
                ) {
                    HStack(spacing: 6) {
                        StateBadge(state: "IN_PROGRESS")
                        BadgeView(text: "Published", tone: .success)
                    }
                }

                group("Stats") {
                    StatGrid {
                        StatTile("Open tasks", value: 42, symbol: "checklist", tint: .neonPurpleStrong, trend: StatTrend(text: "+6", tone: .success, up: true))
                        StatTile("To review", value: 7, symbol: "checkmark.seal", tint: .neonPinkStrong, caption: "2 waiting since yesterday")
                        StatTile("Payroll", value: 8420, format: .money, symbol: "banknote", tint: .neonSuccessStrong)
                        StatTile("On time", value: 91, format: .percent, symbol: "clock", tint: .neonCyanStrong, trend: StatTrend(text: "-3%", tone: .danger, up: false))
                    }
                    HStack(spacing: 20) {
                        ProgressRing(progress: progress, size: 70)
                        VStack(alignment: .leading, spacing: 10) {
                            ProgressBar(progress: progress)
                            ProgressBar(progress: 0.3, tint: .neonOrange)
                            NeonButton("Shuffle", symbol: "shuffle", kind: .ghost, size: .small) {
                                progress = Double.random(in: 0.05...1)
                            }
                        }
                    }
                    .padding(16)
                    .neonSurface()
                }

                group("Filters and search") {
                    FilterChips(selection: $filter, options: Filter.allCases, inset: 16, title: { $0.title }, count: { $0 == .review ? 3 : nil })
                        .padding(.horizontal, -16)
                    SegmentedPill(selection: $pane, options: Pane.allCases, title: { $0.rawValue.capitalized }, badge: { $0 == .day ? 2 : nil })
                    SearchField(text: $query, prompt: "Search projects")
                    FlowRow {
                        Chip("Kitchen", symbol: "fork.knife", isSelected: true) {}
                        Chip("Bedroom", count: 4) {}
                        Chip("Living") {}
                        PersonChip(name: "Sally", subtitle: "Designer")
                        PersonChip(name: "سفيان", onRemove: {})
                    }
                }

                group("Rows") {
                    CardList(Array(team.prefix(4)), id: \.self) { person in
                        ListRow(
                            person,
                            subtitle: "Technical drawings · 3 tasks",
                            meta: "Updated 2h ago",
                            leading: .avatar(url: nil, name: person, online: person == "Sally"),
                            badge: person == "Sally" ? "Late" : nil,
                            badgeTone: .danger,
                            chevron: true
                        )
                    }
                    CardList(["Drawings", "Documents", "BOQ"], id: \.self) { title in
                        ListRow(title, subtitle: "12 files", leading: .icon("doc.richtext", tint: .neonCyanStrong), value: "4.2 MB", chevron: true)
                    }
                    NeonCard {
                        KeyValueRow("Client", value: "أبو محمد", symbol: "person", userText: true)
                        NeonDivider()
                        KeyValueRow("Budget", value: NeonFormat.money(48000), symbol: "banknote")
                        NeonDivider()
                        HStack {
                            MetaLabel("Sep 30", symbol: "calendar")
                            MetaLabel("3 people", symbol: "person.2")
                            Spacer()
                            AvatarStack(team.map { AvatarItem(name: $0) }, size: 26)
                        }
                    }
                }

                group("States") {
                    FlowRow {
                        StateBadge(state: "TODO")
                        StateBadge(state: "IN_PROGRESS")
                        StateBadge(state: "SUBMITTED")
                        StateBadge(state: "DONE")
                        StateBadge(state: "TOMORROW")
                        BadgeView(text: "High", tone: .pink, symbol: "flame.fill")
                        CountBadge(12)
                    }
                    StatusNote(symbol: "exclamationmark.triangle.fill", tone: .warning, title: "Second warning", detail: "Pinned until the manager removes it.")
                    OfflineBanner(savedAt: Date())
                    NeonCard {
                        EmptyState(symbol: "tray", title: "Nothing planned for today", detail: "Outside working hours: 11:00–19:00", actionTitle: "Plan the day") {}
                    }
                    SkeletonRows(count: 2)
                    ListRow("Loading row", subtitle: "Shaped like the real one", leading: .icon("doc"))
                        .neonSurface()
                        .skeleton(true)
                }

                group("Timeline") {
                    NeonCard {
                        TimelineRow("Concept approved", subtitle: "Client signed off the moodboard", time: "Sep 12", symbol: "checkmark", tint: .neonSuccessStrong, isFirst: true)
                        TimelineRow("Renders in progress", subtitle: "Living room and kitchen", time: "Now", tint: .neonPurple, isCurrent: true)
                        TimelineRow("Technical drawings", time: "Oct 2", isLast: true)
                    }
                    StageTrack(stages: ["Concept", "Design", "Visualization", "Drawings", "BOQ", "Pricing", "Approval", "Handover"], current: 2)
                }

                group("Charts") {
                    ChartCard("Tasks finished", subtitle: "This week", value: "38") {
                        NeonBarChart(
                            zip(["Sun", "Mon", "Tue", "Wed", "Thu"], [5, 8, 6, 11, 8]).map { day, count in ChartPoint(day, Double(count)) },
                            target: 8,
                            targetLabel: "Target"
                        )
                    }
                    ChartCard("Progress", subtitle: "Last 10 days") {
                        NeonLineChart((1...10).map { ChartPoint("\($0)", Double($0 * $0 % 17 + 20)) }, format: .percent)
                    }
                    ChartCard("Where the hours went") {
                        NeonDonutChart([
                            ChartPoint("Design", 42),
                            ChartPoint("Site visits", 18),
                            ChartPoint("Drawings", 26),
                            ChartPoint("Meetings", 9),
                        ], size: 130, centerTitle: "hours")
                    }
                }

                group("Buttons") {
                    NeonButton("Hand out task", symbol: "paperplane.fill", kind: .brand) {
                        try? await Task.sleep(nanoseconds: 1_200_000_000)
                        Toast.success("Task handed out", detail: "Sally and Salem were told.")
                    }
                    HStack {
                        NeonButton("Save", kind: .primary, size: .medium) {
                            try? await Task.sleep(nanoseconds: 800_000_000)
                        }
                        NeonButton("Cancel", kind: .secondary, size: .medium) {}
                        NeonButton("Later", kind: .ghost, size: .medium) {}
                    }
                    HStack {
                        NeonButton("Approve", symbol: "checkmark", kind: .tinted(.neonSuccessStrong), size: .medium) {
                            Toast.success("Approved")
                        }
                        NeonButton("Delete", symbol: "trash", kind: .destructive, size: .medium, confirm: "Delete this drawing?", confirmMessage: "The client stops seeing it straight away.") {
                            Toast.error("Deleted")
                        }
                    }
                    HStack(spacing: 12) {
                        IconButton("phone.fill", label: "Call") {}
                        IconButton("video.fill", label: "Video", look: .tinted, tint: .neonPurpleStrong) {}
                        IconButton("bell", label: "Alerts", badge: 3) {}
                        IconButton("plus", label: "Add", look: .filled, tint: .neonPurple) {}
                        Spacer()
                        NeonButton("Info toast", kind: .secondary, size: .small) {
                            Toast.info("Copied the link", detail: "clients.neonjo.com/p/villa")
                        }
                    }
                }

                group("Form") {
                    FormSection("Task", footer: "Counts as done when the photo shows it.") {
                        NeonTextField("Title", text: $name, prompt: "What needs doing", symbol: "textformat", isRequired: true, error: name.isEmpty ? nil : (name.count < 3 ? "Say a little more." : nil))
                        NeonTextEditor("Details", text: $note, prompt: "Anything they should know", limit: 280)
                        MoneyField("Budget", amount: $amount, decimals: 0)
                        NumberField("Hours", value: $hours, unit: "h", symbol: "clock")
                        DateField("Due", date: $due, components: [.date, .hourAndMinute])
                        TimeField("Starts", time: $start)
                        OptionalDateField("Reminder", date: $optionalDate)
                        MenuField("Priority", selection: $priority, options: ["LOW", "MEDIUM", "HIGH"], title: { $0.capitalized }, noneTitle: "No priority")
                        SelectField("People", selection: $people, options: team, title: { $0 }, subtitle: { _ in "Designer" }, avatar: { _ in nil })
                        ToggleRow("Tell them now", detail: "Sends a notification to each person.", symbol: "bell.badge", isOn: $notify)
                    }
                    NeonButton("Open a form sheet", symbol: "square.and.pencil", kind: .secondary) { showSheet = true }
                    NeonButton("Shake the form", kind: .ghost) { shakes += 1 }
                        .shake(shakes)
                }

                group("Swipe list") {
                    List {
                        ForEach(team.prefix(3), id: \.self) { person in
                            ListRow(person, subtitle: "Swipe either way", leading: .avatar(url: nil, name: person))
                                .neonSurface(.solid, radius: 16)
                                .neonListRow()
                                .destructiveSwipe("Remove", confirm: "Remove \(person)?") {}
                                .swipeAction("Pin", symbol: "pin.fill") {}
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .scrollDisabled(true)
                    .frame(height: 250)
                }
            }
            .onAppear {
                // -neonKitSection Charts: open scrolled to a section (for screenshots).
                let args = ProcessInfo.processInfo.arguments
                if let index = args.firstIndex(of: "-neonKitSection"), index + 1 < args.count {
                    let section = args[index + 1]
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { proxy.scrollTo(section, anchor: .top) }
                }
            }
            }
            .navigationTitle("NEON kit")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(AppLanguage.current.toggleLabel) { AppLanguage.toggle() }
                }
            }
            .floatingActionButton(label: "New") { showSheet = true }
            .sheet(isPresented: $showSheet) {
                SheetScaffold("New meeting", subtitle: "Team group", symbol: "calendar.badge.plus", primaryTitle: "Set meeting", isPrimaryEnabled: !name.isEmpty) {
                    try? await Task.sleep(nanoseconds: 900_000_000)
                    showSheet = false
                    Toast.success("Meeting set")
                } content: {
                    NeonTextField("Title", text: $name, isRequired: true)
                    DateField("When", date: $due, components: [.date, .hourAndMinute])
                    SelectField("Who", selection: $people, options: team, title: { $0 }, avatar: { _ in nil })
                }
                .neonSheet([.medium, .large])
            }
        }
    }

    private func group<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title)
            content()
        }
        .id(title)
    }
}

#Preview("Kit") {
    NeonKitGallery()
}

#Preview("Kit · Arabic") {
    NeonKitGallery()
        .environment(\.layoutDirection, .rightToLeft)
}
#endif
