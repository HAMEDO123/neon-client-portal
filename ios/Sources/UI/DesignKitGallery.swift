#if DEBUG
import SwiftUI
import UIKit

/// Every component of the kit, a screen at a time, so the design system can
/// be checked in screenshots: `-neonScreen kit`, `kit-2` … `kit-10`. The
/// words and figures are samples, not studio data. Debug builds only.
struct DesignKitGallery: View {
    var slice = 1

    static let slices = 10

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                ScrollView {
                    VStack(alignment: .leading, spacing: NeonSpace.stack) {
                        content
                    }
                    .padding(.horizontal, NeonSpace.gutter)
                    .padding(.top, 4)
                    .padding(.bottom, 120)
                }
                overlay
            }
            .background(NeonAmbient().ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch slice {
        case 2: GalleryHomeLower()
        case 3: GalleryQuickActions()
        case 4: GalleryChat()
        case 5: GalleryFigures()
        case 6: GalleryControls()
        case 7: GalleryRows()
        case 8: GalleryStates()
        case 9: GalleryForms()
        case 10: GalleryCharts()
        default: GalleryHomeUpper()
        }
    }

    @ViewBuilder
    private var overlay: some View {
        switch slice {
        case 3, 4: GalleryTabBar(selected: slice == 3 ? "home" : "chat")
        default: EmptyView()
        }
    }
}

// MARK: - 1 · Home, top

private struct GalleryHomeUpper: View {
    var body: some View {
        ScreenHeader.brand {
            IconButton("magnifyingglass", label: "Search", size: NeonSize.circleButton) {}
            IconButton("bell", label: "Alerts", size: NeonSize.circleButton, dot: true) {}
            AvatarView(url: nil, name: "Neon", size: NeonSize.circleButton, ring: true)
                .neonShadow(.low)
        }

        HeroCard(
            "Hamed 👋",
            eyebrow: "Good evening,",
            eyebrowSymbol: "sun.max.fill",
            subtitle: "Tuesday, September 29",
            footnote: "An overview of every client project delivery.",
            photo: .image(GalleryArt.villa),
            action: {}
        ) {
            VStack(alignment: .trailing, spacing: 2) {
                HStack(spacing: 6) {
                    Image(systemName: "moon.fill")
                    Text(verbatim: "22°")
                }
                .font(.system(.title2, weight: .semibold))
                HStack(spacing: 4) {
                    Text(verbatim: "Amman")
                    Image(systemName: "chevron.down").font(.caption.weight(.bold))
                }
                .font(.subheadline.weight(.medium))
            }
            .foregroundStyle(.white)
        }

        StatGrid(columns: 4) {
            KPICard("Total Projects", value: 4, symbol: "folder.fill", hue: .blue,
                    trend: .rising("+2", "this month"), bars: [1, 1.4, 3, 4, 4.1, 5.2], density: .compact) {
                Button("Open projects") {}
            }
            KPICard("Published", value: 4, symbol: "checkmark.seal.fill", hue: .purple,
                    trend: .rising("+1", "this week"), bars: [1, 2, 3, 2.4, 3.2, 5], density: .compact) {
                Button("Open") {}
            }
            KPICard("Pending Approvals", value: 0, symbol: "clock.fill", hue: .orange,
                    trend: .steady(), bars: [1, 2, 3, 3, 4, 4], density: .compact) {
                Button("Open") {}
            }
            KPICard("Updated This Week", value: 0, symbol: "chart.line.uptrend.xyaxis", hue: .pink,
                    trend: .steady(), bars: [1, 2, 2, 2, 2.3, 3], density: .compact) {
                Button("Open") {}
            }
        }

        SectionCard("Project Progress", subtitle: "Live status of all projects",
                    symbol: "square.stack.3d.up.fill", hue: .blue, action: {}) {
            SegmentedProgress([
                ProgressSegment("Planning", value: 2, hue: .green),
                ProgressSegment("Active", value: 1, hue: .blue),
                ProgressSegment("On Hold", value: 0, hue: .purple),
                ProgressSegment("Completed", value: 1, hue: .grey),
            ])
        }
    }
}

