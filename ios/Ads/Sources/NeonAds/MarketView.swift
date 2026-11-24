#if targetEnvironment(macCatalyst)
import SwiftUI

// MARK: - Models (/api/market)

struct MBest: Codable, Hashable { var id: String; var score: Flex?; var days: Flex? }
struct Competitor: Codable, Hashable, Identifiable {
    var page: String; var page_link: String?; var active: Int; var total: Int; var max_days: Int; var variants: Int; var best: MBest?
    var est_spend: Range3?; var est_msgs: Range3?; var est_visits: Range3?
    var id: String { page }
}
struct MAd: Codable, Hashable, Identifiable {
    var id: String; var page: String; var page_link: String?; var started: String?; var variants: Int?
    var body: String?; var video: Bool?; var image: String?; var out_link: String?; var relevance: Int?
    var library_url: String?; var active: Bool?; var days: Int?; var score: Int?; var strength: String?
    var queries: [String]?
    var kind: String?; var unit: String?; var est_spend: Range3?; var est_results: Range3?
}
struct TopAd: Codable, Hashable { var id: String; var page: String; var title: String; var why_worked: String; var steal: String }
struct MStatus: Codable, Hashable { var running: Bool?; var step: String?; var done_at: String?; var error: String? }
struct Leader: Codable, Hashable { var page: String; var why: String?; var angle: String?; var offer: String?; var threat: String?; var weakness: String? }
struct Angle: Codable, Hashable { var name: String; var who: String?; var works_because: String? }
struct Attack: Codable, Hashable { var title: String; var detail: String }
struct AdIdea: Codable, Hashable { var title: String; var hook: String?; var body: String?; var why_beats: String? }
struct MarketAnalysis: Codable, Hashable {
    var written_at: String?; var summary: String?; var leaders: [Leader]?; var angles: [Angle]?; var prices: [String]?
    var gaps: [String]?; var attack: [Attack]?; var ad_ideas: [AdIdea]?; var ignore_pages: [String]?; var watch: [String]?
    var focus_pages: [String]?
    var top_ads: [TopAd]?; var estimates_note: String?
}
struct MDiffAd: Codable, Hashable, Identifiable { var id: String; var page: String?; var days: Int?; var variants: Int?; var focus: Bool?; var body: String? }
struct MDiff: Codable, Hashable { var since: String?; var at: String?; var new_ads: [MDiffAd]?; var new_winners: [MDiffAd]?; var stopped: Int? }
struct MarketResp: Codable {
    var diff: MDiff?; var age_days: Int?
    var updated: String?; var queries: [String]?; var competitors: [Competitor]; var ads: [MAd]; var benchmark_cp: Double?
    var analysis: MarketAnalysis?; var status: MStatus?
}

@MainActor
final class MarketStore: ObservableObject {
    @Published var data: MarketResp?
    @Published var error: String?
    private var poll: Task<Void, Never>?

    func load() async {
        do { data = try await API.get("/api/market", timeout: 30); error = nil } catch { self.error = error.localizedDescription }
        poll?.cancel()
        if data?.status?.running == true {
            poll = Task { [weak self] in try? await Task.sleep(nanoseconds: 4_000_000_000); await self?.load() }
        }
    }
    func refresh() async {
        _ = try? await API.post("/api/market/refresh")
        await load()
    }
}

// MARK: - View

struct MarketView: View {
    @StateObject private var m = MarketStore()
    var body: some View {
        ScrollView { MarketPage(m: m) }.task { await m.load() }
    }
}

struct MarketPage: View {
    @ObservedObject var m: MarketStore
    @ObservedObject var store = Store.shared
    @State private var filter: String = "المنافسين المباشرين"
    @State private var onlyWinners = false

