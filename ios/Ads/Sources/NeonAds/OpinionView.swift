#if targetEnvironment(macCatalyst)
import SwiftUI

struct OpinionPage: View {
    @ObservedObject var store = Store.shared
    var open: (String) -> Void

    var analyzed: [Campaign] {
        store.campaigns.filter { store.analyses[$0.id] != nil }
            .sorted { a, b in
                if a.isLive != b.isLive { return a.isLive }
                return (store.analyses[a.id]?.written_at ?? "") > (store.analyses[b.id]?.written_at ?? "")
            }
    }
    var unseen: [Campaign] { store.campaigns.filter { $0.isLive && store.analyses[$0.id] == nil } }

    var body: some View {
        Group {
            VStack(alignment: .leading, spacing: 16) {
                PageHeader(title: "رأيي بحملاتك", subtitle: "رأي Claude كمسؤول تسويق — والأرقام بتنسحب من ميتا مباشرة")
                if let t = store.today {
                    let main = store.widget?.campaigns?.first
                    HStack(spacing: 10) {
                        Stat(title: "محادثات اليوم", value: "\(main?.ad_conv_today ?? t.conv)", color: Brand.ok)
                        Stat(title: "مجموع المحادثات على الإعلان", value: main?.ad_conv_total.map(String.init) ?? "—", note: "من أول يوم لهاللحظة", color: Brand.ok)
                        Stat(title: "صرف اليوم", value: usd(t.spend))
                        Stat(title: "تكلفة المحادثة اليوم", value: t.conv > 0 ? usd(t.spend / Double(t.conv)) : "—",
                             color: Brand.cpColor(t.conv > 0 ? t.spend / Double(t.conv) : nil))
                        Stat(title: "حملات شغّالة", value: "\(store.campaigns.filter(\.isLive).count)")
                    }
                }
                ForEach(store.widget?.campaigns ?? []) { wc in
                    if let adv = wc.advice { AdviceCard(campaign: wc, advice: adv) }
                }
                if let e = store.campaignsError {
                    Card { Label(e, systemImage: "exclamationmark.triangle").foregroundStyle(Brand.bad) }
                }
                ForEach(analyzed) { c in
                    OpinionCard(c: c, a: store.analyses[c.id]!, ad: store.widget?.campaigns?.first(where: { $0.id == c.id }), open: { open(c.id) })
                }
                ForEach(unseen) { c in
                    Card {
                        HStack {
                            Image(systemName: "questionmark.bubble").foregroundStyle(Brand.warn)
                            Text("حملة شغّالة بدون رأيي لسا: ").foregroundStyle(.secondary) + Text(c.cleanName).bold()
                            Spacer()
                            Button("اطلب رأي Claude") {
                                Task { await store.askBrain("analyze_campaign", "حلّل حملة «\(c.cleanName)»", ["campaign": c.id]) }
                            }.buttonStyle(.borderedProminent)
                        }
                    }
                }
                if analyzed.isEmpty && unseen.isEmpty && store.campaignsError == nil {
                    Card { Text(store.loading ? "بجيب الأرقام…" : "ما في تحليلات لسا. اكتب لـ Claude: حلّل حملاتي.").foregroundStyle(.secondary) }
                }
            }
            .padding(24)
        }
    }
}

struct OpinionCard: View {
    var c: Campaign
    var a: Analysis
    var ad: WidgetCampaign? = nil
    var open: () -> Void

    var body: some View {
        let sp = c.spend.d, cv = c.messages.d, cp = cv > 0 ? sp / cv : nil
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Text("رأيي · \(a.written_at ?? "")").font(.caption).opacity(0.85)
                Text(a.verdict_label ?? "").font(.system(size: 19, weight: .bold)).fixedSize(horizontal: false, vertical: true)
                Text("الحملة \(c.stateLabel)").font(.caption).opacity(0.9)
            }
            .foregroundStyle(.white)
            .padding(16)
            .frame(width: 190, alignment: .leading)
            .frame(maxHeight: .infinity)
            .background(Brand.verdictColor(a.verdict))