// MARK: - 2 · Home, lower

private struct GalleryHomeLower: View {
    private let tasks: [(String, String, String, Bool)] = [
        ("Client meeting", "Villa Design – PRJ-001", "10:00 AM", true),
        ("Send invoice", "Office Renovation", "12:30 PM", false),
        ("3D Rendering", "Showroom Project", "4:00 PM", false),
        ("Site Review", "Retail Shop", "6:00 PM", false),
    ]

    var body: some View {
        SectionCard("Today's Tasks", symbol: "checkmark.square.fill", hue: .blue, tileStyle: .filled, spacing: 6, action: {}) {
            VStack(spacing: 0) {
                ForEach(Array(tasks.enumerated()), id: \.offset) { index, task in
                    if index > 0 { NeonDivider().padding(.leading, 60) }
                    ListRow(task.0, subtitle: task.1, leading: .image(GalleryArt.room(index))) {
                        Text(verbatim: task.2)
                            .font(.neonMeta)
                            .foregroundStyle(Color.neonTextSecondary)
                        CheckCircle(task.3)
                    }
                    .padding(.horizontal, -14)
                }
            }
        }

        SectionCard("This Month", symbol: "chart.bar.fill", hue: .amber) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(verbatim: "12,500 JD")
                    .font(.neonTitle)
                    .foregroundStyle(Color.neonInk)
                TrendLabel(.rising("+18%", "vs last month"))
            }
            MiniBars([5.2, 6, 5.8, 8.6], comparison: [3.4, 7.4, 7.6, 9.4], labels: ["W1", "W2", "W3", "W4"], hue: .blue, height: 74)
        } trailing: {
            PillMenu("Revenue") {
                Button("Revenue") {}
                Button("Projects") {}
            }
        }

        HStack(alignment: .top, spacing: NeonSpace.stack) {
            SectionCard("Client Reviews", symbol: "star.fill", hue: .amber, spacing: 10) {
                Text(verbatim: "5").font(.neonTitle).foregroundStyle(Color.neonInk)
                Text(verbatim: "Reviews waiting").font(.neonLabel).foregroundStyle(Color.neonTextSecondary)
                HStack {
                    AvatarStack(["Layla Haddad", "Omar", "Sara Ali", "Yousef"].map { AvatarItem(name: $0) }, size: 30)
                    Spacer(minLength: 4)
                    IconButton("chevron.forward", label: "Open reviews", look: .tinted, tint: .neonPurpleStrong, size: 34) {}
                }
            }
            KPICard("On-time delivery", value: 92, format: .percent, symbol: "clock.badge.checkmark.fill", hue: .green,
                    trend: .rising("+4%", "this month"))
        }
    }
}

// MARK: - 3 · Quick actions, the tab bar, the floating button

private struct GalleryQuickActions: View {
    private var actions: [QuickAction] {
        [
            QuickAction("New Project", symbol: "plus", hue: .purple) {},
            QuickAction("Hand out a Task", symbol: "checklist", hue: .green) {},
            QuickAction("New Invoice", symbol: "doc.text.fill", hue: .blue) {},
            QuickAction("Add Client", symbol: "person.2.fill", hue: .orange) {},
            QuickAction("Upload Photos", symbol: "camera.fill", hue: .pink, badge: 2) {},
            QuickAction("More", symbol: "ellipsis", hue: .grey) {},
        ]
    }

    var body: some View {
        SectionCard("Quick Actions", symbol: "bolt.fill", hue: .purple, tileStyle: .filled, actionTitle: "Edit", action: {}) {
            QuickActionGrid(actions, columns: nil, inset: NeonSpace.card)
                .padding(.horizontal, -NeonSpace.card)
        }

        SectionCard("Quick Actions", subtitle: "As a grid, three to a row", symbol: "square.grid.2x2.fill", hue: .indigo) {
            QuickActionGrid(actions)
        }

        HStack {
            Spacer()
            FloatingActionButton("square.and.pencil", label: "New message") {}
            FloatingActionButton("plus", label: "New task", title: "New task") {}
        }
    }
}

private struct GalleryTabBar: View {
    @State var selected: String