    var ads: [MAd] {
        let focus = Set(m.data?.analysis?.focus_pages ?? [])
        return (m.data?.ads ?? []).filter {
            ($0.active ?? false)
            && (filter == "الكل" || (filter == "المنافسين المباشرين" ? (focus.isEmpty || focus.contains($0.page)) : $0.page == filter))
            && (!onlyWinners || ($0.days ?? 0) >= 30 || ($0.variants ?? 1) >= 4)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .bottom) {
                PageHeader(title: "السوق والمنافسين", subtitle: "كل إعلانات التصميم الداخلي الشغّالة بالأردن — من مكتبة إعلانات ميتا")
                VStack(alignment: .trailing, spacing: 4) {
                    Button { Task { await m.refresh() } } label: {
                        if m.data?.status?.running == true { HStack { ProgressView().controlSize(.small); Text("بجمع…") } }
                        else { Label("حدّث بيانات السوق", systemImage: "arrow.triangle.2.circlepath") }
                    }.glassButton(prominent: true).disabled(m.data?.status?.running == true)
                    Button { Task { await store.askBrain("market_analysis", "حلّل السوق والمنافسين من جديد") } } label: {
                        Label("اطلب تحليل جديد من Claude", systemImage: "brain.head.profile")
                    }.glassButton()
                    Text(m.data?.status?.running == true ? (m.data?.status?.step ?? "") : "آخر جمع: \(m.data?.updated?.replacingOccurrences(of: "T", with: " ").prefix(16) ?? "—")")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Card {
                Label("مؤكد: النص، تاريخ البدء، عدد النسخ (من مكتبة ميتا). مش معروف: الصرف والرسائل والأرباح. طول مدة الإعلان مش إثبات إنه ناجح.", systemImage: "info.circle")
                    .font(.callout).foregroundStyle(.secondary)
            }
            if let e = m.error ?? m.data?.status?.error { Card { Text(e).foregroundStyle(Brand.bad) } }

            if let d = m.data?.diff, d.since != nil {
                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Image(systemName: "arrow.left.arrow.right.circle.fill").foregroundStyle(Brand.accent)
                            Text("شو تغيّر من آخر تحديث").font(.headline)
                            Spacer()
                            Text("من \(String((d.since ?? "").prefix(10)))").font(.caption).foregroundStyle(.secondary)
                        }
                        HStack(spacing: 10) {
                            Stat(title: "إعلانات جديدة", value: "\(d.new_ads?.count ?? 0)", color: Brand.accent)
                            Stat(title: "صارلهم 30 يوم+ أو 4 نسخ+", value: "\(d.new_winners?.count ?? 0)", color: Brand.bad)
                            Stat(title: "وقفوا", value: "\(d.stopped ?? 0)")
                        }
                        ForEach((d.new_winners ?? []).prefix(5)) { x in
                            HStack(alignment: .top, spacing: 6) {
                                Text("•").font(.caption)
                                Text("\(x.page ?? "") — \(x.days ?? 0) يوم، \(x.variants ?? 1) نسخة: ").bold().font(.callout) + Text(x.body ?? "").font(.callout)
                            }.lineLimit(2)
                        }
                        if !(d.new_winners ?? []).isEmpty {
                            Button { Task { await store.askBrain("market_analysis", "ادرس الإعلانات اللي صارت رابحة وطلّعلي أقوى منها") } } label: {
                                Label("اطلب من Claude يدرسهم", systemImage: "brain.head.profile")
                            }.glassButton(prominent: true)
                        }
                    }
                }
            }
            if let a = m.data?.analysis { AnalysisBlock(a: a, adsById: Dictionary((m.data?.ads ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })) }
            else if m.data != nil {
                Card { Text("لسا ما في تحليل للسوق.").foregroundStyle(.secondary) }
            }

            if let comps = m.data?.competitors, !comps.isEmpty {
                Text("المنافسين المباشرين — اكبس على أي واحد لتشوف إعلاناته").font(.title3.bold())
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 10)], spacing: 10) {
                    ForEach(comps.prefix(15)) { c in
                        Button { filter = c.page } label: { CompetitorTile(c: c, selected: filter == c.page) }.buttonStyle(.plain)
                    }
                }
            }

            HStack {
                Text("إعلاناتهم").font(.title3.bold())
                Spacer()
                Toggle("اللي شغّالة من زمان بس", isOn: $onlyWinners).toggleStyle(.switch)
                Picker("", selection: $filter) {
                    Text("المنافسين المباشرين").tag("المنافسين المباشرين")
                    Text("كل السوق").tag("الكل")
                    ForEach(m.data?.competitors ?? []) { c in Text(c.page).tag(c.page) }
                }.frame(width: 240)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 12)], spacing: 12) {
                ForEach(ads.prefix(120)) { ad in MarketAdCard(ad: ad) }
            }
            if ads.isEmpty { Card { Text(m.data == nil ? "بجيب…" : "ما في إعلانات بهالفلتر").foregroundStyle(.secondary) } }
        }
        .padding(24)
    }
}

struct AnalysisBlock: View {
    @ObservedObject var store = Store.shared
    var a: MarketAnalysis
    var adsById: [String: MAd] = [:]
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text("رأيي بالسوق · \(a.written_at ?? "")").font(.caption).opacity(0.85)
                Text(a.summary ?? "").font(.system(size: 17, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(.white).padding(18).frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 18).fill(LinearGradient(colors: [Brand.accent, .purple], startPoint: .topLeading, endPoint: .bottomTrailing)))

