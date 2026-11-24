#if targetEnvironment(macCatalyst)
import SwiftUI

// MARK: - /api/lead-quality + /api/bot-brief — WhatsApp lead quality & the bot brief proposal

struct LQMix: Codable, Hashable { var chats: Int; var serious: Int; var small: Int; var not_fit: Int; var ghost: Int; var unclear: Int; var no_reply: Int; var serious_pct: Int }
struct LQWeek: Codable, Hashable, Identifiable {
    var week: String; var chats: Int; var serious: Int; var small: Int; var not_fit: Int; var ghost: Int; var unclear: Int; var no_reply: Int; var serious_pct: Int
    var id: String { week }
    var mix: LQMix { LQMix(chats: chats, serious: serious, small: small, not_fit: not_fit, ghost: ghost, unclear: unclear, no_reply: no_reply, serious_pct: serious_pct) }
}
struct LQCampaign: Codable, Hashable, Identifiable {
    var id: String; var name: String; var spend: Double; var chats: Int; var serious: Int; var small: Int; var not_fit: Int; var ghost: Int
    var unclear: Int; var no_reply: Int; var serious_pct: Int; var cost_per_serious: Double?
    var meta_conv: Int?; var coverage_pct: Int?; var est_serious: Double?; var cost_per_serious_est: Double?
    var mix: LQMix { LQMix(chats: chats, serious: serious, small: small, not_fit: not_fit, ghost: ghost, unclear: unclear, no_reply: no_reply, serious_pct: serious_pct) }
}
struct LQUnanswered: Codable, Hashable, Identifiable {
    var jid: String; var name: String?; var phone: String?; var hours: Double; var last_text: String; var customer_msgs: Int
    var from_ad: Bool; var needs_you: Bool; var tag: String?; var job: Bool?
    var id: String { jid }
}
struct LQSerious: Codable, Hashable, Identifiable {
    var jid: String; var name: String?; var phone: String?; var first_day: String; var area_m2: Int?; var location: String?; var campaign: String?
    var id: String { jid }
}
struct LQNoReply: Codable, Hashable { var name: String?; var phone: String?; var day: String }
struct LQLast: Codable, Hashable { var chats: Int?; var fetched: Int?; var at: String? }
struct LQRefresh: Codable, Hashable { var running: Bool; var last: LQLast?; var error: String? }
struct BotOption: Codable, Hashable { var label: String }
struct BotDecision: Codable, Hashable, Identifiable {
    var key: String; var kind: String; var question: String; var why: String?; var suggestion: String?; var options: [BotOption]?
    var id: String { key }
}
struct BotChange: Codable, Hashable { var title: String; var evidence: String }
struct BotApprovalRef: Codable, Hashable { var id: Int; var status: String; var created_at: String }
struct BotProposal: Codable, Hashable {
    var created_at: String; var decisions: [BotDecision]; var values: [String: String]; var changes: [BotChange]; var not_in_brief: [String]
    var text: String; var missing: [String]; var chars: Int; var current_chars: Int; var current_changed: Bool
    var last_approval: BotApprovalRef?; var backups: [String]
}
struct LQResp: Codable {
    var ok: Bool; var error: String?; var pulled_at: String?; var days: Int?; var overall: LQMix?; var by_week: [LQWeek]?
    var by_campaign: [LQCampaign]?; var unanswered: [LQUnanswered]?; var duplicate_bot_messages: Int?; var serious_not_in_crm: [LQSerious]?
    var location_known_pct: Int?; var labelled_by_claude: Int?; var rows: Int?; var method: String?
    var meta_conversations: Int?; var coverage_pct: Int?; var engaged: Int?; var duplicate_last_day: String?; var no_reply: [LQNoReply]?
    var refresh: LQRefresh?; var bot_brief: BotProposal?
}

