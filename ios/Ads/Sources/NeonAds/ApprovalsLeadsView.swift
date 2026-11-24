#if targetEnvironment(macCatalyst)
import SwiftUI

// MARK: - §19 Approval inbox + recommendations + audit trail

struct ApprovalsView: View {
    @ObservedObject var store = Store.shared
    var openCampaign: (String) -> Void
    @State private var approvals: [Approval] = []
    @State private var recs: [Recommendation] = []
    @State private var audit: [AuditRow] = []
    @State private var loading = true
    @State private var tab = 0

    var body: some View {
        MaybeScroll {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    SectionTitle(title: "الموافقات والتوصيات", subtitle: "ولا إجراء على ميتا بيصير بدون موافقتك — وكل إشي بينسجل")
                    Spacer()
                    Picker("", selection: $tab) { Text("بانتظارك").tag(0); Text("التوصيات").tag(1); Text("سجل التدقيق").tag(2) }
                        .pickerStyle(.segmented).fixedSize()
                }
                if loading { SkeletonGrid() }
                else if tab == 0 {
                    let pending = approvals.filter { $0.status == "pending" }
                    if pending.isEmpty { EmptyCard(icon: "checkmark.seal", text: "ما في طلبات بانتظارك") }
                    ForEach(pending) { a in ApprovalCard(a: a) { Task { await load() } } }
                    let done = approvals.filter { $0.status != "pending" }
                    if !done.isEmpty {
                        SectionTitle(title: "قرارات سابقة", subtitle: nil)
                        ForEach(done) { a in
                            HStack {
                                Pill(text: a.status, color: a.status == "applied" ? Brand.ok : a.status == "failed" ? Brand.bad : Brand.text2)
                                Text("\(a.action) · \(a.target_id ?? "")").font(.callout)
                                Spacer()
                                Text(String((a.decided_at ?? a.created_at).prefix(16)).replacingOccurrences(of: "T", with: " ")).font(.caption).foregroundStyle(Brand.text2)
                            }.padding(10).surfaceCard(10)
                        }
                    }
                } else if tab == 1 {
                    if recs.isEmpty { EmptyCard(icon: "lightbulb", text: "ما في توصيات") }
                    ForEach(recs) { r in RecommendationCard(r: r, onChange: { Task { await load() } }, openCampaign: openCampaign) }
                } else {
                    ForEach(audit) { x in
                        HStack(spacing: 10) {
                            Image(systemName: x.ok == 1 ? "checkmark.circle" : "xmark.circle").foregroundStyle(x.ok == 1 ? Brand.ok : Brand.bad)
                            Text(x.action ?? "").font(.callout.monospaced())
                            Text("\(x.target_type ?? "") \(x.target_id ?? "")").font(.caption).foregroundStyle(Brand.text2)
                            if let n = x.note, !n.isEmpty { Text(n).font(.caption).foregroundStyle(Brand.text2).lineLimit(1) }
                            Spacer()
                            Text(x.at.replacingOccurrences(of: "T", with: " ")).font(.caption.monospacedDigit()).foregroundStyle(Brand.text2)
                        }.padding(.vertical, 6)
                        Divider()
                    }
                    if audit.isEmpty { EmptyCard(icon: "list.bullet.rectangle", text: "السجل فاضي") }
                }
            }
            .padding(24).frame(maxWidth: 1300).frame(maxWidth: .infinity)
        }
        .background(Brand.bg)
        .task { await load() }
    }

    func load() async {
        async let a: [Approval] = (try? API.get("/api/approvals")) ?? []
        async let r: CommandSummary? = try? API.get("/api/command?days=7")
        async let au: [AuditRow] = (try? API.get("/api/audit")) ?? []
        approvals = await a; recs = (await r)?.recommendations ?? []; audit = await au
        loading = false
    }
}

