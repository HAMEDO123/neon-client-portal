#if targetEnvironment(macCatalyst)
import SwiftUI
import Charts

@MainActor
final class CommandStore: ObservableObject {
    @Published var data: CommandSummary?
    @Published var error: String?
    @Published var loading = false
    @Published var days = 7
    func load() async {
        loading = true
        do { data = try await API.get("/api/command?days=\(days)", timeout: 30); error = nil } catch { self.error = error.localizedDescription }
        loading = false
    }
    func syncNow() async {
        loading = true
        _ = try? await API.data("/api/sync", method: "POST", body: Data("{}".utf8), headers: ["Content-Type": "application/json"], timeout: 300)
        await load()
    }
}

/// Home — "What is happening, why, what next, likely impact, can we do it safely?"
struct CommandCenterView: View {
    @ObservedObject var store = Store.shared
    @StateObject private var m = CommandStore()
    var go: (Section) -> Void
    var openCampaign: (String) -> Void
    var preload: CommandSummary? = nil

    var body: some View {
        MaybeScroll {
            VStack(alignment: .leading, spacing: 18) {
                header
                if let e = m.error { ErrorCard(text: e) { Task { await m.load() } } }
                if let d = m.data ?? preload {
                    overview(d)
                    briefing(d)
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 16) {
                            performance(d).frame(minWidth: 560, maxWidth: .infinity)
                            actionCenter(d).frame(width: 320)
                        }
                        VStack(spacing: 16) { performance(d); actionCenter(d) }
                    }
                    brain(d)
                } else if m.error == nil && preload == nil {
                    SkeletonGrid()
                }
            }
            .padding(24)
            .frame(maxWidth: 1500)
            .frame(maxWidth: .infinity)
        }
        .background(Brand.bg)
        .task { await m.load() }
        .onChange(of: m.days) { _ in Task { await m.load() } }
    }

    var header: some View {
        ViewThatFits(in: .horizontal) {
            headerRow
            VStack(alignment: .leading, spacing: 10) { titleBlock; HStack { periodPicker; FreshnessBadge(f: m.data?.freshness, loading: m.loading) { Task { await m.syncNow() } } } }
        }
    }
    var titleBlock: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("مركز القيادة").font(.system(size: 28, weight: .bold)).foregroundStyle(Brand.text)
            Text("قسم التسويق كامل — بالأرقام الحقيقية").foregroundStyle(Brand.text2)
        }
    }
    var periodPicker: some View {
        Picker("", selection: $m.days) {
            Text("7 أيام").tag(7); Text("30 يوم").tag(30); Text("90 يوم").tag(90); Text("سنة").tag(365)
        }.pickerStyle(.segmented).frame(width: 300)
    }
    var headerRow: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text("مركز القيادة").font(.system(size: 28, weight: .bold)).foregroundStyle(Brand.text)
                Text("قسم التسويق كامل — بالأرقام الحقيقية").foregroundStyle(Brand.text2)
            }
            Spacer()
            Picker("", selection: $m.days) {
                Text("7 أيام").tag(7); Text("30 يوم").tag(30); Text("90 يوم").tag(90); Text("سنة").tag(365)
            }.pickerStyle(.segmented).frame(width: 300)
            FreshnessBadge(f: m.data?.freshness, loading: m.loading) { Task { await m.syncNow() } }
        }
    }

    // §14.1 Executive overview — only metrics with real data
    func overview(_ d: CommandSummary) -> some View {
        let c = d.current, p = d.previous
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 200, maximum: 360), spacing: 12)], spacing: 12) {
            KPICard(title: "الصرف", value: usd(c.spend), delta: pct(c.spend, p.spend), goodWhenUp: nil, source: "meta_api")
            KPICard(title: "محادثات واتساب", value: "\(c.conv)", delta: pct(Double(c.conv), Double(p.conv)), goodWhenUp: true, source: "meta_api")
            KPICard(title: "تكلفة المحادثة", value: usd(c.cpr), delta: pct(c.cpr, p.cpr), goodWhenUp: false, source: "meta_api",
                    note: "الهدف \(usd(d.target.value)) · \(d.target.basis)", tint: Brand.cpColor(c.cpr))
            KPICard(title: "محادثات جدّية (3 رسائل+)", value: "\(c.deep)", delta: pct(Double(c.deep), Double(p.deep)), goodWhenUp: true, source: "meta_api")
            if d.leads.total > 0 {
                KPICard(title: "عملاء مؤهَّلين", value: "\(d.leads.qualified)", delta: nil, goodWhenUp: true, source: "crm",
                        note: "من \(d.leads.total) عميل محتمل")
                KPICard(title: "قيمة عروض الأسعار", value: num(d.leads.pipeline_value), delta: nil, goodWhenUp: true, source: "crm")
                KPICard(title: "تعاقدات", value: "\(d.leads.won)", delta: nil, goodWhenUp: true, source: "crm", note: "بقيمة \(num(d.leads.won_value))")
            } else {
                EmptyKPI(title: "العملاء والإيراد", text: "سجّل أول عميل بالـ CRM عشان نحسب تكلفة العميل المؤهَّل والإيراد") { go(.leads) }
            }
            KPICard(title: "حملات شغّالة", value: "\(d.active_campaigns)", delta: nil, goodWhenUp: nil, source: "meta_api")
        }
    }

    // §14.2 AI executive briefing — top 3
    func briefing(_ d: CommandSummary) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: "أهم 3 إشيات هلأ", subtitle: "مرتّبة حسب الأثر × قوة الدليل × الاستعجال × قابلية التنفيذ")
            if d.recommendations.isEmpty {
                EmptyCard(icon: "checkmark.circle", text: "ما في توصيات مفتوحة — بيتحدّث بعد كل مزامنة (كل 3 ساعات)")
            }
            ForEach(d.recommendations.prefix(3)) { r in
                RecommendationCard(r: r, onChange: { Task { await m.load() } }, openCampaign: openCampaign)
            }
        }
    }

    // §14.3 Performance visualization
    func performance(_ d: CommandSummary) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: "الأداء عبر الزمن", subtitle: "الصرف والمحادثات يومياً — من ميتا")
            if d.series.isEmpty { EmptyCard(icon: "chart.xyaxis.line", text: "ما في أرقام بهالفترة") }
            else {
                Chart {
                    ForEach(d.series) { r in
                        BarMark(x: .value("اليوم", r.day), y: .value("صرف", r.spend ?? 0)).foregroundStyle(Brand.accent.opacity(0.25))
                        LineMark(x: .value("اليوم", r.day), y: .value("محادثات", Double(r.conv ?? 0))).foregroundStyle(Brand.ok)
                            .symbol(Circle()).interpolationMethod(.monotone)
                    }
                }
                .chartXAxis { AxisMarks(values: .automatic(desiredCount: 6)) }
                .frame(height: 240)
                HStack(spacing: 14) {
                    Label("الصرف $", systemImage: "square.fill").foregroundStyle(Brand.accent.opacity(0.5))
                    Label("المحادثات", systemImage: "circle.fill").foregroundStyle(Brand.ok)
                }.font(.caption)
            }
        }
        .padding(16).surfaceCard()
    }

    // §14.4 Action center
    func actionCenter(_ d: CommandSummary) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: "مركز الإجراءات", subtitle: nil)
            ActionLine(icon: "checkmark.shield", title: "بانتظار موافقتك", value: "\(d.approvals_pending)", tint: d.approvals_pending > 0 ? Brand.warn : Brand.text2) { go(.approvals) }
            ActionLine(icon: "exclamationmark.triangle", title: "توصيات مفتوحة", value: "\(d.recommendations.count)", tint: Brand.accent) { go(.approvals) }
            ActionLine(icon: "person.2", title: "عملاء بالـ CRM", value: "\(d.leads.total)", tint: Brand.accent2) { go(.leads) }
            ActionLine(icon: "binoculars", title: "السوق والمنافسين", value: "", tint: Brand.text2) { go(.market) }
            Divider()
            Button { store.showAsk = true } label: { Label("اسأل NEON AI عن هالأرقام", systemImage: "sparkles").frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent).controlSize(.large)
        }
        .padding(16).surfaceCard()
    }

    // §14.6 Marketing brain — memory with provenance
    func brain(_ d: CommandSummary) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: "ذاكرة التسويق", subtitle: "أنماط مستخرجة من تاريخ حسابك — مع حجم العيّنة. الفرضية بتضل فرضية لحد ما تكفي البيانات.")
            ForEach(d.knowledge) { k in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: k.status == "supported" ? "checkmark.seal.fill" : "questionmark.diamond")
                        .foregroundStyle(k.status == "supported" ? Brand.ok : Brand.warn)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(k.statement).foregroundStyle(Brand.text).fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 8) {
                            Pill(text: k.status == "supported" ? "مدعومة بالبيانات" : "فرضية", color: k.status == "supported" ? Brand.ok : Brand.warn)
                            Text("عيّنة \(k.sample_size ?? 0) محادثة").font(.caption).foregroundStyle(Brand.text2)
                            ProvenanceChip(source: k.source)
                        }
                    }
                    Spacer()
                }
                .padding(12).background(RoundedRectangle(cornerRadius: 12).fill(Brand.surface.opacity(0.6)))
            }
        }
        .padding(16).surfaceCard()
    }

    func pct(_ a: Double?, _ b: Double?) -> Double? {
        guard let a, let b, b > 0 else { return nil }
        return (a / b - 1) * 100
    }
}