enum LQCat: String, CaseIterable {
    case serious, small, not_fit, unclear, ghost, no_reply
    var title: String {
        switch self {
        case .serious: return "جدّي"; case .small: return "شغلة صغيرة"; case .not_fit: return "مش إلنا"; case .unclear: return "مش واضح"
        case .ghost: return "اختفى بعد ردّنا"; case .no_reply: return "ما انرد عليه"
        }
    }
    var color: Color {
        switch self {
        case .serious: return Brand.ok; case .small: return Brand.warn; case .not_fit: return Brand.bad; case .unclear: return Brand.accent.opacity(0.35)
        case .ghost: return Brand.text2.opacity(0.55); case .no_reply: return Color(red: 0.49, green: 0.23, blue: 0.93)
        }
    }
    func n(_ m: LQMix) -> Int {
        switch self {
        case .serious: return m.serious; case .small: return m.small; case .not_fit: return m.not_fit; case .unclear: return m.unclear
        case .ghost: return m.ghost; case .no_reply: return m.no_reply
        }
    }
}

/// One stacked bar: serious / small / not fit / ghost / unclear.
struct MixBar: View {
    var mix: LQMix
    var height: CGFloat = 14
    var body: some View {
        GeometryReader { g in
            HStack(spacing: 1.5) {
                ForEach(LQCat.allCases, id: \.self) { c in
                    let v = c.n(mix)
                    if v > 0 {
                        Rectangle().fill(c.color).frame(width: max(3, (g.size.width - 8) * CGFloat(v) / CGFloat(max(mix.chats, 1))))
                            .help("\(c.title): \(v)")
                    }
                }
            }
        }
        .frame(height: height).clipShape(RoundedRectangle(cornerRadius: height / 3))
        .environment(\.layoutDirection, .rightToLeft)
    }
}

struct LeadQualityView: View {
    @ObservedObject var store = Store.shared
    var go: (Section) -> Void = { _ in }
    var preload: LQResp? = nil
    @State private var loaded: LQResp?
    var data: LQResp? { loaded ?? preload }
    @State private var err: String?
    @State private var days = 60
    @State private var refreshing = false

