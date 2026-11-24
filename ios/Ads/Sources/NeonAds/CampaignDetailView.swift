#if targetEnvironment(macCatalyst)
import SwiftUI
import Charts

struct CampaignDetailView: View {
    @ObservedObject var store = Store.shared
    @Environment(\.dismiss) private var dismiss
    var id: String
    @State private var d: Detail?
    @State private var err: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(d?.campaign.map { Campaign(id: $0.id, name: $0.name).cleanName } ?? "بجيب التفاصيل…").font(.title2.bold()).lineLimit(1)
                Spacer()
                if let l = store.campaigns.first(where: { $0.id == id })?.link, let u = URL(string: l) {
                    Link("Ads Manager", destination: u)
                }
                Button { Task { await store.askBrain("analyze_campaign", "حدّث تحليل الحملة", ["campaign": id]) } } label: {
                    Label("حدّث رأي Claude", systemImage: "brain.head.profile")
                }
                Button("إغلاق") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(16)
            Divider()
            ScrollView {
                if let d, d.ok { content(d).padding(20) }
                else if let e = err ?? d?.error { Text(e).foregroundStyle(Brand.bad).padding(40) }
                else { ProgressView("بجيب الأرقام من ميتا…").padding(60) }
            }
        }
        .background(AuroraBackground())
        .task {
            do { d = try await store.detail(id) } catch { err = error.localizedDescription }
        }
    }

    /// content without the window chrome (used by Snapshot)
    struct Page: View {
        var d: Detail
        var body: some View { CampaignDetailView(id: d.campaign?.id ?? "").content(d).padding(20) }
    }

    @ViewBuilder
    func content(_ d: Detail) -> some View {
        let t = d.totals ?? Totals()
        let a = d.analysis
        VStack(alignment: .leading, spacing: 16) {
            if let a { verdict(a, t) } else {
                Card { Text("ما في رأي لهالحملة لسا — اكتب لـ Claude بالتشات: حلّل الحملة \(id)").foregroundStyle(.secondary) }
            }
            kpis(d, t)
            if let a {
                if let obs = a.observations, !obs.isEmpty {
                    Card {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("ملاحظات").font(.headline)
                            ForEach(obs, id: \.self) { o in
                                let c: Color = o.tone == "good" ? Brand.ok : o.tone == "bad" ? Brand.bad : Brand.warn
                                HStack(alignment: .top, spacing: 8) {
                                    Image(systemName: o.tone == "good" ? "checkmark.circle.fill" : o.tone == "bad" ? "xmark.octagon.fill" : "exclamationmark.triangle.fill").foregroundStyle(c)
                                    Text(o.text).fixedSize(horizontal: false, vertical: true)
                                }
                                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                                .background(RoundedRectangle(cornerRadius: 10).fill(c.opacity(0.09)))
                            }
                        }
                    }
                }
                if a.verdict != "done", let rules = a.rules, !rules.isEmpty { rulesCard(a, rules, t.cpconv.opt) }
                if let why = a.why, !why.isEmpty { listCard("ليش هالقرار", why, numbered: false) }
            }
            breakdown("وين أجت النتائج — الأماكن", d.placement ?? [])
            breakdown("العمر والجنس", d.age ?? [])
            breakdown("المناطق", d.region ?? [])
            trend(d.history ?? [])
            daily(d.daily ?? [])
            settings(d)
            if let a {
                if let todo = a.todo, !todo.isEmpty { listCard("المطلوب منك هلأ", todo, numbered: true) }
                if let next = a.next, !next.isEmpty { listCard("للحملة الجاية", next, numbered: false) }
            }
        }
    }

    func verdict(_ a: Analysis, _ t: Totals) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("رأي Claude · \(a.written_at ?? "")").font(.caption).opacity(0.85)
            Text(a.verdict_label ?? "").font(.system(size: 24, weight: .bold))
            if let s = a.summary { Text(s).fixedSize(horizontal: false, vertical: true) }
            if let w = a.written_on?.conv, Int(t.conv.d) - w >= 5 {
                Text("في أرقام جديدة من وقت التحليل (\(w) ← \(Int(t.conv.d)) محادثة). اكتب لـ Claude: حدّث تحليل الحملة")
                    .font(.callout).padding(8).background(RoundedRectangle(cornerRadius: 8).fill(.white.opacity(0.2)))
            }
        }
        .foregroundStyle(.white).padding(18).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Brand.verdictColor(a.verdict)))
    }

    func kpis(_ d: Detail, _ t: Totals) -> some View {
        let budget = d.campaign?.daily_budget.opt.map { $0 / 100 }
        let left = (budget != nil && d.days_total != nil) ? max(0, budget! * Double(d.days_total!) - t.spend.d) : nil
        let hook = t.hook.opt
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4), spacing: 10) {
            Stat(title: "المصروف", value: usd(t.spend.opt), note: "\((d.daily ?? []).count) يوم" + (left.map { " · باقي ~\(usd($0))" } ?? ""))
            Stat(title: "محادثات جديدة", value: num(t.conv.opt), note: "\(Int(t.deep.d)) كمّلوا 3 رسائل+")
            Stat(title: "تكلفة المحادثة", value: usd(t.cpconv.opt), note: "ممتاز ≤ $2.5", color: Brand.cpColor(t.cpconv.opt))
            Stat(title: "نسبة النقر CTR", value: String(format: "%.2f%%", t.ctr.d), note: "المعدل 1–1.5%",
                 color: t.ctr.d >= 1.5 ? Brand.ok : t.ctr.d <= 0.8 ? Brand.bad : Brand.warn)
            Stat(title: "الوصول", value: num(t.reach.opt), note: "تكرار \(String(format: "%.2f", t.frequency.d))")
            Stat(title: "تكلفة الألف ظهور", value: usd(t.cpm.opt), note: "\(num(t.impressions.opt)) ظهور")
            Stat(title: "وقفوا على الفيديو", value: hook.map { String(format: "%.1f%%", $0) } ?? "—", note: "الهدف 30%",
                 color: hook == nil ? .primary : hook! >= 30 ? Brand.ok : hook! <= 15 ? Brand.bad : Brand.warn)
            Stat(title: "شافوا الفيديو", value: num(t.thruplay.opt), note: "ربع \(num(t.p25.opt)) · كامل \(num(t.p100.opt))")
        }
    }

    func rulesCard(_ a: Analysis, _ rules: [Rule], _ cp: Double?) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                Text("خطة القرار — متى تزيد ومتى تنقص").font(.headline)
                Text("تكلفة المحادثة الحالية: \(usd(cp)) · المراجعة الجاية: \(a.review_date ?? "—") — \(a.review_note ?? "")")
                    .font(.callout).foregroundStyle(.secondary)
                ForEach(rules, id: \.self) { r in
                    let now = r.applies(cp)
                    HStack(alignment: .top) {
                        HStack(spacing: 6) {
                            if now { Image(systemName: "arrowtriangle.left.fill").foregroundStyle(Brand.ok) }
                            Text(r.label).bold()
                        }.frame(width: 300, alignment: .leading)
                        Text(r.action).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 10).fill(now ? Brand.ok.opacity(0.1) : Color.primary.opacity(0.03)))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(now ? Brand.ok : Color.primary.opacity(0.08), lineWidth: now ? 2 : 1))
                }
                if let p = a.projection { Text(p).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            }
        }
    }

    func listCard(_ title: String, _ items: [String], numbered: Bool) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(.headline)
                ForEach(Array(items.enumerated()), id: \.offset) { i, x in
                    HStack(alignment: .top, spacing: 8) {
                        Text(numbered ? "\(i + 1)." : "•").bold().foregroundStyle(Brand.accent)
                        Text(x).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    func breakdown(_ title: String, _ rows: [BRow]) -> some View {
        let shown = rows.filter { $0.spend.d >= 0.05 || $0.conv.d > 0 }
        let maxSpend = max(shown.map { $0.spend.d }.max() ?? 0.01, 0.01)
        return Card {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.headline)
                HStack {
                    Text("").frame(width: 200, alignment: .leading)
                    Text("صرف").frame(width: 70, alignment: .leading)
                    Text("").frame(maxWidth: .infinity)
                    Text("محادثات").frame(width: 90, alignment: .leading)
                    Text("للمحادثة").frame(width: 80, alignment: .leading)
                    Text("نقرات").frame(width: 50, alignment: .leading)
                }.font(.caption).foregroundStyle(.secondary)
                ForEach(shown) { r in
                    HStack {
                        Text(r.label).bold().frame(width: 200, alignment: .leading)
                        Text(usd(r.spend.opt)).monospacedDigit().frame(width: 70, alignment: .leading)
                        GeometryReader { g in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.primary.opacity(0.08))
                                Capsule().fill(Brand.accent).frame(width: g.size.width * r.spend.d / maxSpend)
                            }
                        }.frame(height: 7).frame(maxWidth: .infinity)
                        HStack(spacing: 4) {
                            Text("\(Int(r.conv.d))").bold().foregroundStyle(r.conv.d > 0 ? Brand.ok : r.spend.d > 1 ? Brand.bad : .primary)
                            if r.deep.d > 0 { Text("(\(Int(r.deep.d)) جدّي)").font(.caption).foregroundStyle(.secondary) }
                        }.frame(width: 90, alignment: .leading)
                        Text(usd(r.cpconv.opt)).monospacedDigit().frame(width: 80, alignment: .leading)
                        Text(num(r.clicks.opt)).monospacedDigit().frame(width: 50, alignment: .leading)
                    }
                    .padding(.vertical, 3)
                    Divider()
                }
            }
        }
    }

    func trend(_ rows: [HistRow]) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("كيف عم تمشي — ساعة بساعة").font(.headline)
                    Spacer()
                    Text("بيتسجّل كل ساعة من وقت ما فتحت التطبيق").font(.caption).foregroundStyle(.secondary)
                }
                if rows.count < 2 {
                    Text("لسا ما في نقاط كفاية — بيبيّن الخط بعد ساعتين.").foregroundStyle(.secondary)
                } else {
                    Chart(rows) { r in
                        LineMark(x: .value("الوقت", String(r.at.suffix(11)).replacingOccurrences(of: "T", with: " ")),
                                 y: .value("محادثات (الإعلان كله)", r.ad_conv_total.d))
                            .foregroundStyle(Brand.ok).interpolationMethod(.monotone)
                            .symbol(Circle())
                    }
                    .chartYAxisLabel("محادثات")
                    .frame(height: 170)
                    if let f = rows.first, let l = rows.last {
                        let dc = l.ad_conv_total.d - f.ad_conv_total.d, ds = l.ad_spend_total.d - f.ad_spend_total.d
                        Text("من \(String(f.at.suffix(11)).replacingOccurrences(of: "T", with: " ")): +\(Int(dc)) محادثة بـ \(usd(ds))\(dc > 0 ? " (\(usd(ds / dc)) للمحادثة)" : "")")
                            .font(.callout.bold()).foregroundStyle(Brand.cpColor(dc > 0 ? ds / dc : nil))
                    }
                }
            }
        }
    }

    func daily(_ rows: [DayRow]) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                Text("يوم بيوم").font(.headline)
                if rows.isEmpty { Text("ما في أرقام لسا").foregroundStyle(.secondary) }
                else {
                    Chart(rows) { r in
                        BarMark(x: .value("اليوم", String(r.date.suffix(5))), y: .value("صرف $", r.spend.d))
                            .foregroundStyle(Brand.accent.gradient)
                            .annotation(position: .top) {
                                Text("\(Int(r.conv.d)) محادثة").font(.caption2.bold()).foregroundStyle(Brand.ok)
                            }
                    }
                    .chartYAxisLabel("صرف $")
                    .frame(height: 180)
                }
            }
        }
    }

    func settings(_ d: Detail) -> some View {
        let dest = ["MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP": "ماسنجر + إنستغرام + واتساب", "WHATSAPP": "واتساب فقط ✅",
                    "MESSENGER": "ماسنجر فقط", "INSTAGRAM_DIRECT": "إنستغرام فقط",
                    "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP": "إنستغرام + واتساب"][d.destination ?? ""] ?? (d.destination ?? "—")
        let tg = d.targeting
        return Card {
            VStack(alignment: .leading, spacing: 10) {
                Text("الإعدادات").font(.headline)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                    Stat(title: "الرسائل بتروح على", value: dest)
                    Stat(title: "الميزانية", value: d.campaign?.daily_budget.opt.map { usd($0 / 100) + " / يوم" } ?? "على مستوى المجموعة")
                    Stat(title: "المدة", value: "\(String((d.campaign?.start_time ?? "").prefix(10))) ← \(String((d.campaign?.stop_time ?? "مفتوحة").prefix(10)))")
                    Stat(title: "العمر", value: tg?.age ?? "—")
                    Stat(title: "المكان", value: (tg?.places ?? []).joined(separator: "، "))
                    Stat(title: "توسيع ميتا للجمهور", value: (tg?.advantage ?? false) ? "شغّال" : "مطفي")
                }
                if let i = tg?.interests, !i.isEmpty {
                    (Text("الاهتمامات: ").bold() + Text(i.joined(separator: "، "))).font(.callout).foregroundStyle(.secondary)
                }
                if let b = d.creative?.body {
                    Text(b).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.04)))
                        .textSelection(.enabled)
                }
            }
        }
    }
}

#endif