struct ApprovalCard: View {
    @ObservedObject var store = Store.shared
    var a: Approval
    var done: () -> Void
    @State private var note = ""
    @State private var busy = false
    @State private var showText = false
    @State private var pinned: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "checkmark.shield.fill").foregroundStyle(Brand.warn)
                Text(title).font(.headline)
                Spacer()
                Text(String(a.created_at.prefix(16)).replacingOccurrences(of: "T", with: " ")).font(.caption).foregroundStyle(Brand.text2)
            }
            HStack(spacing: 12) {
                box("الحالي", a.current_json)
                Image(systemName: "arrow.left").foregroundStyle(Brand.text2)
                box("المقترح", a.proposed_json)
            }
            if let r = a.reason { (Text("ليش: ").bold() + Text(r)).font(.callout) }
            if a.action == "bot_brief" {
                DisclosureGroup("شوف النص اللي رح ينطبّق بالضبط", isExpanded: $showText) {
                    Text(pinned ?? "…").font(.callout).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10).background(RoundedRectangle(cornerRadius: 10).fill(Brand.surface))
                }
                .font(.callout)
                .task(id: showText) {
                    guard showText, pinned == nil else { return }
                    struct T: Decodable { var ok: Bool; var text: String?; var error: String? }
                    let t: T? = try? await API.get("/api/bot-brief/approval/\(a.id)")
                    pinned = t?.text ?? t?.error ?? "ما قدرت أجيب النص"
                }
            }
            if let rk = a.risk { (Text("الخطورة: ").bold() + Text(rk)).font(.callout) }
            HStack {
                TextField("ملاحظة (اختياري)", text: $note).textFieldStyle(.roundedBorder)
                Button(a.action == "bot_brief" ? "وافق وطبّق على البوت" : "وافق ونفّذ على ميتا") { decide("approve") }.buttonStyle(.borderedProminent).tint(Brand.ok)
                Button("ارفض") { decide("reject") }.buttonStyle(.bordered)
                Button("عدّل") { decide("revision") }.buttonStyle(.bordered)
                Button("أجّل للمراجعة") { decide("schedule") }.buttonStyle(.bordered)
            }.disabled(busy)
        }
        .padding(16).surfaceCard()
    }
    var title: String {
        switch a.action {
        case "raise": return "رفع الميزانية 20%"; case "lower": return "تنزيل الميزانية 30%"; case "pause": return "إيقاف الحملة"
        case "bot_brief": return "تغيير نص بوت الواتساب"
        default: return a.action
        }
    }
    func box(_ t: String, _ j: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(t).font(.caption).foregroundStyle(Brand.text2)
            Text(pretty(j)).font(.callout.monospacedDigit().bold())
        }.padding(10).frame(maxWidth: .infinity, alignment: .leading).background(RoundedRectangle(cornerRadius: 10).fill(Brand.surface))
    }
    func pretty(_ j: String?) -> String {
        guard let j, let d = j.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return "—" }
        if a.action == "bot_brief" {
            let chars = (o["chars"] as? Int).map { "\(num(Double($0))) حرف" } ?? "—"
            return (o["rollback"] as? Bool == true ? "ترجيع نسخة قديمة · " : "") + chars
        }
        return o.map { k, v in k == "daily_budget" ? "الميزانية اليومية: $\(v)" : "\(k): \(v)" }.joined(separator: " · ")
    }
    func decide(_ d: String) {
        busy = true
        Task {
            let r = await store.osPost("/api/approvals/\(a.id)/decide", ["decision": d, "note": note])
            let doneMsg = a.action == "bot_brief" ? "انطبّق على البوت ✓" : "تنفّذ على ميتا ✓"
            let res = r["result"] as? [String: Any]
            store.toast = (r["ok"] as? Bool == true) ? (d == "approve" ? doneMsg : "تم") : (res?["error"] as? String ?? r["error"] as? String ?? "ما زبط")
            busy = false; done()
            await store.refreshApprovals()   // the sidebar's badge
        }
    }
}

// MARK: - §7 Lead CRM pipeline

