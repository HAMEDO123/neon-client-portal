#if targetEnvironment(macCatalyst)
import SwiftUI
import Charts

struct ScoreComp: Codable, Hashable { var name: String; var weight: Double; var value: Double; var detail: String? }
struct CampScore: Codable, Hashable { var score: Int?; var objective: String?; var components: [ScoreComp]; var limits: [String] }
struct SparkPt: Codable, Hashable, Identifiable { var day: String; var conv: Int; var spend: Double; var id: String { day } }
struct WBCampaign: Codable, Hashable, Identifiable {
    var id: String; var name: String; var objective: String?; var state: String; var first_day: String; var last_day: String; var days: Int
    var spend: Double; var conv: Int; var deep: Int; var cpr: Double?; var ctr: Double?; var cpm: Double?; var hook: Double?; var theme: String
    var spark: [SparkPt]; var score: CampScore
    var cleanName: String { Campaign(id: id, name: name).cleanName }
}
struct WBResp: Codable { var target: TargetCPA; var campaigns: [WBCampaign] }

/// §15 Campaign Control Center — analytical workbench over neon.db.
struct WorkbenchView: View {
    @ObservedObject var store = Store.shared
    var open: (String) -> Void
    var preload: WBResp? = nil
    @State private var loaded: WBResp?
    @State private var err: String?
    @State private var q = ""
    @State private var state = "all"
    @State private var sort = "recent"
    @State private var selected: Set<String> = []
    @State private var comparing = false
    @State private var width: CGFloat = 1200
    var compact: Bool { width < 1050 }
    var data: WBResp? { loaded ?? preload }

    static let themeAR = ["price": "عرض سعر", "project": "مشاريع", "seasonal": "موسمي", "brand": "براند", "other": "أخرى"]

    var rows: [WBCampaign] {
        var r = (data?.campaigns ?? []).filter { (state == "all" || $0.state == state) && (q.isEmpty || $0.cleanName.localizedCaseInsensitiveContains(q)) }
        switch sort {
        case "score": r.sort { ($0.score.score ?? -1) > ($1.score.score ?? -1) }
        case "cpr": r.sort { ($0.cpr ?? 99) < ($1.cpr ?? 99) }
        case "spend": r.sort { $0.spend > $1.spend }
        case "conv": r.sort { $0.conv > $1.conv }
        default: r.sort { ($0.state == "live" ? 0 : 1, $1.last_day) < ($1.state == "live" ? 0 : 1, $0.last_day) }
        }
        return r
    }

    var body: some View {
        MaybeScroll {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    SectionTitle(title: "الحملات", subtitle: "كل حملة من تاريخ الحساب — التقييم حسب هدفها، مع مكوّناته وحدوده")
                    Spacer()
                    if selected.count >= 2 {
                        Button { comparing = true } label: { Label("قارن (\(selected.count))", systemImage: "rectangle.split.3x1") }.buttonStyle(.borderedProminent)
                    }
                }
                HStack(spacing: 10) {
                    TextField("ابحث باسم الحملة…", text: $q).textFieldStyle(.roundedBorder).frame(minWidth: 160, maxWidth: 320)
                    Picker("", selection: $state) { Text("الكل").tag("all"); Text("شغّالة").tag("live"); Text("موقفة").tag("paused"); Text("خلصت").tag("ended") }
                        .pickerStyle(.segmented).frame(width: 300)
                    Picker("ترتيب", selection: $sort) {
                        Text("الأحدث").tag("recent"); Text("التقييم").tag("score"); Text("أرخص محادثة").tag("cpr"); Text("الأكثر صرف").tag("spend"); Text("الأكثر محادثات").tag("conv")
                    }.frame(width: 200)
                    Spacer()
                    if let t = data?.target, !compact { Text("الهدف \(usd(t.value)) للمحادثة · \(t.basis)").font(.caption).foregroundStyle(Brand.text2).lineLimit(1) }
                }
                if let e = err { ErrorCard(text: e) { Task { await load() } } }
                if data == nil && err == nil { SkeletonGrid() }
                VStack(spacing: 0) {
                    header
                    ForEach(rows) { c in
                        WBRow(c: c, target: data?.target.value ?? 2, compact: compact, selected: selected.contains(c.id),
                              toggle: { if selected.contains(c.id) { selected.remove(c.id) } else if selected.count < 4 { selected.insert(c.id) } },
                              open: { open(c.id) })
                        Divider()
                    }
                    if rows.isEmpty && data != nil { EmptyCard(icon: "magnifyingglass", text: "ما في حملات بهالفلتر") }
                }
                .surfaceCard()
                .background(GeometryReader { g in Color.clear.onAppear { width = g.size.width }.onChange(of: g.size.width) { w in width = w } })
            }
            .padding(24).frame(maxWidth: 1600).frame(maxWidth: .infinity)
        }
        .background(Brand.bg)
        .task { await load() }
        .sheet(isPresented: $comparing) {
            CompareSheet(items: (data?.campaigns ?? []).filter { selected.contains($0.id) }, target: data?.target.value ?? 2)
                .environment(\.layoutDirection, .rightToLeft)
        }
    }

    var header: some View {
        HStack(spacing: 10) {
            Text("").frame(width: 24)
            Text("الحملة").frame(minWidth: 220, maxWidth: .infinity, alignment: .leading)
            if !compact { Text("آخر 14 يوم").frame(width: 110) }
            col("صرف"); col("محادثات"); col("للمحادثة")
            if !compact { col("CTR"); col("وقفوا 3ث") }
            Text("التقييم").frame(width: 70)
        }
        .font(.caption.bold()).foregroundStyle(Brand.text2).padding(.horizontal, 14).padding(.vertical, 10)
    }
    func col(_ t: String) -> some View { Text(t).frame(width: 78, alignment: .leading) }

    func load() async {
        do { loaded = try await API.get("/api/workbench", timeout: 30); err = nil } catch { err = error.localizedDescription }
    }
}