            if let n = a.estimates_note {
                Label(n, systemImage: "function").font(.callout).foregroundStyle(.secondary).padding(10).glassCard(12)
            }
            if let top = a.top_ads, !top.isEmpty {
                Text("أقوى إعلانات بالسوق — ليش نجحت وشو منسرق منها").font(.title3.bold())
                ForEach(top, id: \.self) { t in
                    let ad = adsById[t.id]
                    Card {
                        HStack(alignment: .top, spacing: 14) {
                            AsyncImage(url: Backend.base.appendingPathComponent("market-media/\(t.id).jpg")) { $0.resizable().scaledToFill() } placeholder: { Color.primary.opacity(0.06) }
                                .frame(width: 120, height: 150).clipShape(RoundedRectangle(cornerRadius: 10))
                            VStack(alignment: .leading, spacing: 6) {
                                Text(t.page).font(.caption).foregroundStyle(.secondary)
                                Text(t.title).font(.headline)
                                if let ad, let e = ad.est_results {
                                    HStack(spacing: 10) {
                                        Label("\(ad.days ?? 0) يوم شغّال", systemImage: "calendar")
                                        Label("حوالي \(Int(e.mid)) \(ad.unit ?? "") (تقدير)", systemImage: "bubble.left.fill").foregroundStyle(Brand.ok)
                                        Label("صرف ~\(usd(ad.est_spend?.mid))", systemImage: "dollarsign.circle")
                                    }.font(.caption.bold())
                                }
                                (Text("ليش نجح: ").bold() + Text(t.why_worked)).font(.callout).fixedSize(horizontal: false, vertical: true)
                                (Text("شو منسرق: ").bold().foregroundColor(Brand.accent) + Text(t.steal)).font(.callout).fixedSize(horizontal: false, vertical: true)
                                Link("افتح الإعلان بمكتبة ميتا", destination: URL(string: "https://www.facebook.com/ads/library/?id=\(t.id)")!).font(.caption)
                            }
                        }
                    }
                }
            }
            if let l = a.leaders, !l.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("مين مسيطر هلأ وليش").font(.headline)
                        ForEach(l, id: \.self) { x in
                            let c: Color = x.threat == "high" ? Brand.bad : x.threat == "mid" ? Brand.warn : Brand.gray
                            VStack(alignment: .leading, spacing: 4) {
                                HStack { Text(x.page).bold(); Pill(text: x.threat == "high" ? "خطر عالي" : x.threat == "mid" ? "متوسط" : "ضعيف", color: c) }
                                if let w = x.why { Text(w).font(.callout) }
                                if let an = x.angle { (Text("الزاوية: ").bold() + Text(an)).font(.callout).foregroundStyle(.secondary) }
                                if let o = x.offer { (Text("العرض: ").bold() + Text(o)).font(.callout).foregroundStyle(.secondary) }
                                if let wk = x.weakness { (Text("نقطة ضعفه: ").bold().foregroundColor(Brand.ok) + Text(wk)).font(.callout) }
                            }
                            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 12).fill(c.opacity(0.07)))
                        }
                    }
                }
            }
            HStack(alignment: .top, spacing: 12) {
                if let g = a.gaps, !g.isEmpty { bullets("الفراغات اللي محدش مالكها", g, Brand.ok) }
                if let p = a.prices, !p.isEmpty { bullets("الأسعار والعروض بالسوق", p, Brand.accent) }
            }
            if let at = a.attack, !at.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("خطة السيطرة على السوق").font(.headline)
                        ForEach(Array(at.enumerated()), id: \.offset) { i, x in
                            HStack(alignment: .top, spacing: 10) {
                                Text("\(i + 1)").font(.headline).frame(width: 26, height: 26).background(Circle().fill(Brand.accent.opacity(0.15)))
                                VStack(alignment: .leading, spacing: 2) { Text(x.title).bold(); Text(x.detail).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                            }
                        }
                    }
                }
            }
            if let ideas = a.ad_ideas, !ideas.isEmpty {
                Text("إعلانات أقوى منهم — جاهزة نعملها").font(.title3.bold())
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 12)], spacing: 12) {
                    ForEach(ideas, id: \.self) { i in
                        Card {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(i.title).font(.headline)
                                if let h = i.hook { (Text("أول 3 ثواني: ").bold() + Text(h)).font(.callout) }
                                if let b = i.body { Text(b).font(.callout).padding(8).frame(maxWidth: .infinity, alignment: .leading).background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05))) }
                                if let w = i.why_beats { (Text("ليش بيغلبهم: ").bold().foregroundColor(Brand.ok) + Text(w)).font(.caption) }
                                Button("حوّلها لتعليمات تصوير") {
                                    Task { await store.askBrain("new_brief", "حوّل فكرة «\(i.title)» لتعليمات تصوير", ["idea": i.title]) }
                                }.glassButton()
                            }
                        }
                    }
                }
            }
        }
    }

    func bullets(_ t: String, _ items: [String], _ c: Color) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 6) {
                Text(t).font(.headline)
                ForEach(items, id: \.self) { x in
                    HStack(alignment: .top, spacing: 6) { Circle().fill(c).frame(width: 6, height: 6).padding(.top, 7); Text(x).fixedSize(horizontal: false, vertical: true) }
                }
            }
        }
    }
}