    var body: some View {
        NeonTabBar(selection: $selected, items: [
            NeonTabItem("home", title: "Home", symbol: "house.fill"),
            NeonTabItem("projects", title: "Projects", symbol: "folder.fill"),
            NeonTabItem("tasks", title: "Tasks", symbol: "checklist", dot: selected == "chat"),
            NeonTabItem("chat", title: "Chat", symbol: "bubble.left.and.bubble.right.fill", badge: selected == "chat" ? nil : 3),
            NeonTabItem("more", title: "More", symbol: "ellipsis.circle.fill"),
        ])
        .padding(.bottom, 4)
    }
}

// MARK: - 4 · Chat

private enum GalleryFilter: String, CaseIterable {
    case all = "All", unread = "Unread", groups = "Groups", tasks = "Tasks", favorites = "Favorites"
}

private struct GalleryChat: View {
    @State private var filter = GalleryFilter.all

    var body: some View {
        ScreenHeader("Chat", leading: {
            BrandMark(size: 34).frame(width: 44, height: 44)
        }) {
            IconButton("magnifyingglass", label: "Search", size: NeonSize.circleButton) {}
            IconButton("person.badge.plus", label: "New chat", size: NeonSize.circleButton) {}
            IconButton("ellipsis", label: "More", size: NeonSize.circleButton) {}
        }

        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 12) {
                StoryAvatar(name: "My Story", ring: .none, showsAdd: true)
                StoryAvatar(name: "NEON Team")
                StoryAvatar(name: "Sally", online: true)
                StoryAvatar(name: "Salem", ring: .seen)
                StoryAvatar(name: "Amro", online: true)
                StoryAvatar(name: "Wael", online: true)
            }
            .padding(.horizontal, NeonSpace.gutter)
            .padding(.vertical, 2)
        }
        .padding(.horizontal, -NeonSpace.gutter)

        PillFilterBar(selection: $filter, options: GalleryFilter.allCases, title: { $0.rawValue }, count: { $0 == .unread ? 2 : nil })

        VStack(spacing: NeonSpace.sm) {
            ListCardRow("NEON Team", subtitle: "You: حدثوه", leading: .avatar(url: nil, name: "NEON Team", online: true), titleSymbol: "pin.fill", time: "9:16 PM", pinned: true)
            ListCardRow("Sally", subtitle: "ويدي نراجع أنا وياك تعديلات الفيلا لاني مش متذكر…", leading: .avatar(url: nil, name: "Sally", online: true), time: "8:32 PM", count: 2)
            ListCardRow("Salem", subtitle: "F", leading: .avatar(url: nil, name: "Salem", online: true), time: "2:02 PM", muted: true)
            ListCardRow("Design Team", subtitle: "Ahmed: Updated renders ✅", leading: .image(GalleryArt.room(2)), time: "9/9/2026")
            ListCardRow("Projects", subtitle: "Layla: Client approved", leading: .image(GalleryArt.room(0)), time: "9/8/2026", badge: "Client", badgeTone: .blue)
        }
        .floatingActionButton("square.and.pencil", label: "New message") {}
    }
}

// MARK: - 5 · Figures

private struct GalleryFigures: View {
    var body: some View {
        StatGrid {
            KPICard("Revenue", value: 12_500, format: .money, symbol: "banknote.fill", hue: .green,
                    trend: .rising("+18%", "vs last month"), bars: [4, 5, 4.6, 6, 7, 8.4]) {
                Button("Open payroll") {}
            }
            KPICard("Late tasks", value: 3, symbol: "exclamationmark.triangle.fill", hue: .red,
                    trend: .falling("−2", "since Monday", tone: .success), bars: [6, 5, 5, 4, 3, 3])
            StatTile("Open tasks", value: 42, symbol: "checklist", tint: .neonCyanStrong,
                     trend: StatTrend(text: "+6", tone: .success, up: true))
            StatTile("Next handover", text: "Oct 12", symbol: "calendar", tint: .neonIndigo, caption: "Villa Al Fulan")
        }

        SectionCard("Hours this week", subtitle: "Across the whole studio", symbol: "waveform.path.ecg", hue: .indigo) {
            HStack(alignment: .bottom, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: "186 h").font(.neonTitle).foregroundStyle(Color.neonInk)
                    TrendLabel(.rising("+12 h", "vs last week"))
                }
                Sparkline([22, 30, 26, 34, 31, 38, 36], hue: .indigo, height: 56)
            }
        }

        NeonCard {
            HStack(spacing: 16) {
                ProgressRing(progress: 0.64, size: 58, lineWidth: 7)
                VStack(alignment: .leading, spacing: 10) {
                    Text(verbatim: "Watin Cafe").font(.neonCardTitle).foregroundStyle(Color.neonInk)
                    ProgressBar(progress: 0.72)
                    ProgressBar(progress: 0.35, tint: .neonOrange)
                }
            }
        }
    }
}