struct WBRow: View {
    var c: WBCampaign; var target: Double; var compact: Bool = false; var selected: Bool; var toggle: () -> Void; var open: () -> Void
    @State private var showScore = false
    @State private var hover = false
    var body: some View {
        HStack(spacing: 10) {
            Button(action: toggle) { Image(systemName: selected ? "checkmark.square.fill" : "square").foregroundStyle(selected ? Brand.accent : Brand.text2) }
                .buttonStyle(.plain).frame(width: 24).help("اختار للمقارنة")
            VStack(alignment: .leading, spacing: 3) {
                Text(c.cleanName).font(.callout.bold()).foregroundStyle(Brand.text).lineLimit(1)
                HStack(spacing: 6) {
                    Pill(text: c.state == "live" ? "شغّالة" : c.state == "paused" ? "موقفة" : "خلصت", color: c.state == "live" ? Brand.ok : Brand.text2)
                        .layoutPriority(1)
                    Pill(text: WorkbenchView.themeAR[c.theme] ?? c.theme, color: Brand.accent2)
                    Text("\(c.first_day) ← \(c.last_day) · \(c.days) يوم").font(.caption2).foregroundStyle(Brand.text2).lineLimit(1)
                }
            }.frame(minWidth: 220, maxWidth: .infinity, alignment: .leading)
            if !compact { spark }
            cell(usd(c.spend)); cell("\(c.conv)")
            cell(usd(c.cpr), c.cpr.map { $0 <= target ? Brand.ok : $0 >= target * 1.6 ? Brand.bad : Brand.warn } ?? Brand.text2)
            if !compact { cell(c.ctr.map { String(format: "%.2f%%", $0) } ?? "—"); cell(c.hook.map { String(format: "%.0f%%", $0) } ?? "—") }
            Button { showScore.toggle() } label: { ScoreBadge(score: c.score.score) }.buttonStyle(.plain).frame(width: 70)
                .popover(isPresented: $showScore) { ScoreBreakdown(s: c.score).padding(14).frame(width: 340) }
        }
        .frame(height: 58)
        .padding(.horizontal, 14).padding(.vertical, 4)
        .background(hover ? Brand.surface.opacity(0.6) : Color.clear)
        .contentShape(Rectangle())
        .onHover { hover = $0 }
        .onTapGesture(count: 2, perform: open)
        .contextMenu { Button("افتح التفاصيل", action: open); Button(selected ? "شيلها من المقارنة" : "ضيفها للمقارنة", action: toggle) }
    }
    var spark: some View {
            Chart(c.spark) { p in
                AreaMark(x: .value("d", p.day), y: .value("c", p.conv)).foregroundStyle(Brand.ok.opacity(0.18))
                LineMark(x: .value("d", p.day), y: .value("c", p.conv)).foregroundStyle(Brand.ok)
            }
            .chartXAxis(.hidden).chartYAxis(.hidden).frame(width: 110, height: 30)
    }
    func cell(_ v: String, _ color: Color = Brand.text) -> some View {
        Text(v).font(.callout.monospacedDigit()).foregroundStyle(color).frame(width: 78, alignment: .leading)
    }
}