// MARK: - building blocks

struct SectionTitle: View {
    var title: String; var subtitle: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.title3.bold()).foregroundStyle(Brand.text)
            if let subtitle { Text(subtitle).font(.caption).foregroundStyle(Brand.text2) }
        }
    }
}

struct KPICard: View {
    var title: String; var value: String; var delta: Double?; var goodWhenUp: Bool?; var source: String?
    var note: String? = nil; var tint: Color = Brand.text
    @State private var hover = false
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.callout).foregroundStyle(Brand.text2).lineLimit(1).minimumScaleFactor(0.8)
            HStack(alignment: .firstTextBaseline) {
                Text(value).font(.system(size: 26, weight: .bold, design: .rounded)).foregroundStyle(tint).lineLimit(1).minimumScaleFactor(0.6)
                    .contentTransition(.numericText())
                Spacer(minLength: 4)
                ProvenanceChip(source: source)
            }
            HStack(spacing: 6) {
                if let delta {
                    let up = delta >= 0
                    let good = goodWhenUp.map { $0 == up }
                    Label(String(format: "%@%.0f%%", up ? "+" : "", delta), systemImage: up ? "arrow.up.right" : "arrow.down.right")
                        .font(.caption.bold()).foregroundStyle(good == nil ? Brand.text2 : (good! ? Brand.ok : Brand.bad))
                    Text("عن الفترة السابقة").font(.caption2).foregroundStyle(Brand.text2)
                } else if let note { Text(note).font(.caption).foregroundStyle(Brand.text2).lineLimit(1) }
            }
            if delta != nil, let note { Text(note).font(.caption2).foregroundStyle(Brand.text2).lineLimit(1) }
        }
        .padding(14).frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading)
        .surfaceCard(14)
        .scaleEffect(hover ? 1.01 : 1).animation(.easeOut(duration: 0.15), value: hover)
        .onHover { hover = $0 }
    }
}