// MARK: - 10 · Charts

private struct GalleryCharts: View {
    var body: some View {
        ChartCard("Tasks finished", subtitle: "This week", value: "38") {
            NeonBarChart([
                ChartPoint("Sun", 5), ChartPoint("Mon", 7), ChartPoint("Tue", 6),
                ChartPoint("Wed", 9), ChartPoint("Thu", 8), ChartPoint("Fri", 3),
            ], tint: .neonBlue, height: 150, target: 7, targetLabel: "Target")
        }

        ChartCard("On time", subtitle: "Last six weeks", value: "91%") {
            NeonLineChart([
                ChartPoint("W1", 78), ChartPoint("W2", 84), ChartPoint("W3", 80),
                ChartPoint("W4", 88), ChartPoint("W5", 86), ChartPoint("W6", 91),
            ], color: .neonIndigo, height: 130, format: .percent)
        }

        ChartCard("Where the hours went") {
            NeonDonutChart([
                ChartPoint("Design", 42), ChartPoint("Site", 26), ChartPoint("Meetings", 12), ChartPoint("Admin", 8),
            ], size: 118, lineWidth: 18, centerTitle: "hours")
        }
    }
}

// MARK: - 6 · Controls

private struct GalleryControls: View {
    @State private var chip = "All"
    @State private var view = "Week"
    @State private var query = ""

    var body: some View {
        SectionCard("Buttons", symbol: "hand.tap.fill", hue: .indigo) {
            NeonButton("Save changes", symbol: "checkmark") {}
            NeonButton("Hand out to the team", kind: .brand) {}
            HStack(spacing: 8) {
                NeonButton("Cancel", kind: .secondary, size: .medium) {}
                NeonButton("Approve", kind: .tinted(.neonSuccessStrong), size: .medium) {}
                NeonButton("Later", kind: .ghost, size: .medium) {}
            }
            HStack(spacing: 8) {
                NeonButton("Delete", symbol: "trash", kind: .destructive, size: .small) {}
                NeonButton("Tinted", kind: .tinted(.neonBlueStrong), size: .small) {}
                ViewAllButton {}
                ViewAllButton("Edit", chevron: false) {}
            }
        }

        SectionCard("Round buttons", symbol: "circle.grid.2x2.fill", hue: .purple) {
            HStack(spacing: 12) {
                IconButton("magnifyingglass", label: "Search", size: NeonSize.circleButton) {}
                IconButton("bell", label: "Alerts", size: NeonSize.circleButton, dot: true) {}
                IconButton("tray.fill", label: "Inbox", size: NeonSize.circleButton, badge: 4) {}
                IconButton("plus", label: "Add", look: .filled, tint: .neonIndigo, size: NeonSize.circleButton) {}
                IconButton("pencil", label: "Edit", look: .tinted, tint: .neonPurpleStrong, size: NeonSize.circleButton) {}
                IconButton("phone.fill", label: "Call", look: .plain, tint: .neonSuccessStrong, size: NeonSize.circleButton) {}
            }
        }

        SectionCard("Filters and search", symbol: "line.3.horizontal.decrease", hue: .blue) {
            FilterChips(selection: $chip, options: ["All", "Kitchen", "Living", "Bedrooms"], title: { $0 },
                        count: { $0 == "Kitchen" ? 4 : nil })
            SegmentedPill(selection: $view, options: ["Day", "Week", "Month"], title: { $0 })
            SearchField(text: $query, prompt: "Search projects")
            FlowRow {
                Chip("Tagged", symbol: "tag.fill", isSelected: true)
                Chip("Kitchen", count: 4)
                PillMenu("Revenue") { Button("Revenue") {} }
            }
        }

        SectionCard("Badges and tiles", symbol: "tag.fill", hue: .pink) {
            FlowRow {
                StateBadge(state: "IN_PROGRESS")
                StateBadge(state: "DONE")
                BadgeView(text: "High", tone: .pink, symbol: "flame.fill")
                BadgeView(text: "Client", tone: .blue)
                CountBadge(3)
                CountBadge(12, tone: .neutral)
            }
            HStack(spacing: 8) {
                ForEach(NeonHue.allCases, id: \.self) { hue in
                    IconTile("sparkles", hue: hue, size: 30)
                }
            }
            HStack(spacing: 8) {
                IconTile("folder.fill", hue: .blue, size: 40, style: .soft)
                IconTile("folder.fill", hue: .blue, size: 40, style: .filled)
                IconTile("folder.fill", hue: .blue, size: 40, style: .glass)
                IconTile("clock.fill", tint: .neonOrangeStrong, size: 40)
                CheckCircle(true)
                CheckCircle(false)
            }
        }
    }
}