struct ScoreBadge: View {
    var score: Int?
    var body: some View {
        let c: Color = score == nil ? Brand.text2 : score! >= 70 ? Brand.ok : score! >= 45 ? Brand.warn : Brand.bad
        ZStack {
            Circle().stroke(c.opacity(0.2), lineWidth: 4)
            Circle().trim(from: 0, to: CGFloat(score ?? 0) / 100).stroke(c, style: StrokeStyle(lineWidth: 4, lineCap: .round)).rotationEffect(.degrees(-90))
            Text(score.map { "\($0)" } ?? "—").font(.caption.bold().monospacedDigit()).foregroundStyle(c)
        }.frame(width: 34, height: 34)
    }
}

struct ScoreBreakdown: View {
    var s: CampScore
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("التقييم التشخيصي: \(s.score.map { "\($0)/100" } ?? "ما في كفاية بيانات")").font(.headline)
            Text("الهدف: \(s.objective == "messaging" ? "رسائل" : "تفاعل/زيارات") — المعادلة بتختلف حسب الهدف").font(.caption).foregroundStyle(Brand.text2)
            ForEach(s.components, id: \.self) { c in
                VStack(alignment: .leading, spacing: 2) {
                    HStack { Text(c.name).font(.callout); Spacer(); Text("\(Int(c.weight))٪ وزن").font(.caption2).foregroundStyle(Brand.text2) }
                    ProgressView(value: c.value).tint(c.value >= 0.7 ? Brand.ok : c.value >= 0.45 ? Brand.warn : Brand.bad)
                    if let d = c.detail { Text(d).font(.caption2).foregroundStyle(Brand.text2) }
                }
            }
            if !s.limits.isEmpty {
                Text("الحدود").font(.caption.bold()).foregroundStyle(Brand.text2)
                ForEach(s.limits, id: \.self) { Text("• " + $0).font(.caption) }
            }
        }
    }
}

/// §5.4 side-by-side comparison
struct CompareSheet: View {
    @Environment(\.dismiss) private var dismiss
    var items: [WBCampaign]; var target: Double
    struct Bar: Identifiable { var id: String { name + metric }; var name: String; var metric: String; var value: Double }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack { Text("مقارنة الحملات").font(.title2.bold()); Spacer(); Button("إغلاق") { dismiss() }.keyboardShortcut(.cancelAction) }
            HStack(alignment: .top, spacing: 14) {
                chart("تكلفة المحادثة $ (أقل أحسن)", items.map { Bar(name: short($0), metric: "cpr", value: $0.cpr ?? 0) }, rule: target)
                chart("محادثات", items.map { Bar(name: short($0), metric: "conv", value: Double($0.conv)) })
            }
            HStack(alignment: .top, spacing: 14) {
                chart("CTR %", items.map { Bar(name: short($0), metric: "ctr", value: $0.ctr ?? 0) })
                chart("التقييم /100", items.map { Bar(name: short($0), metric: "score", value: Double($0.score.score ?? 0) ) })
            }
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 6) {
                GridRow { Text("").bold(); ForEach(items) { Text(short($0)).font(.caption.bold()).lineLimit(1) } }
                row("الصرف") { usd($0.spend) }; row("المحادثات") { "\($0.conv)" }; row("جدّية") { "\($0.deep)" }
                row("للمحادثة") { usd($0.cpr) }; row("CPM") { usd($0.cpm) }; row("الأيام") { "\($0.days)" }
                row("الزاوية") { WorkbenchView.themeAR[$0.theme] ?? $0.theme }
            }
            Label("المقارنة بين حملات بأوقات وجماهير مختلفة مش تجربة عشوائية — الفرق ممكن يكون من التوقيت أو الجمهور.", systemImage: "info.circle")
                .font(.caption).foregroundStyle(Brand.text2)
        }
        .padding(22).frame(width: 980, height: 760)
    }
    func short(_ c: WBCampaign) -> String { String(c.cleanName.prefix(22)) }
    func row(_ t: String, _ v: @escaping (WBCampaign) -> String) -> some View {
        GridRow { Text(t).foregroundStyle(Brand.text2); ForEach(items) { Text(v($0)).monospacedDigit() } }
    }
    func chart(_ title: String, _ bars: [Bar], rule: Double? = nil) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline)
            Chart {
                ForEach(bars) { b in BarMark(x: .value("الحملة", b.name), y: .value(title, b.value)).foregroundStyle(Brand.accent.gradient) }
                if let rule { RuleMark(y: .value("الهدف", rule)).foregroundStyle(Brand.ok).lineStyle(StrokeStyle(dash: [4])) }
            }.frame(height: 170)
        }.padding(12).frame(maxWidth: .infinity).surfaceCard(12)
    }
}

#endif