struct LeadsView: View {
    @ObservedObject var store = Store.shared
    var preload: LeadsResp? = nil
    @State private var loaded: LeadsResp?
    var data: LeadsResp? { loaded ?? preload }
    @State private var err: String?
    @State private var adding = false
    @State private var open: Lead?

    var body: some View {
        MaybeScroll {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    SectionTitle(title: "العملاء المحتملين (CRM)", subtitle: "الهدف مش رسائل أكثر — الهدف زباين مؤهَّلين ومشاريع مربحة")
                    Spacer()
                    Button { adding = true } label: { Label("عميل جديد", systemImage: "person.badge.plus") }.buttonStyle(.borderedProminent).controlSize(.large)
                }
                if let e = err { ErrorCard(text: e) { Task { await load() } } }
                if let d = data {
                    metrics(d.metrics)
                    if !d.issues.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            SectionTitle(title: "إيراد عم يضيع", subtitle: "مهام لازم تنعمل هلأ")
                            ForEach(d.issues, id: \.self) { i in
                                Button { open = d.leads.first { $0.id == i.lead } } label: {
                                    HStack { Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Brand.bad); Text(i.text).foregroundStyle(Brand.text); Spacer() }
                                }.buttonStyle(.plain).padding(10).surfaceCard(10)
                            }
                        }
                    }
                    if d.leads.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("لسا ما في عملاء مسجّلين", systemImage: "person.crop.circle.badge.plus").font(.headline)
                            Text("كل محادثة واتساب جدّية سجّلها هون (الاسم، الرقم، الخدمة، المساحة، من أي حملة). لما تتحرّك بالمراحل لحد العقد، المخ بيحسب تكلفة العميل المؤهَّل والزبون والعائد الحقيقي — ويقارن الحملات بالزباين مش بالرسائل.")
                                .foregroundStyle(Brand.text2).fixedSize(horizontal: false, vertical: true)
                            Button { adding = true } label: { Label("سجّل أول عميل", systemImage: "plus") }.buttonStyle(.borderedProminent)
                        }.padding(16).surfaceCard()
                    }
                    pipeline(d)
                    if !d.lost_reasons.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            SectionTitle(title: "ليش خسرنا عملاء", subtitle: nil)
                            ForEach(d.lost_reasons.sorted { $0.value > $1.value }, id: \.key) { k, v in
                                HStack { Text(k); Spacer(); Text("\(v)").bold() }.padding(.vertical, 3)
                            }
                        }.padding(16).surfaceCard()
                    }
                } else if err == nil { SkeletonGrid() }
            }
            .padding(24).frame(maxWidth: 1600).frame(maxWidth: .infinity)
        }
        .background(Brand.bg)
        .task { await load() }
        .sheet(isPresented: $adding) { LeadForm(lead: nil, stages: data?.stages ?? []) { Task { await load() } }.environmentObject(store) }
        .sheet(item: $open) { l in LeadForm(lead: l, stages: data?.stages ?? []) { Task { await load() } }.environmentObject(store) }
    }

    func load() async {
        do { loaded = try await API.get("/api/leads"); err = nil } catch { err = error.localizedDescription }
    }

    func metrics(_ m: LeadMetrics) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 190, maximum: 320), spacing: 12)], spacing: 12) {
                KPICard(title: "عملاء محتملين", value: "\(m.leads)", delta: nil, goodWhenUp: true, source: "crm")
                KPICard(title: "تكلفة العميل", value: usd(m.cost_per_lead), delta: nil, goodWhenUp: false, source: "crm")
                KPICard(title: "تكلفة المؤهَّل", value: usd(m.cost_per_qualified), delta: nil, goodWhenUp: false, source: "crm", note: "\(m.qualified) مؤهَّل")
                KPICard(title: "تكلفة الزبون", value: usd(m.cost_per_customer), delta: nil, goodWhenUp: false, source: "crm", note: "\(m.won) تعاقد")
                KPICard(title: "تحويل لعقد", value: m.lead_to_contract.map { String(format: "%.1f%%", $0) } ?? "—", delta: nil, goodWhenUp: true, source: "crm")
                KPICard(title: "قيمة العروض المفتوحة", value: num(m.pipeline_value), delta: nil, goodWhenUp: true, source: "crm")
                KPICard(title: "الإيراد من التعاقدات", value: num(m.revenue), delta: nil, goodWhenUp: true, source: "crm", note: m.avg_deal.map { "متوسط \(num($0))" })
                KPICard(title: "العائد/الصرف (ROAS)", value: m.roas.map { String(format: "%.1fx", $0) } ?? "—", delta: nil, goodWhenUp: true, source: "crm")
                KPICard(title: "وقت أول رد (وسيط)", value: m.median_first_response_min.map { "\(Int($0)) د" } ?? "—", delta: nil, goodWhenUp: false, source: "crm")
                KPICard(title: "صرف الإعلانات بالفترة", value: usd(m.ad_spend_since_first_lead), delta: nil, goodWhenUp: nil, source: "meta_api")
            }
            if let n = m.attribution_note { Label(n, systemImage: "info.circle").font(.caption).foregroundStyle(Brand.text2) }
        }
    }

    func pipeline(_ d: LeadsResp) -> some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(d.stages) { s in
                    let items = d.leads.filter { $0.stage == s.key }
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(s.label_ar).font(.headline).foregroundStyle(s.is_won == 1 ? Brand.ok : s.is_lost == 1 ? Brand.bad : Brand.text)
                            Spacer(); Text("\(items.count)").font(.callout.bold()).foregroundStyle(Brand.text2)
                        }
                        if items.isEmpty { Text("—").foregroundStyle(Brand.text2).frame(maxWidth: .infinity).padding(.vertical, 20) }
                        ForEach(items) { l in
                            Button { open = l } label: { LeadCard(l: l) }.buttonStyle(.plain)
                        }
                    }
                    .padding(12).frame(width: 240, alignment: .topLeading)
                    .background(RoundedRectangle(cornerRadius: 14).fill(Brand.surface.opacity(0.7)))
                }
            }
        }
    }
}