// MARK: - 7 · Rows and detail

private struct GalleryRows: View {
    private struct Row: Identifiable { let id: Int; let title: String; let subtitle: String }

    var body: some View {
        SectionHeader("Projects", subtitle: "Sorted by the last update", count: 12, actionTitle: "View All") {}

        CardList([
            Row(id: 0, title: "Villa Al Fulan", subtitle: "Concept design · Layla"),
            Row(id: 1, title: "Watin Cafe", subtitle: "Execution · Saif"),
            Row(id: 2, title: "فيلا الرابية", subtitle: "مخططات تنفيذية"),
        ]) { row in
            ListRow(row.title, subtitle: row.subtitle, leading: .icon("folder.fill", tint: .neonBlueStrong),
                    value: "60%", badge: row.id == 1 ? "Late" : nil, badgeTone: .danger, chevron: true)
        }

        ListCardRow("Kitchen drawings", subtitle: "Revision 3 · 4.2 MB", leading: .icon("doc.richtext.fill", tint: .neonPurpleStrong), time: "Yesterday")

        NeonCard {
            KeyValueRow("Client", value: "Saif", symbol: "person.fill", userText: true)
            NeonDivider()
            KeyValueRow("Budget", value: NeonFormat.money(48_000), symbol: "banknote")
        }

        StatusNote(symbol: "exclamationmark.triangle.fill", tone: .warning, title: "Two drawings wait for the client",
                   detail: "Sent on Sunday; nothing back yet.")

        NeonCard {
            TimelineRow("Concept approved", subtitle: "Signed by the client", time: "Sep 12", symbol: "checkmark", isFirst: true)
            TimelineRow("Renders", subtitle: "Six views in progress", time: "Now", isCurrent: true)
            TimelineRow("Handover", time: "Oct 12", isLast: true)
        }

        NeonCard {
            StageTrack(stages: ["Brief", "Concept", "Design", "Drawings", "Execution", "Handover"], current: 2)
        }
    }
}

// MARK: - 8 · States

private struct GalleryStates: View {
    var body: some View {
        OfflineBanner(savedAt: Date(timeIntervalSince1970: 1_790_000_000))

        EmptyState(symbol: "tray", title: "Nothing planned for today",
                   detail: "Plan the day and it appears here.", actionTitle: "Plan the day", action: {}, card: true)

        HStack(spacing: NeonSpace.stack) {
            SkeletonKPICard()
            SkeletonKPICard()
        }

        SkeletonCard(lines: 2)
        SkeletonRows(count: 2)

        ErrorState(message: "The server could not be reached.") {}
    }
}

// MARK: - 9 · Forms

