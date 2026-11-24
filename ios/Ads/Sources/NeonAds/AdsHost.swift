#if targetEnvironment(macCatalyst)
import SwiftUI

// NEON Ads as a section of the NEON app's Mac sidebar (MacSidebarHome.swift in the app).
// It used to be its own app (~/neon-ads/mac, "NEON Ads"); Hamed asked on 2026-11-24 for
// one app instead of many, so each of its pages is now a row under «التسويق», and this
// file is the door: the rows, the screen for a row, the engine, and the widget's link.

/// What the NEON app sees of this module.
public enum Ads {
    public struct Row: Identifiable {
        public let id: String
        /// The page's own (Arabic) name, and the same in English for the app's English sidebar.
        public let title: String
        public let englishTitle: String
        public let symbol: String
    }

    static let prefix = "ads."

    /// One sidebar row per page, in the old app's order.
    public static var rows: [Row] {
        Section.allCases.map { Row(id: prefix + $0.rawValue, title: $0.title, englishTitle: $0.english, symbol: $0.icon) }
    }

    public static func owns(_ rowID: String) -> Bool { rowID.hasPrefix(prefix) }

    /// The screen for a row. `select` moves the sidebar (a page's links to other pages).
    @MainActor public static func screen(_ rowID: String, select: @escaping (String) -> Void) -> some View {
        AdsScreen(section: Section(rawValue: String(rowID.dropFirst(prefix.count))) ?? .command,
                  go: { select(prefix + $0.rawValue) })
    }

    /// The rows' badges (observe it to redraw them). Changes only when a count moves.
    @MainActor public static var badges: AdsBadges { AdsBadges.shared }

    /// Starts the engine if it is not running — the widget and the Brain need it even
    /// when no marketing page is open. Nothing is asked of Meta here.
    @MainActor public static func startEngine() {
        Task { await Engine.ensureRunning() }
    }

    /// neon://ads?c=<campaign>&a=<action> from the widget: opens the confirmation sheet
    /// and answers the row to show, or nil when the link is not this module's.
    @MainActor public static func open(_ url: URL) -> String? {
        guard url.scheme == "neonads" || (url.scheme == "neon" && url.host == "ads") else { return nil }
        Task { await Store.shared.handle(url: url) }
        return prefix + Section.approvals.rawValue
    }

    /// Debug: `-neonAdsSnapshot <dir>` renders every page to PNG and quits (Snapshot.swift).
    @MainActor public static func snapshotIfAsked() async {
        guard let dir = Snapshot.dir else { return }
        await Store.shared.start()
        await Snapshot.run(Store.shared, dir: dir)
    }
}

/// One marketing page in the NEON window: the page itself plus what the old app's window
/// gave every page — the toolbar (search ⌘K, approvals, ask NEON AI ⌘J, refresh ⌘R),
/// the sheets, and the toast.
struct AdsScreen: View {
    @ObservedObject private var store = Store.shared
    let section: Section
    let go: (Section) -> Void
    @State private var palette = false
    @State private var openCampaign: String?