struct LeadCard: View {
    var l: Lead
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(l.display).font(.callout.bold()).foregroundStyle(Brand.text).lineLimit(1)
            if let s = l.service { Text(s).font(.caption).foregroundStyle(Brand.text2) }
            HStack(spacing: 6) {
                if let a = l.area_m2 { Text("\(Int(a))م²").font(.caption2) }
                if let q = l.quotation_amount { Text("عرض \(num(q))").font(.caption2.bold()).foregroundStyle(Brand.accent) }
                if let c = l.contract_amount { Text("عقد \(num(c))").font(.caption2.bold()).foregroundStyle(Brand.ok) }
            }
            if let f = l.follow_up_on { Label(f, systemImage: "calendar").font(.caption2).foregroundStyle(Brand.warn) }
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading).surfaceCard(10)
    }
}

struct LeadForm: View {
    @ObservedObject var store = Store.shared
    @Environment(\.dismiss) private var dismiss
    var lead: Lead?
    var stages: [LeadStage]
    var saved: () -> Void
    @State private var f: [String: String] = [:]
    @State private var followUp = Date()
    @State private var hasFollowUp = false
    @State private var events: [LeadEvent] = []
    @State private var error: String?
    @State private var campaigns: [Campaign] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(lead == nil ? "عميل جديد" : lead!.display).font(.title2.bold())
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                        GridRow { field("الاسم", "name"); field("رقم الهاتف", "phone") }
                        GridRow { field("الخدمة (تصميم داخلي، خارجي، 3D…)", "service"); field("المساحة م²", "area_m2") }
                        GridRow { field("المنطقة", "location"); field("الميزانية التقريبية", "budget_range") }
                        GridRow { field("متى بده يبلّش", "timeline"); field("الموظف المسؤول", "assignee") }
                        GridRow { field("قيمة عرض السعر", "quotation_amount"); field("قيمة العقد", "contract_amount") }
                        GridRow { field("تكلفة التنفيذ (للربح)", "cost_amount"); field("سبب الخسارة", "lost_reason") }
                    }
                    HStack {
                        Picker("المرحلة", selection: Binding(get: { f["stage"] ?? "new" }, set: { f["stage"] = $0 })) {
                            ForEach(stages) { Text($0.label_ar).tag($0.key) }
                        }.frame(width: 260)
                        Picker("جاي من حملة", selection: Binding(get: { f["campaign_id"] ?? "" }, set: { f["campaign_id"] = $0 })) {
                            Text("مش معروف").tag("")
                            ForEach(campaigns.prefix(30)) { Text($0.cleanName).tag($0.id) }
                        }.frame(width: 320)
                    }
                    Toggle("موعد متابعة", isOn: $hasFollowUp)
                    if hasFollowUp { DatePicker("", selection: $followUp, displayedComponents: .date).labelsHidden() }
                    Text("ملاحظات").font(.caption).foregroundStyle(Brand.text2)
                    TextEditor(text: Binding(get: { f["notes"] ?? "" }, set: { f["notes"] = $0 })).frame(height: 70)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.15)))
                    if !events.isEmpty {
                        Text("السجل").font(.headline)
                        ForEach(events) { e in
                            Text("\(e.at.replacingOccurrences(of: "T", with: " ")) · \(e.kind ?? "") \(e.from_stage ?? "")→\(e.to_stage ?? "") \(e.note ?? "")")
                                .font(.caption.monospacedDigit()).foregroundStyle(Brand.text2)
                        }
                    }
                }
            }
            if let error { Text(error).foregroundStyle(Brand.bad) }
            HStack {
                Button("إلغاء") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("احفظ") { save() }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }
        .padding(22).frame(width: 720, height: 640)
        .environment(\.layoutDirection, .rightToLeft)
        .task {
            campaigns = store.campaigns
            if let l = lead {
                f = ["name": l.name ?? "", "phone": l.phone ?? "", "service": l.service ?? "", "area_m2": l.area_m2.map { String(Int($0)) } ?? "",
                     "location": l.location ?? "", "budget_range": l.budget_range ?? "", "timeline": l.timeline ?? "", "assignee": l.assignee ?? "",
                     "quotation_amount": l.quotation_amount.map { String($0) } ?? "", "contract_amount": l.contract_amount.map { String($0) } ?? "",
                     "cost_amount": l.cost_amount.map { String($0) } ?? "", "lost_reason": l.lost_reason ?? "", "stage": l.stage,
                     "campaign_id": l.campaign_id ?? "", "notes": l.notes ?? ""]
                if let fu = l.follow_up_on { hasFollowUp = true; let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; followUp = df.date(from: fu) ?? Date() }
                let d: LeadDetail? = try? await API.get("/api/leads/\(l.id)")
                events = d?.events ?? []
            } else { f["stage"] = "new"; f["source"] = "whatsapp" }
        }
    }

    func field(_ t: String, _ k: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(t).font(.caption).foregroundStyle(Brand.text2)
            TextField("", text: Binding(get: { f[k] ?? "" }, set: { f[k] = $0 })).textFieldStyle(.roundedBorder)
        }
    }

    func save() {
        var body = f
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.locale = Locale(identifier: "en_US_POSIX")
        body["follow_up_on"] = hasFollowUp ? df.string(from: followUp) : ""
        if body["campaign_id"] == "" { body["campaign_id"] = nil }
        if body["follow_up_on"] == "" { body["follow_up_on"] = nil }
        Task {
            let path = lead == nil ? "/api/leads" : "/api/leads/\(lead!.id)"
            let r = await store.osPost(path, body.compactMapValues { $0 })
            if r["ok"] as? Bool == true { saved(); dismiss() } else { error = r["error"] as? String ?? "ما زبط" }
        }
    }
}

#endif