    var body: some View {
        MaybeScroll {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let e = err { ErrorCard(text: e) { Task { await load() } } }
                if let d = data, d.ok, let o = d.overall {
                    kpis(d, o)
                    HStack(alignment: .top, spacing: 16) {
                        VStack(alignment: .leading, spacing: 16) { weeks(d); campaigns(d) }.frame(maxWidth: .infinity)
                        VStack(alignment: .leading, spacing: 16) { unanswered(d); seriousNew(d) }.frame(maxWidth: .infinity)
                    }
                    .modifier(StackWhenNarrow())
                    if let p = d.bot_brief { BotBriefCard(p: p) { Task { await load() } } }
                    if let m = d.method { Label(m, systemImage: "info.circle").font(.caption).foregroundStyle(Brand.text2).fixedSize(horizontal: false, vertical: true) }
                } else if let d = data, !d.ok {
                    EmptyCard(icon: "bubble.left.and.exclamationmark.bubble.right", text: d.error ?? "لسا ما في بيانات")
                } else if err == nil { SkeletonGrid() }
            }
            .padding(24).frame(maxWidth: 1500).frame(maxWidth: .infinity)
        }
        .background(Brand.bg)
        .task(id: days) { await load() }
    }

    var header: some View {
        ViewThatFits(in: .horizontal) {
            HStack { titleBlock; Spacer(); controls }
            VStack(alignment: .leading, spacing: 10) { titleBlock; controls }
        }
    }
    var titleBlock: some View {
        SectionTitle(title: "جودة الزباين", subtitle: "من محادثات الواتساب: مين جدّي، مين شغلة صغيرة، مين اختفى، ومين ما انرد عليه")
    }
    var controls: some View {
        HStack(spacing: 10) {
            Picker("", selection: $days) { Text("30 يوم").tag(30); Text("60 يوم").tag(60); Text("90 يوم").tag(90) }
                .pickerStyle(.segmented).fixedSize()
            VStack(alignment: .trailing, spacing: 1) {
                Text("آخر سحب").font(.caption2).foregroundStyle(Brand.text2)
                Text(when(data?.refresh?.last?.at ?? data?.pulled_at)).font(.caption.monospacedDigit())
            }
            Button { refresh() } label: {
                if refreshing || data?.refresh?.running == true { ProgressView().controlSize(.small) } else { Label("اسحب هلأ", systemImage: "arrow.down.circle") }
            }.buttonStyle(.bordered).disabled(refreshing).help("سحب للقراءة بس من ديسك الواتساب — كل 6 ساعات تلقائياً")
        }
    }

    func kpis(_ d: LQResp, _ o: LQMix) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 170, maximum: 300), spacing: 12)], spacing: 12) {
                KPICard(title: "محادثات من الإعلانات", value: "\(o.chats)", delta: nil, goodWhenUp: true, source: "first_party",
                        note: d.meta_conversations.map { "من \($0) حسب ميتا (\(d.coverage_pct ?? 0)%)" } ?? "آخر \(d.days ?? days) يوم")
                KPICard(title: "زباين جدّيين", value: "\(o.serious)", delta: nil, goodWhenUp: true, source: "first_party", note: "\(o.serious_pct)% من المحادثات", tint: Brand.ok)
                KPICard(title: "شغلات صغيرة", value: "\(o.small)", delta: nil, goodWhenUp: false, source: "first_party", note: pct(o.small, o.chats))
                KPICard(title: "مش إلنا", value: "\(o.not_fit)", delta: nil, goodWhenUp: false, source: "first_party", note: "وظائف، ترخيص… " + pct(o.not_fit, o.chats))
                KPICard(title: "اختفوا بعد ردّنا", value: "\(o.ghost)", delta: nil, goodWhenUp: false, source: "first_party", note: pct(o.ghost, o.chats))
                KPICard(title: "ما انرد عليهم أبداً", value: "\(o.no_reply)", delta: nil, goodWhenUp: false, source: "first_party",
                        note: "ولا رد منا خلال 24 ساعة", tint: o.no_reply > 0 ? Color(red: 0.49, green: 0.23, blue: 0.93) : Brand.text)
                KPICard(title: "المنطقة معروفة", value: "\(d.location_known_pct ?? 0)%", delta: nil, goodWhenUp: true, source: "first_party",
                        note: "من \(d.engaged ?? 0) زبون حكى معنا", tint: (d.location_known_pct ?? 0) < 50 ? Brand.warn : Brand.text)
                let waiting = (d.unanswered ?? []).filter { $0.job != true }.count
                KPICard(title: "زباين بستنوا رد هلأ", value: "\(waiting)", delta: nil, goodWhenUp: false, source: "first_party",
                        tint: waiting == 0 ? Brand.text : Brand.bad)
                KPICard(title: "ردود مكررة من البوت", value: "\(d.duplicate_bot_messages ?? 0)", delta: nil, goodWhenUp: false, source: "first_party",
                        note: d.duplicate_last_day.map { "آخر مرة \($0)" } ?? "ولا مرة")
            }
            HStack(spacing: 14) {
                ForEach(LQCat.allCases, id: \.self) { c in
                    HStack(spacing: 5) { Circle().fill(c.color).frame(width: 8, height: 8); Text(c.title).font(.caption).foregroundStyle(Brand.text2) }
                }
                Spacer()
                if let l = d.labelled_by_claude, let r = d.rows {
                    let rules = r - o.no_reply - l
                    Text(rules > 0 ? "Claude قرأ \(l) محادثة، و\(rules) جداد مصنّفين بقواعد كلمات (تقريبي) لحد ما يقراهم"
                                   : "Claude قرأ كل المحادثات محادثة محادثة").font(.caption).foregroundStyle(Brand.text2)
                }
            }
            MixBar(mix: o, height: 18)
        }
        .padding(16).surfaceCard()
    }

    func weeks(_ d: LQResp) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: "أسبوع بأسبوع", subtitle: "الأخضر هو اللي بدنا إياه يكبر")
            ForEach((d.by_week ?? []).suffix(10)) { w in
                HStack(spacing: 10) {
                    Text(weekLabel(w.week)).font(.caption.monospacedDigit()).foregroundStyle(Brand.text2).frame(width: 64, alignment: .leading)
                    MixBar(mix: w.mix)
                    Text("\(w.chats)").font(.caption.monospacedDigit()).frame(width: 26, alignment: .trailing)
                    Text("\(w.serious_pct)%").font(.caption.bold().monospacedDigit()).foregroundStyle(w.serious_pct >= 35 ? Brand.ok : Brand.text2)
                        .frame(width: 38, alignment: .trailing)
                }
            }
            if (d.by_week ?? []).isEmpty { Text("—").foregroundStyle(Brand.text2) }
        }
        .padding(16).surfaceCard()
    }

    func campaigns(_ d: LQResp) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionTitle(title: "حسب الحملة", subtitle: "الحملة اللي صرفت يوم أول رسالة — تقريبي")
                Spacer()
                ProvenanceChip(source: "meta_api")
            }
            ForEach(d.by_campaign ?? []) { c in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(c.name.replacingOccurrences(of: "\u{200e}", with: "")).font(.callout.bold()).lineLimit(1)
                        Spacer()
                        Text("صرف \(usd(c.spend))").font(.caption.monospacedDigit()).foregroundStyle(Brand.text2)
                    }
                    MixBar(mix: c.mix)
                    HStack(spacing: 12) {
                        Text("\(c.serious) جدّي من \(c.chats) شفناهم (\(c.serious_pct)%)").font(.caption)
                        Spacer()
                        if let m = c.meta_conv { Text("ميتا: \(m) محادثة · شفنا \(c.coverage_pct ?? 0)%").font(.caption).foregroundStyle(Brand.text2) }
                    }
                    HStack(spacing: 6) {
                        Text("تكلفة الزبون الجدّي").font(.caption).foregroundStyle(Brand.text2)
                        Spacer()
                        if let e = c.cost_per_serious_est {
                            Text("~" + usd(e)).font(.callout.bold().monospacedDigit())
                            ProvenanceChip(source: "ai_estimate")
                        }
                        if let u = c.cost_per_serious { Text("بالكثير " + usd(u)).font(.caption.monospacedDigit()).foregroundStyle(Brand.text2) }
                    }
                    .help("التقدير = الصرف ÷ (نسبة الجديين اللي شفناهم × محادثات ميتا). «بالكثير» = الصرف ÷ الجديين اللي شفناهم بس.")
                }
                .padding(10).background(RoundedRectangle(cornerRadius: 10).fill(Brand.surface.opacity(0.6)))
            }
            if (d.by_campaign ?? []).isEmpty { Text("ما في حملات بالفترة").foregroundStyle(Brand.text2) }
        }
        .padding(16).surfaceCard()
    }

    func unanswered(_ d: LQResp) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: "ما انرد عليهم", subtitle: "آخر رسالة من الزبون ولسا ما في رد منا (أكثر من ساعتين)")
            let list = d.unanswered ?? []
            if list.isEmpty { EmptyCard(icon: "checkmark.bubble", text: "كل الزباين انرد عليهم") }
            ForEach(list) { u in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: u.job == true ? "briefcase" : u.needs_you ? "exclamationmark.bubble.fill" : "bubble.left.fill")
                        .foregroundStyle(u.job == true ? Brand.text2 : u.needs_you || u.from_ad ? Brand.bad : Brand.warn)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(u.name ?? u.phone ?? "زبون").font(.callout.bold()).lineLimit(1)
                            if u.job == true { Pill(text: "طالب وظيفة", color: Brand.text2) } else if u.from_ad { Pill(text: "من إعلان", color: Brand.accent) }
                            if u.needs_you { Pill(text: "بدها إنت", color: Brand.bad) }
                        }
                        Text(u.last_text).font(.caption).foregroundStyle(Brand.text2).lineLimit(2)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 4) {
                        Text(ago(u.hours)).font(.caption.bold().monospacedDigit()).foregroundStyle(u.job == true ? Brand.text2 : u.hours > 24 ? Brand.bad : Brand.warn)
                        if let link = waLink(u.phone) {
                            Link(destination: link) { Label("افتح", systemImage: "arrow.up.forward.app") }.font(.caption)
                                .help("بيفتح المحادثة بالواتساب عندك — ما بنبعت إشي تلقائياً")
                        }
                    }
                }
                .padding(10).surfaceCard(10)
            }
        }
        .padding(16).surfaceCard()
    }

    func seriousNew(_ d: LQResp) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: "جدّيين مش بالـ CRM", subtitle: "سجّلهم عشان نحسب تكلفة الزبون الحقيقية")
            let list = d.serious_not_in_crm ?? []
            if list.isEmpty {
                HStack {
                    EmptyCard(icon: "person.crop.circle.badge.checkmark", text: "كل الجديين مسجّلين بالـ CRM")
                    Button("افتح الـ CRM") { go(.leads) }.buttonStyle(.bordered)
                }
            }
            ForEach(list) { s in
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.name ?? s.phone ?? "زبون").font(.callout.bold())
                        Text([s.first_day, s.area_m2.map { "\($0) م²" }, s.location.map(locAr)].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Brand.text2)
                    }
                    Spacer()
                    Button { add(s) } label: { Label("أضف للـ CRM", systemImage: "person.badge.plus") }.buttonStyle(.borderedProminent).controlSize(.small)
                }
                .padding(10).surfaceCard(10)
            }
        }
        .padding(16).surfaceCard()
    }

    // MARK: actions
    func load() async {
        do { loaded = try await API.get("/api/lead-quality?days=\(days)"); err = nil } catch { err = error.localizedDescription }
    }
    func refresh() {
        refreshing = true
        Task {
            _ = await store.osPost("/api/lead-quality/refresh")
            for _ in 0..<60 {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                await load()
                if data?.refresh?.running != true { break }
            }
            refreshing = false
            if let e = data?.refresh?.error { store.toast = e } else { store.toast = "انسحبت \(data?.refresh?.last?.fetched ?? 0) محادثة جديدة/متغيّرة" }
        }
    }
    func add(_ s: LQSerious) {
        Task {
            let r = await store.osPost("/api/lead-quality/to-crm", ["jid": s.jid])
            store.toast = (r["ok"] as? Bool == true) ? "انضاف للـ CRM ✓" : (r["error"] as? String ?? "ما زبط")
            await load()
        }
    }

    // MARK: formatting
    func locAr(_ l: String) -> String {
        ["amman_west": "غرب عمّان", "amman_east": "شرق عمّان", "amman_other": "عمّان", "amman_unspecified": "عمّان",
         "other_jordan": "برّا عمّان", "abroad": "برّا الأردن", "pin": "بعت لوكيشن"][l] ?? l
    }
    func pct(_ a: Int, _ b: Int) -> String { b > 0 ? "\(Int((Double(a) / Double(b) * 100).rounded()))%" : "—" }
    func ago(_ h: Double) -> String { h < 24 ? "\(Int(h)) س" : "\(Int(h / 24)) يوم" }
    func when(_ s: String?) -> String { s.map { String($0.prefix(16)).replacingOccurrences(of: "T", with: " ") } ?? "—" }
    func weekLabel(_ w: String) -> String { w.split(separator: "-").last.map { "أسبوع " + $0.dropFirst() } ?? w }
    func waLink(_ phone: String?) -> URL? {
        guard let p = phone?.filter(\.isNumber), p.count >= 9 else { return nil }
        return URL(string: "https://wa.me/\(p)")
    }
}