            VStack(alignment: .leading, spacing: 10) {
                Text(c.cleanName).font(.headline)
                if let s = a.summary { Text(s).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                HStack(spacing: 8) {
                    Stat(title: "صرف", value: usd(sp))
                    Stat(title: "محادثات", value: num(cv))
                    Stat(title: "تكلفة المحادثة", value: usd(cp), color: Brand.cpColor(cp))
                    Stat(title: "وصول", value: num(c.reach.opt))
                    Stat(title: "المراجعة الجاية", value: a.review_date ?? "—")
                }
                if let ad, let total = ad.ad_conv_total {
                    HStack(spacing: 6) {
                        Image(systemName: "bubble.left.and.text.bubble.right.fill").foregroundStyle(Brand.ok)
                        Text("هالإعلان من أول يوم (كل حملاته): ").bold()
                        Text("\(total) محادثة · \(usd(ad.ad_spend_total)) · \(usd(ad.ad_cpconv)) للمحادثة · اليوم \(ad.ad_conv_today ?? 0)")
                    }
                    .font(.callout).padding(8).background(RoundedRectangle(cornerRadius: 8).fill(Brand.ok.opacity(0.08)))
                }
                if let t = a.todo?.first {
                    (Text("المطلوب منك: ").bold() + Text(t)).font(.callout).foregroundStyle(.secondary)
                }
                HStack {
                    Button(action: open) { Label("الرأي الكامل والأرقام", systemImage: "chart.bar.doc.horizontal") }
                        .glassButton(prominent: true)
                    if let l = c.link, let u = URL(string: l) { Link("افتح بـ Ads Manager", destination: u) }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .glassCard(18)
    }
}

struct CampaignsPage: View {
    @ObservedObject var store = Store.shared
    var open: (String) -> Void
    @State private var showEnded = false

    var rows: [Campaign] {
        let sorted = store.campaigns.sorted { a, b in
            let ra = a.isLive ? 2 : a.status == "PAUSED" ? 1 : 0, rb = b.isLive ? 2 : b.status == "PAUSED" ? 1 : 0
            return ra != rb ? ra > rb : (a.created ?? "") > (b.created ?? "")
        }
        return showEnded ? sorted : sorted.filter { !($0.ended ?? false) || $0.status == "PAUSED" && store.analyses[$0.id] != nil }
    }

    var body: some View {
        Group {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .bottom) {
                    PageHeader(title: "كل الحملات", subtitle: "الأرقام من بداية كل حملة")
                    Toggle("اعرض الحملات اللي خلصت", isOn: $showEnded).toggleStyle(.switch)
                }
                HStack(spacing: 10) {
                    Stat(title: "شغّالة هلأ", value: "\(store.campaigns.filter(\.isLive).count)")
                    Stat(title: "المصروف الكلي", value: usd(store.campaigns.reduce(0) { $0 + $1.spend.d }))
                    Stat(title: "كل الحملات", value: "\(store.campaigns.count)")
                }
                Card(padding: 0) {
                    VStack(spacing: 0) {
                        ForEach(rows) { c in
                            CampaignRow(c: c, hasAnalysis: store.analyses[c.id] != nil, open: { open(c.id) })
                            Divider()
                        }
                        if rows.isEmpty { Text("ما في حملات").foregroundStyle(.secondary).padding() }
                    }
                }
            }
            .padding(24)
        }
    }
}

struct CampaignRow: View {
    var c: Campaign
    var hasAnalysis: Bool
    var open: () -> Void
    var body: some View {
        let cv = c.messages.d, cp = cv > 0 ? c.spend.d / cv : nil
        let stateColor: Color = c.isLive ? Brand.ok : c.status == "PAUSED" ? Brand.gray : Color.secondary
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(c.cleanName).font(.body.bold()).lineLimit(1)
                Text("\(c.objectiveLabel) · \(c.created ?? "")\(c.end.map { " ← \($0)" } ?? "")").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Pill(text: c.stateLabel, color: stateColor).frame(width: 70)
            col("صرف", usd(c.spend.opt))
            col("وصول", num(c.reach.opt))
            col("محادثات", num(c.messages.opt))
            col("للمحادثة", usd(cp), Brand.cpColor(cp))
            Button(hasAnalysis ? "الرأي" : "التفاصيل", action: open)
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
        .contentShape(Rectangle())
        .onTapGesture(count: 2, perform: open)
    }
    func col(_ t: String, _ v: String, _ color: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(t).font(.caption2).foregroundStyle(.secondary)
            Text(v).font(.callout.monospacedDigit().bold()).foregroundStyle(color)
        }.frame(width: 74, alignment: .leading)
    }
}


struct OpinionView: View {
    var open: (String) -> Void
    var body: some View { ScrollView { OpinionPage(open: open) } }
}


struct CampaignsView: View {
    var open: (String) -> Void
    var body: some View { ScrollView { CampaignsPage(open: open) } }
}

#endif