struct CompetitorTile: View {
    var c: Competitor
    var selected: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(c.page).font(.callout.bold()).lineLimit(1)
            HStack(spacing: 12) {
                mini("إعلانات شغّالة", "\(c.active)")
                mini("أقدم إعلان", "\(c.max_days) يوم")
                mini("نسخ", "\(c.variants)")
            }
            if let e = c.est_msgs, e.mid > 0 {
                HStack(spacing: 6) {
                    Image(systemName: "bubble.left.and.bubble.right.fill").foregroundStyle(Brand.ok)
                    Text("حوالي \(Int(e.mid)) رسالة").bold()
                    Text("· صرف ~\(usd(c.est_spend?.mid))").foregroundStyle(.secondary)
                    Text("تقدير").font(.caption2).padding(.horizontal, 5).background(Capsule().fill(Color.primary.opacity(0.08)))
                }.font(.caption)
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(14, tint: selected ? Brand.accent : nil)
    }
    func mini(_ t: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 0) { Text(t).font(.caption2).foregroundStyle(.secondary); Text(v).font(.callout.bold().monospacedDigit()) }
    }
}

struct MarketAdCard: View {
    var ad: MAd
    @State private var expanded = false
    var body: some View {
        let days = ad.days ?? 0, v = ad.variants ?? 1
        let win = days >= 30 || v >= 4
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .topLeading) {
                AsyncImage(url: Backend.base.appendingPathComponent("market-media/\(ad.id).jpg")) { $0.resizable().scaledToFill() } placeholder: {
                    ZStack { Color.primary.opacity(0.06); Image(systemName: ad.video == true ? "play.rectangle" : "photo").font(.largeTitle).foregroundStyle(.secondary) }
                }
                .frame(height: 170).frame(maxWidth: .infinity).clipped()
                HStack(spacing: 6) {
                    Text(win ? "شغّال من زمان" : days >= 10 ? "متوسط" : "جديد").font(.caption.bold()).padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Capsule().fill(win ? Brand.bad : days >= 10 ? Brand.warn : Brand.gray)).foregroundStyle(.white)
                    if ad.video == true { Image(systemName: "video.fill").padding(5).background(Circle().fill(.black.opacity(0.5))).foregroundStyle(.white) }
                }.padding(8)
            }
            .clipShape(RoundedRectangle(cornerRadius: 12))
            Text(ad.page).font(.callout.bold()).lineLimit(1)
            HStack(spacing: 10) {
                Label("\(days) يوم", systemImage: "calendar").font(.caption)
                Label("\(v) نسخة", systemImage: "square.on.square").font(.caption)
                if let s = ad.started { Text("من \(s)").font(.caption).foregroundStyle(.secondary) }
            }.foregroundStyle(.secondary)
            if let e = ad.est_results, e.mid > 0 {
                HStack(spacing: 6) {
                    Image(systemName: ad.unit == "رسالة" ? "bubble.left.fill" : "cursorarrow.click").foregroundStyle(Brand.ok)
                    Text("جاب تقريباً ~\(Int(e.mid)) \(ad.unit ?? "")").bold()
                    Text("(\(Int(e.low))–\(Int(e.high)))").foregroundStyle(.secondary)
                    Text("بصرف ~\(usd(ad.est_spend?.mid))").foregroundStyle(.secondary)
                }.font(.caption)
                .padding(6).background(RoundedRectangle(cornerRadius: 8).fill(Brand.ok.opacity(0.08)))
            }
            Text(ad.body ?? "").font(.callout).lineLimit(expanded ? nil : 5).fixedSize(horizontal: false, vertical: expanded)
                .onTapGesture { expanded.toggle() }
            HStack {
                if let l = ad.library_url, let u = URL(string: l) { Link("افتح بمكتبة الإعلانات", destination: u).font(.caption) }
                Spacer()
                if let o = ad.out_link, let u = URL(string: o), !o.isEmpty { Link("وين بيودّي", destination: u).font(.caption) }
            }
        }
        .padding(12)
        .glassCard(16)
    }
}

#endif