    var body: some View {
        ZStack {
            AuroraBackground()
            switch section {
            case .command: CommandCenterView(go: go, openCampaign: { openCampaign = $0 })
            case .approvals: ApprovalsView(openCampaign: { openCampaign = $0 })
            case .leads: LeadsView()
            case .quality: LeadQualityView(go: go)
            case .desk: ManagerView(go: go, openCampaign: { openCampaign = $0 })
            case .opinion: OpinionView(open: { openCampaign = $0 })
            case .campaigns: WorkbenchView(open: { openCampaign = $0 })
            case .market: MarketView()
            case .newAd: NewAdView()
            case .connect: ConnectView()
            }
        }
        .environmentObject(store)
        .environment(\.layoutDirection, .rightToLeft)
        .navigationTitle(section.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                ConnectionDot()
                Button { palette = true } label: { Label("بحث وأوامر (⌘K)", systemImage: "magnifyingglass") }
                    .keyboardShortcut("k").help("بحث وأوامر ⌘K")
                Button { go(.approvals) } label: {
                    Label("الموافقات", systemImage: store.pendingApprovals > 0 ? "bell.badge" : "bell")
                }.help("الموافقات والتنبيهات")
                Button { store.showAsk = true } label: { Label("اسأل NEON AI", systemImage: "sparkles") }
                    .keyboardShortcut("j").help("اسأل NEON AI (⌘J)")
                Button { Task { await store.refreshAll() } } label: {
                    if store.loading { ProgressView().controlSize(.small) } else { Label("تحديث", systemImage: "arrow.clockwise") }
                }.keyboardShortcut("r").help("تحديث (⌘R)")
            }
        }
        .task { await store.start() }
        .sheet(item: $store.pending) { p in
            ActionConfirmView(p: p).environmentObject(store).environment(\.layoutDirection, .rightToLeft).fittedSheet()
        }
        .sheet(isPresented: $store.showAsk) {
            VStack(alignment: .trailing, spacing: 0) {
                Button("إغلاق") { store.showAsk = false }.keyboardShortcut(.cancelAction).padding(10)
                ScrollView { BrainPanel().padding(16) }
            }
            .frame(width: 760, height: 620).environmentObject(store).environment(\.layoutDirection, .rightToLeft).fittedSheet()
        }
        .sheet(isPresented: $palette) {
            CommandPalette(go: { go($0); palette = false }, openCampaign: { openCampaign = $0; palette = false })
                .environmentObject(store).environment(\.layoutDirection, .rightToLeft).fittedSheet()
        }
        .sheet(item: Binding(get: { openCampaign.map { IDBox(id: $0) } }, set: { openCampaign = $0?.id })) { box in
            CampaignDetailView(id: box.id)
                .environmentObject(store)
                .environment(\.layoutDirection, .rightToLeft)
                .frame(minWidth: 980, idealWidth: 1080, minHeight: 720, idealHeight: 860)
                .fittedSheet()
        }
        .overlay(alignment: .bottom) {
            if let t = store.toast {
                Text(t).padding(.horizontal, 16).padding(.vertical, 10)
                    .background(.thickMaterial, in: Capsule()).padding(.bottom, 18)
                    .task(id: t) { try? await Task.sleep(nanoseconds: 3_500_000_000); if store.toast == t { store.toast = nil } }
            }
        }
    }
}

extension View {
    /// A Catalyst sheet is a fixed form sheet unless told to fit what is inside it (macOS 15+).
    @ViewBuilder func fittedSheet() -> some View {
        if #available(iOS 18.0, *) { self.presentationSizing(.fitted) } else { self }
    }
}

/// Meta and the engine at a glance, in the toolbar (the old app had it under its sidebar).
struct ConnectionDot: View {
    // Toolbar items do not inherit the page's environment objects, so it reads the store itself.
    @ObservedObject private var store = Store.shared
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(store.connected ? Brand.ok : (store.engineUp ? Brand.warn : Brand.bad)).frame(width: 8, height: 8)
            Text(store.connected ? "متصل بميتا" : (store.engineUp ? "مش متصل بميتا" : "المحرّك مطفي")).font(.caption.bold())
            if store.syncing { ProgressView().controlSize(.mini) }
            else if let d = store.lastSync {
                Text(d.formatted(.dateTime.hour().minute())).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .help(store.connected ? "متصل بميتا · مزامنة كل 5 دقايق" : "افتح «الربط والإعدادات»")
    }
}

enum Section: String, CaseIterable, Identifiable {
    case command, approvals, leads, quality, desk, opinion, campaigns, market, newAd, connect
    var id: String { rawValue }
    var title: String {
        switch self {
        case .command: return "مركز القيادة"
        case .approvals: return "الموافقات والتوصيات"
        case .leads: return "العملاء (CRM)"
        case .quality: return "جودة الزباين"
        case .desk: return "مهام اليوم والتصوير"
        case .opinion: return "رأيي بحملاتك"
        case .campaigns: return "كل الحملات"
        case .market: return "السوق والمنافسين"
        case .newAd: return "إعلان جديد"
        case .connect: return "الربط والإعدادات"
        }
    }
    var english: String {
        switch self {
        case .command: return "Command center"
        case .approvals: return "Approvals"
        case .leads: return "Customers (CRM)"
        case .quality: return "Lead quality"
        case .desk: return "Today & shoots"
        case .opinion: return "My take on the ads"
        case .campaigns: return "All campaigns"
        case .market: return "Market & competitors"
        case .newAd: return "New ad"
        case .connect: return "Connection & settings"
        }
    }
    var icon: String {
        switch self {
        case .command: return "square.grid.2x2"
        case .approvals: return "checkmark.shield"
        case .leads: return "person.2.crop.square.stack"
        case .quality: return "checkmark.bubble"
        case .desk: return "person.crop.circle.badge.checkmark"
        case .opinion: return "sparkles"
        case .campaigns: return "list.bullet.rectangle.portrait"
        case .market: return "binoculars.fill"
        case .newAd: return "plus.rectangle.on.rectangle"
        case .connect: return "link"
        }
    }
}