struct EmptyKPI: View {
    var title: String; var text: String; var act: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.callout).foregroundStyle(Brand.text2)
            Text(text).font(.callout).foregroundStyle(Brand.text).fixedSize(horizontal: false, vertical: true)
            Button("افتح الـ CRM", action: act).buttonStyle(.borderless)
        }
        .padding(14).frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 14).strokeBorder(Brand.accent.opacity(0.35), style: StrokeStyle(lineWidth: 1.5, dash: [5])))
    }
}

struct ActionLine: View {
    var icon: String; var title: String; var value: String; var tint: Color; var act: () -> Void
    var body: some View {
        Button(action: act) {
            HStack {
                Image(systemName: icon).foregroundStyle(tint).frame(width: 22)
                Text(title).foregroundStyle(Brand.text)
                Spacer()
                Text(value).font(.headline.monospacedDigit()).foregroundStyle(tint)
                Image(systemName: "chevron.left").font(.caption).foregroundStyle(Brand.text2)
            }.padding(.vertical, 6).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }
}

struct FreshnessBadge: View {
    var f: Freshness?; var loading: Bool; var sync: () -> Void
    var body: some View {
        let ok = f?.health?.status == "ok"
        Button(action: sync) {
            HStack(spacing: 6) {
                if loading { ProgressView().controlSize(.small) } else { Circle().fill(ok ? Brand.ok : Brand.warn).frame(width: 8, height: 8) }
                VStack(alignment: .leading, spacing: 0) {
                    Text(ok ? "البيانات محدّثة" : "المزامنة فيها مشكلة").font(.caption.bold())
                    Text(String((f?.last_ok?.finished_at ?? "—").replacingOccurrences(of: "T", with: " ").prefix(16))).font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .buttonStyle(.bordered).help(f?.health?.detail ?? "زامن من ميتا هلأ")
    }
}

struct ErrorCard: View {
    var text: String; var retry: () -> Void
    var body: some View {
        HStack { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Brand.bad); Text(text); Spacer(); Button("حاول مرة ثانية", action: retry) }
            .padding(14).surfaceCard()
    }
}

struct EmptyCard: View {
    var icon: String; var text: String
    var body: some View {
        HStack(spacing: 10) { Image(systemName: icon).foregroundStyle(Brand.text2); Text(text).foregroundStyle(Brand.text2) }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading).surfaceCard()
    }
}

struct SkeletonGrid: View {
    @State private var on = false
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 12)], spacing: 12) {
            ForEach(0..<8, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 14).fill(Brand.surface).frame(height: 96).opacity(on ? 0.5 : 1)
            }
        }
        .onAppear { withAnimation(.easeInOut(duration: 0.9).repeatForever()) { on = true } }
    }
}