private struct GalleryForms: View {
    @State private var title = "Kitchen elevations"
    @State private var details = ""
    @State private var budget: Double = 4_800
    @State private var notify = true
    @State private var priority = "HIGH"

    var body: some View {
        SheetHeader("New task", subtitle: "For the team, due this week", symbol: "checklist") {}
            .padding(.horizontal, -NeonSpace.gutter)

        FormSection("Task", footer: "They are told the moment you save.") {
            NeonTextField("Title", text: $title, symbol: "textformat", isRequired: true)
            NeonTextEditor("Details", text: $details, minLines: 2, maxLines: 4, limit: 500)
            MoneyField("Budget", amount: $budget)
            MenuField("Priority", selection: $priority, options: ["LOW", "MEDIUM", "HIGH"], title: { $0.capitalized })
            ToggleRow("Tell them now", detail: "A notification on their phone", symbol: "bell.badge", isOn: $notify)
        }

        NeonButton("Hand out", symbol: "paperplane.fill") {}
    }
}

// MARK: - Sample pictures

/// Drawn pictures for the gallery, so it needs no network: a villa at dusk
/// for the hero and a few rooms for thumbnails.
enum GalleryArt {
    static let villa = Image(uiImage: drawVilla(CGSize(width: 720, height: 420)))

    static func room(_ index: Int) -> Image {
        rooms[((index % rooms.count) + rooms.count) % rooms.count]
    }

    private static let rooms: [Image] = (0..<4).map { Image(uiImage: drawRoom($0, CGSize(width: 160, height: 160))) }