/// Side-by-side on wide windows, stacked below ~1000 pt.
struct StackWhenNarrow: ViewModifier {
    func body(content: Content) -> some View {
        ViewThatFits(in: .horizontal) {
            content.frame(minWidth: 1000)
            VStack(alignment: .leading, spacing: 16) { content }
        }
    }
}

// MARK: - Bot brief proposal: Hamed's decisions → approval → apply (via approvals box)

struct BotBriefCard: View {
    @ObservedObject var store = Store.shared
    var p: BotProposal
    var changed: () -> Void
    @State private var values: [String: String] = [:]
    @State private var fieldVersion: [String: Int] = [:]
    @FocusState private var focused: String?
    /// The proposal as the server last sent it, to tell the user's unsaved edits from the server's values.
    @State private var lastServer: BotProposal?
    @State private var showText = false
    @State private var busy = false
    @State private var error: String?

    var dirty: Bool { values != p.values }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Label("نص بوت الواتساب المقترح", systemImage: "text.bubble.fill").font(.title3.bold())
                    Text("مبني على تحليل المحادثات. ما بيتغيّر إشي على البوت إلا لما توافق بصندوق الموافقات — والنص الحالي بينحفظ عشان نرجعله.")
                        .font(.caption).foregroundStyle(Brand.text2).fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                if let a = p.last_approval {
                    Pill(text: "آخر طلب: " + statusAr(a.status), color: a.status == "applied" ? Brand.ok : a.status == "pending" ? Brand.warn : Brand.text2)
                }
            }
            if p.current_changed {
                Label("نص البوت على الديسك تغيّر من وقت ما انكتبت المسودة — رح أحدّثها قبل الطلب.", systemImage: "exclamationmark.triangle.fill")
                    .font(.callout).foregroundStyle(Brand.warn)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("شو بيتغيّر وليش").font(.headline)
                ForEach(p.changes, id: \.self) { c in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Brand.accent).font(.callout)
                        (Text(c.title).bold() + Text(" — ").foregroundStyle(Brand.text2) + Text(c.evidence).foregroundStyle(Brand.text2)).font(.callout)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            Divider()
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("قرارات إلك (\(p.decisions.count - missingDecisions.count)/\(p.decisions.count))").font(.headline)
                    Spacer()
                    if !missingDecisions.isEmpty { Text("لازم تتعبّى كلها قبل الطلب").font(.caption).foregroundStyle(Brand.warn) }
                }
                ForEach(p.decisions) { d in decisionRow(d) }
            }
            if let error { Text(error).foregroundStyle(Brand.bad).font(.callout) }
            HStack(spacing: 10) {
                Button { save() } label: { Label("احفظ القرارات", systemImage: "square.and.arrow.down") }
                    .buttonStyle(.bordered).disabled(!dirty || busy)
                if dirty { Text("في تغييرات مش محفوظة").font(.caption).foregroundStyle(Brand.warn) }
                Button { request() } label: { Label("اطلب الموافقة على النص", systemImage: "checkmark.shield") }
                    .buttonStyle(.borderedProminent).disabled(busy || !missingDecisions.isEmpty || p.last_approval?.status == "pending")
                Spacer()
                Button(showText ? "خبّي النص" : "شوف النص الكامل (\(num(Double(p.chars))) حرف)") { showText.toggle() }.buttonStyle(.borderless)
            }
            if showText {
                Text(p.text).font(.callout).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12).background(RoundedRectangle(cornerRadius: 10).fill(Brand.surface))
            }
            if !p.not_in_brief.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("مش بالنص (لازم ينحل بالديسك نفسه)").font(.caption.bold()).foregroundStyle(Brand.text2)
                    ForEach(p.not_in_brief, id: \.self) { Text("• " + $0).font(.caption).foregroundStyle(Brand.text2) }
                }
            }
            if !p.backups.filter({ $0.hasPrefix("business-") }).isEmpty {
                DisclosureGroup("نسخ قديمة من نص البوت") {
                    ForEach(p.backups.filter { $0.hasPrefix("business-") }, id: \.self) { b in
                        HStack {
                            Text(b).font(.caption.monospaced())
                            Spacer()
                            Button("اطلب ترجيعها") { rollback(b) }.buttonStyle(.bordered).controlSize(.small)
                        }
                    }
                }.font(.callout)
            }
        }
        .padding(18).surfaceCard()
        .onAppear { values = p.values; lastServer = p }
        .onChange(of: p) { n in
            // keep the user's unsaved edits; take the server's value for everything else
            let old = lastServer ?? n
            var merged = n.values
            for (k, v) in values where v != (old.values[k] ?? "") { merged[k] = v }
            values = merged
            lastServer = n
        }
    }

    var missingDecisions: [BotDecision] { p.decisions.filter { (values[$0.key] ?? "").trimmingCharacters(in: .whitespaces).isEmpty } }

    @ViewBuilder
    func decisionRow(_ d: BotDecision) -> some View {
        let filled = !(values[d.key] ?? "").trimmingCharacters(in: .whitespaces).isEmpty
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: filled ? "checkmark.circle.fill" : "circle").foregroundStyle(filled ? Brand.ok : Brand.text2)
                Text(d.question).font(.callout.bold())
            }
            if let w = d.why { Text(w).font(.caption).foregroundStyle(Brand.text2).fixedSize(horizontal: false, vertical: true) }
            if d.kind == "choice", let opts = d.options {
                // A radio list (macOS's .radioGroup has no Catalyst equivalent).
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(opts, id: \.label) { o in
                        Button { values[d.key] = o.label } label: {
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: values[d.key] == o.label ? "largecircle.fill.circle" : "circle")
                                    .foregroundStyle(values[d.key] == o.label ? Brand.accent : Brand.text2)
                                Text(o.label).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                            }
                        }.buttonStyle(.plain)
                    }
                }
            } else {
                HStack {
                    TextField(d.suggestion ?? "", text: binding(d.key), axis: .vertical)
                        .textFieldStyle(.roundedBorder).lineLimit(1...3)
                        .focused($focused, equals: d.key)
                        .id("\(d.key)#\(fieldVersion[d.key] ?? 0)")
                        .frame(maxWidth: d.kind == "number" ? 140 : .infinity)
                    if let s = d.suggestion, values[d.key] != s {
                        Button("استعمل الاقتراح") { useSuggestion(d.key, s) }.buttonStyle(.bordered).controlSize(.small)
                            .help(s)
                    }
                }
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(filled ? Brand.ok.opacity(0.05) : Brand.surface.opacity(0.6)))
    }

    /// A focused TextField keeps its own editing buffer and writes it back when it loses focus, which wiped the
    /// suggestion. End editing first, then set the value and rebuild that field so it shows the new text.
    func useSuggestion(_ k: String, _ s: String) {
        focused = nil
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        DispatchQueue.main.async {
            values[k] = s
            fieldVersion[k, default: 0] += 1
        }
    }

    func binding(_ k: String) -> Binding<String> { Binding(get: { values[k] ?? "" }, set: { values[k] = $0 }) }
    func statusAr(_ s: String) -> String {
        ["pending": "بانتظارك", "applied": "انطبّق", "rejected": "انرفض", "failed": "فشل", "revision": "تعديل", "scheduled": "مؤجّل"][s] ?? s
    }

    struct ValuesBody: Encodable { var values: [String: String] }

    func save(then: (() async -> Void)? = nil) {
        busy = true; error = nil
        Task {
            do {
                let d = try await API.post("/api/bot-brief/values", json: ValuesBody(values: values))
                let o = (try? JSONSerialization.jsonObject(with: d) as? [String: Any]) ?? [:]
                if o["ok"] as? Bool == false { error = o["error"] as? String } else if let then { await then() } else { store.toast = "انحفظت ✓"; changed() }
            } catch { self.error = error.localizedDescription }
            busy = false
        }
    }
    func request() {
        let go = {
            let r = await store.osPost("/api/bot-brief/request")
            if r["ok"] as? Bool == true { store.toast = "انضاف لصندوق الموافقات — وافق من هناك"; changed() }
            else { error = r["error"] as? String ?? "ما زبط" }
        }
        if dirty { save(then: go) } else { busy = true; Task { await go(); busy = false } }
    }
    func rollback(_ b: String) {
        Task {
            let r = await store.osPost("/api/bot-brief/rollback", ["backup": b])
            store.toast = (r["ok"] as? Bool == true) ? "طلب الترجيع بصندوق الموافقات" : (r["error"] as? String ?? "ما زبط")
            changed()
        }
    }
}

#endif