// MARK: - §2.4 Structured recommendation card

struct RecommendationCard: View {
    @ObservedObject var store = Store.shared
    var r: Recommendation
    var onChange: () -> Void
    var openCampaign: (String) -> Void
    @State private var expanded = false
    @State private var dismissing = false
    @State private var reason = ""
    @State private var busy = false

    var riskColor: Color { r.risk == "high" ? Brand.bad : r.risk == "medium" ? Brand.warn : Brand.ok }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(r.title).font(.headline).foregroundStyle(Brand.text)
                    if let p = r.problem { Text(p).foregroundStyle(Brand.text2).fixedSize(horizontal: false, vertical: true) }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    HStack(spacing: 6) { Text("الثقة").font(.caption2).foregroundStyle(Brand.text2); ConfidenceBar(value: r.confidence ?? 0) }
                    HStack(spacing: 6) {
                        Pill(text: "خطورة: " + (r.risk == "high" ? "عالية" : r.risk == "medium" ? "متوسطة" : "منخفضة"), color: riskColor)
                        Pill(text: "البيانات: " + (r.data_sufficiency ?? "—"), color: Brand.accent2)
                        ProvenanceChip(source: r.source)
                    }
                }
            }
            if let e = r.expected {
                HStack(spacing: 10) {
                    if let k = e.keep { mini("لو خليناها", "\(k.conv ?? 0) محادثة", usd(k.spend)) }
                    if let i = e.increase_20, let c = i.conv, c.count == 2 { mini("لو رفعنا 20%", "\(c[0])–\(c[1]) محادثة", "+\(usd(i.extra_spend))") }
                    if let rd = e.reduce_30 { mini("لو نزّلنا 30%", "\(rd.conv ?? 0) محادثة", "توفير \(usd(rd.saves))") }
                }
                if let a = e.assumptions {
                    Label((e.statistically_validated == true ? "" : "تقدير مبني على افتراضات — مش مثبت إحصائياً: ") + a, systemImage: "function")
                        .font(.caption).foregroundStyle(Brand.text2)
                }
            }
            if expanded { details }
            HStack(spacing: 8) {
                Button(expanded ? "أخفِ الدليل" : "شوف الدليل") { withAnimation { expanded.toggle() } }.buttonStyle(.bordered)
                if r.action_params != nil {
                    Button { act("request") } label: { Label("اطلب موافقة للتنفيذ", systemImage: "checkmark.shield") }.buttonStyle(.borderedProminent)
                }
                Button { act("save") } label: { Label("احفظ", systemImage: "bookmark") }.buttonStyle(.bordered)
                Button { Task { await store.askBrain("analyze_campaign", "حلّل التوصية «\(r.title)» وقدّم بدائل", ["campaign": r.scope_id ?? "", "recommendation": "\(r.id)"]) } } label: {
                    Label("اسأل Claude", systemImage: "sparkles")
                }.buttonStyle(.bordered)
                if let c = r.scope_id, r.scope == "campaign" { Button("افتح الحملة") { openCampaign(c) }.buttonStyle(.borderless) }
                Spacer()
                Button(role: .destructive) { dismissing = true } label: { Text("ارفض") }.buttonStyle(.bordered)
            }
            .disabled(busy)
            if dismissing {
                HStack {
                    TextField("ليش؟ (المخ بيتعلّم من السبب)", text: $reason).textFieldStyle(.roundedBorder)
                    Button("ارفض بسبب") { act("dismiss", ["reason": reason]) }.disabled(reason.isEmpty)
                    Button("إلغاء") { dismissing = false }
                }
            }
        }
        .padding(16)
        .surfaceCard()
        .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 2).fill(riskColor).frame(width: 4).padding(.vertical, 12) }
    }

    var details: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let obs = r.evidence?.observations, !obs.isEmpty {
                Text("الملاحظات (الدليل)").font(.caption.bold()).foregroundStyle(Brand.text2)
                ForEach(obs, id: \.self) { Text("• " + $0).font(.callout) }
            }
            if let f = r.evidence?.findings, !f.isEmpty {
                Text("إشارات مكتشفة").font(.caption.bold()).foregroundStyle(Brand.text2)
                ForEach(f, id: \.self) { x in Text("⚠︎ \(x.title) — \(x.note ?? "")").font(.callout) }
            }
            if let a = r.alternatives, !a.isEmpty {
                Text("تفسيرات بديلة").font(.caption.bold()).foregroundStyle(Brand.text2)
                ForEach(a, id: \.self) { Text("• " + $0).font(.callout) }
            }
            if let i = r.impact { (Text("الأثر على البزنس: ").bold() + Text(i)).font(.callout) }
            if let mo = r.monitoring { (Text("المراقبة: ").bold() + Text(mo)).font(.callout) }
            if let rb = r.rollback, rb != "—" { (Text("شرط التراجع: ").bold() + Text(rb)).font(.callout) }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Brand.surface.opacity(0.6)))
    }

    func mini(_ t: String, _ v: String, _ s: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(t).font(.caption2).foregroundStyle(Brand.text2)
            Text(v).font(.callout.bold()).foregroundStyle(Brand.text)
            Text(s).font(.caption2).foregroundStyle(Brand.text2)
        }.padding(8).frame(maxWidth: .infinity, alignment: .leading).background(RoundedRectangle(cornerRadius: 10).fill(Brand.surface.opacity(0.7)))
    }

    func act(_ what: String, _ body: [String: String] = [:]) {
        busy = true
        Task {
            let r2 = await store.osPost("/api/recommendations/\(r.id)/\(what)", body)
            store.toast = (r2["ok"] as? Bool == true) ? (what == "request" ? "انطلبت الموافقة — شوف «الموافقات»" : "تم") : (r2["error"] as? String ?? "ما زبط")
            busy = false; dismissing = false
            onChange()
        }
    }
}

#endif