    private static func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }

    private static func gradient(_ colors: [UIColor], _ locations: [CGFloat]) -> CGGradient {
        CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors.map(\.cgColor) as CFArray, locations: locations)!
    }

    private static func drawVilla(_ size: CGSize) -> UIImage {
        UIGraphicsImageRenderer(size: size).image { context in
            let c = context.cgContext
            let w = size.width, h = size.height
            c.drawLinearGradient(gradient([rgb(0x3A4AA8), rgb(0x7E62C9), rgb(0xD98FA6), rgb(0xF4B08A)], [0, 0.45, 0.78, 1]),
                                 start: .zero, end: CGPoint(x: 0, y: h * 0.8), options: [.drawsAfterEndLocation])
            // Hills and ground.
            c.setFillColor(rgb(0x2C2B5C).cgColor)
            c.move(to: CGPoint(x: 0, y: h * 0.72))
            c.addCurve(to: CGPoint(x: w, y: h * 0.66), control1: CGPoint(x: w * 0.3, y: h * 0.6), control2: CGPoint(x: w * 0.6, y: h * 0.74))
            c.addLine(to: CGPoint(x: w, y: h)); c.addLine(to: CGPoint(x: 0, y: h)); c.fillPath()
            c.setFillColor(rgb(0x181A33).cgColor)
            c.fill(CGRect(x: 0, y: h * 0.84, width: w, height: h * 0.16))
            // Lower storey with glass.
            c.setFillColor(rgb(0x23264A).cgColor)
            c.fill(CGRect(x: w * 0.3, y: h * 0.6, width: w * 0.62, height: h * 0.25))
            let glow = gradient([rgb(0xFFE0A0), rgb(0xF4A04E)], [0, 1])
            for i in 0..<6 {
                let rect = CGRect(x: w * 0.33 + CGFloat(i) * w * 0.095, y: h * 0.63, width: w * 0.08, height: h * 0.2)
                c.saveGState(); c.clip(to: rect)
                c.drawLinearGradient(glow, start: CGPoint(x: 0, y: rect.minY), end: CGPoint(x: 0, y: rect.maxY), options: [])
                c.restoreGState()
            }
            // Cantilevered upper storey: white slab, wood soffit, lit glass.
            c.setFillColor(rgb(0x2A2D52).cgColor)
            c.fill(CGRect(x: w * 0.42, y: h * 0.36, width: w * 0.58, height: h * 0.22))
            c.setFillColor(rgb(0xEDEAF5).cgColor)
            c.fill(CGRect(x: w * 0.4, y: h * 0.33, width: w * 0.6, height: h * 0.04))
            c.fill(CGRect(x: w * 0.4, y: h * 0.575, width: w * 0.6, height: h * 0.03))
            c.setFillColor(rgb(0xA8744A).cgColor)
            c.fill(CGRect(x: w * 0.43, y: h * 0.37, width: w * 0.57, height: h * 0.025))
            for i in 0..<5 {
                let rect = CGRect(x: w * 0.45 + CGFloat(i) * w * 0.11, y: h * 0.405, width: w * 0.095, height: h * 0.165)
                c.saveGState(); c.clip(to: rect)
                c.drawLinearGradient(glow, start: CGPoint(x: 0, y: rect.minY), end: CGPoint(x: 0, y: rect.maxY), options: [])
                c.restoreGState()
            }
            // Light on the ground, then two palms.
            c.setFillColor(rgb(0xF6B26B, 0.22).cgColor)
            c.fillEllipse(in: CGRect(x: w * 0.3, y: h * 0.82, width: w * 0.62, height: h * 0.08))
            for (x, top) in [(w * 0.2, h * 0.3), (w * 0.95, h * 0.24)] {
                c.setStrokeColor(rgb(0x14162B).cgColor)
                c.setLineWidth(7)
                c.move(to: CGPoint(x: x, y: h * 0.86))
                c.addQuadCurve(to: CGPoint(x: x + 14, y: top), control: CGPoint(x: x - 18, y: h * 0.55))
                c.strokePath()
                c.setFillColor(rgb(0x14162B).cgColor)
                for angle in stride(from: 0.0, to: Double.pi * 2, by: Double.pi / 4) {
                    let tip = CGPoint(x: x + 14 + CGFloat(cos(angle)) * 62, y: top + CGFloat(sin(angle)) * 30 + 14)
                    c.move(to: CGPoint(x: x + 14, y: top))
                    c.addQuadCurve(to: tip, control: CGPoint(x: x + 14 + CGFloat(cos(angle)) * 30, y: top - 22))
                    c.addQuadCurve(to: CGPoint(x: x + 14, y: top + 4), control: CGPoint(x: x + 14 + CGFloat(cos(angle)) * 26, y: top - 8))
                    c.fillPath()
                }
            }
        }
    }

    private static func drawRoom(_ seed: Int, _ size: CGSize) -> UIImage {
        let walls: [UInt32] = [0xE9DFD3, 0xDCD8D2, 0xE4E1DC, 0xD9CFC4]
        let sofas: [UInt32] = [0x8C7A6B, 0x5E6B73, 0xB39B84, 0x3F4A57]
        return UIGraphicsImageRenderer(size: size).image { context in
            let c = context.cgContext
            let w = size.width, h = size.height
            c.setFillColor(rgb(walls[seed % 4]).cgColor)
            c.fill(CGRect(origin: .zero, size: size))
            c.drawLinearGradient(gradient([rgb(0xFFFFFF, 0.9), rgb(0xCFE3F2, 0.9)], [0, 1]),
                                 start: CGPoint(x: 0, y: h * 0.12), end: CGPoint(x: 0, y: h * 0.58), options: [])
            c.setFillColor(rgb(walls[seed % 4]).cgColor)
            c.fill(CGRect(x: 0, y: 0, width: w * 0.12, height: h))
            c.fill(CGRect(x: w * 0.88, y: 0, width: w * 0.12, height: h))
            c.fill(CGRect(x: 0, y: 0, width: w, height: h * 0.12))
            c.fill(CGRect(x: 0, y: h * 0.58, width: w, height: h * 0.42))
            c.setFillColor(rgb(0xA67C52).cgColor)
            c.fill(CGRect(x: 0, y: h * 0.78, width: w, height: h * 0.22))
            c.setFillColor(rgb(sofas[seed % 4]).cgColor)
            c.fill(CGRect(x: w * 0.18, y: h * 0.6, width: w * 0.6, height: h * 0.2))
            c.setFillColor(rgb(0x3E6B45).cgColor)
            c.fillEllipse(in: CGRect(x: w * 0.8, y: h * 0.48, width: w * 0.16, height: h * 0.26))
        }
    }
}
#endif