struct IDBox: Identifiable { let id: String }

struct ConnectionPill: View {
    @ObservedObject var store = Store.shared
    @State private var pulse = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Circle().fill(store.connected ? Brand.ok : Brand.bad).frame(width: 8, height: 8)
                VStack(alignment: .leading, spacing: 1) {
                    Text(store.connected ? "متصل بميتا" : (store.engineUp ? "مش متصل بميتا" : "المحرّك مطفي")).font(.caption.bold())
                    if let c = store.status?.check, c.ok {
                        Text("\(c.page ?? "") · \(c.currency ?? "")").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Spacer()
            }
            Divider()
            HStack(spacing: 8) {
                ZStack {
                    Circle().fill(Brand.ok.opacity(0.3)).frame(width: 14, height: 14).scaleEffect(pulse ? 1.3 : 0.6).opacity(pulse ? 0 : 1)
                    Circle().fill(store.syncing ? Brand.warn : Brand.ok).frame(width: 8, height: 8)
                }
                .onAppear { withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) { pulse = true } }
                VStack(alignment: .leading, spacing: 1) {
                    Text(store.syncing ? "بزامن…" : "مزامنة مباشرة").font(.caption.bold())
                    if let d = store.lastSync {
                        Text("آخر تحديث \(d.formatted(.dateTime.hour().minute().second())) · كل 5 دقايق").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Spacer()
            }
        }
        .padding(10)
        .glassCard(14)
    }
}

// MARK: - small building blocks

struct Card<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassCard(18)
    }
}

struct Stat: View {
    var title: String
    var value: String
    var note: String? = nil
    var color: Color = .primary
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(color)
            if let note { Text(note).font(.caption2).foregroundStyle(.secondary) }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.045)))
    }
}

struct Pill: View {
    var text: String
    var color: Color
    var body: some View {
        Text(text).font(.caption.bold()).lineLimit(1).fixedSize().padding(.horizontal, 9).padding(.vertical, 3)
            .foregroundStyle(color).background(Capsule().fill(color.opacity(0.13)))
    }
}

struct PageHeader: View {
    var title: String
    var subtitle: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 26, weight: .bold))
            if let subtitle { Text(subtitle).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}


/// ⌘K — jump anywhere: sections, campaigns, ask the AI.
struct CommandPalette: View {
    @ObservedObject var store = Store.shared
    @Environment(\.dismiss) private var dismiss
    var go: (Section) -> Void
    var openCampaign: (String) -> Void
    @State private var q = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("ابحث عن صفحة، حملة، أو اكتب سؤال لـ NEON AI…", text: $q).textFieldStyle(.roundedBorder).font(.title3)
                .onSubmit { if !q.isEmpty { Task { await store.askBrain("ask", String(q.prefix(80)), ["question": q]) }; dismiss() } }
            List {
                ForEach(Section.allCases.filter { q.isEmpty || $0.title.contains(q) }) { s in
                    Button { go(s) } label: { Label(s.title, systemImage: s.icon) }.buttonStyle(.plain)
                }
                ForEach(store.campaigns.filter { !q.isEmpty && $0.cleanName.localizedCaseInsensitiveContains(q) }.prefix(8)) { c in
                    Button { openCampaign(c.id) } label: { Label(c.cleanName, systemImage: "megaphone") }.buttonStyle(.plain)
                }
                if !q.isEmpty {
                    Button { Task { await store.askBrain("ask", String(q.prefix(80)), ["question": q]) }; dismiss() } label: {
                        Label("اسأل NEON AI: «\(q)»", systemImage: "sparkles")
                    }.buttonStyle(.plain)
                }
            }.frame(height: 340)
        }
        .padding(16).frame(width: 620)
    }
}

#endif
