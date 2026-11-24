#if targetEnvironment(macCatalyst)
import SwiftUI
import UniformTypeIdentifiers

// MARK: - Models (/api/manager)

struct Range3: Codable, Hashable { var low: Double; var mid: Double; var high: Double }
struct Shot: Codable, Hashable { var n: Int; var sec: String?; var shot: String; var text: String? }
struct BriefCampaign: Codable, Hashable {
    var daily: Double?; var days: Double?; var audience: String?; var placements: String?
    var spend: Double?; var expected: Range3?; var cp_mid: Double?
}
struct BriefTask: Codable, Hashable {
    var id: String; var employee: String?; var endDay: String?; var state: String?; var delivered_at: String?
    var file: String?; var note: String?; var submission_note: String?
    var stateLabel: String {
        switch state {
        case "TODO": return "لسا ما بلّشت"
        case "IN_PROGRESS": return "شغّالة عليه"
        case "SUBMITTED": return "سلّمت"
        case "DONE": return "خلصت"
        case "TOMORROW": return "أجّلته لبكرا"
        default: return state ?? ""
        }
    }
}
struct Brief: Codable, Hashable, Identifiable {
    var id: String; var priority: Int?; var status: String?; var title: String; var goal: String?; var why: String?
    var format: String?; var shots: [Shot]?; var tips: [String]?; var voice: String?; var caption: String?
    var campaign: BriefCampaign?; var task: BriefTask?
}
struct AdminPerson: Codable, Hashable { var id: String; var name: String; var role: String? }
struct AdminLink: Codable, Hashable { var linked: Bool; var assignee: AdminPerson?; var error: String? }
struct SmartAction: Codable, Hashable, Identifiable {
    var kind: String; var priority: Int; var icon: String?; var title: String; var detail: String?
    var campaign: String?; var advice: String?; var brief: String?; var ad: String?; var url: String?
    var id: String { kind + title }
}
struct ManagerResp: Codable { var admin: AdminLink?; var bench: Double?; var written_at: String?; var actions: [SmartAction]; var briefs: [Brief]; var today: WidgetToday?; var updated: String? }

@MainActor
final class ManagerStore: ObservableObject {
    @Published var data: ManagerResp?
    @Published var error: String?
    func load() async {
        do { data = try await API.get("/api/manager", timeout: 90); error = nil } catch { self.error = error.localizedDescription }
    }
    func assign(_ b: Brief, due: Date) async -> String? {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        do {
            let d = try await API.post("/api/briefs/\(b.id)/assign", json: ["due": f.string(from: due)])
            let r = (try? JSONSerialization.jsonObject(with: d) as? [String: Any]) ?? [:]
            await load()
            return (r["ok"] as? Bool == true) ? nil : (r["error"] as? String ?? "ما زبط")
        } catch { return error.localizedDescription }
    }
    func link(password: String, assignee: String) async -> String? {
        do {
            let d = try await API.post("/api/admin-link", json: ["password": password, "assignee": assignee])
            let r = (try? JSONSerialization.jsonObject(with: d) as? [String: Any]) ?? [:]
            await load()
            return (r["ok"] as? Bool == true) ? nil : (r["error"] as? String ?? "ما زبط")
        } catch { return error.localizedDescription }
    }
    func setStatus(_ b: Brief, _ status: String) async {
        _ = try? await API.post("/api/briefs/\(b.id)", json: ["status": status]); await load()
    }
}

// MARK: - Desk

struct ManagerView: View {
    @StateObject private var m = ManagerStore()
    var go: (Section) -> Void
    var openCampaign: (String) -> Void
    var body: some View {
        ScrollView { ManagerPage(m: m, go: go, openCampaign: openCampaign) }
            .task { await m.load() }
    }
}

struct ManagerPage: View {
    @ObservedObject var m: ManagerStore
    @ObservedObject var store = Store.shared
    var go: (Section) -> Void
    var openCampaign: (String) -> Void
    @State private var openBrief: Brief?

    var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        return h < 12 ? "صباح الخير حامد" : h < 18 ? "مساء الخير حامد" : "مساء النور حامد"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text(greeting).font(.system(size: 30, weight: .bold))
                Text("أنا مسؤول التسويق تبعك. هاي خطة اليوم — ابدأ من فوق لتحت.").foregroundStyle(.secondary)
            }
            if let t = m.data?.today ?? store.today {
                let main = store.widget?.campaigns?.first
                HStack(spacing: 10) {
                    Stat(title: "محادثات اليوم", value: "\(main?.ad_conv_today ?? t.conv)", color: Brand.ok)
                    Stat(title: "مجموع المحادثات", value: main?.ad_conv_total.map(String.init) ?? "—", note: "على الإعلان الحالي", color: Brand.ok)
                    Stat(title: "صرف اليوم", value: usd(t.spend))
                    Stat(title: "تكلفة المحادثة عندك", value: usd(m.data?.bench), note: "أرقامك الحقيقية", color: Brand.cpColor(m.data?.bench))
                }
            }
            if let e = m.error { Card { Text(e).foregroundStyle(Brand.bad) } }

            BrainPanel()

            Text("خطوات اليوم").font(.title2.bold())
            VStack(spacing: 10) {
                ForEach(Array((m.data?.actions ?? []).enumerated()), id: \.element.id) { i, a in
                    ActionRow(n: i + 1, a: a) { perform(a) }
                }
                if m.data == nil { Card { HStack { ProgressView().controlSize(.small); Text("بحضّر خطة اليوم…") } } }
            }

            HStack(alignment: .firstTextBaseline) {
                Text("فيديوهات بدي إياك تصوّرها").font(.title2.bold())
                Text("كل واحد معه التعليمات لقطة لقطة، وأنا بعلنه").foregroundStyle(.secondary)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 330), spacing: 12)], spacing: 12) {
                ForEach((m.data?.briefs ?? []).sorted { ($0.priority ?? 9) < ($1.priority ?? 9) }) { b in
                    BriefCard(b: b) { openBrief = b }
                }
            }
        }
        .padding(24)
        .sheet(item: $openBrief) { b in
            BriefSheet(b: b, m: m).environmentObject(store).environment(\.layoutDirection, .rightToLeft)
                .frame(minWidth: 820, minHeight: 760)
        }
    }

    func perform(_ a: SmartAction) {
        switch a.kind {
        case "delivered":
            Task { await store.askBrain("analyze_video", "حوّل فيديو «\(a.brief ?? "")» لإعلان", ["brief": a.brief ?? ""]) }
        case "brief", "assigned": if let b = m.data?.briefs.first(where: { $0.id == a.brief }) { openBrief = b }
        case "campaign":
            if let c = a.campaign, let wc = store.widget?.campaigns?.first(where: { $0.id == c }),
               let adv = a.advice, adv == "raise" || adv == "pause" || adv == "lower" {
                store.pending = PendingAction(campaign: wc, action: adv)
            } else if let c = a.campaign { openCampaign(c) }
        case "market": go(.market)
        case "market_refresh":
            Task { _ = try? await API.post("/api/market/refresh"); store.toast = "بلّش تحديث السوق — بياخد كم دقيقة" }
            go(.market)
        case "reply": if let u = URL(string: "https://business.facebook.com/latest/inbox/all?asset_id=190533557486840") { UIApplication.shared.open(u) }
        default: if let s = a.url, let u = URL(string: s) { UIApplication.shared.open(u) }
        }
    }
}

struct ActionRow: View {
    var n: Int
    var a: SmartAction
    var act: () -> Void
    var color: Color { a.priority == 1 ? Brand.bad : a.priority == 2 ? Brand.warn : Brand.gray }
    var button: String {
        switch a.kind {
        case "brief": return "التعليمات"
        case "assigned": return "التفاصيل"
        case "delivered": return "حوّله إعلان"
        case "campaign": return "النصيحة"
        case "market": return "شوف السوق"
        case "market_refresh": return "حدّث هلأ"
        case "reply": return "افتح المحادثات"
        default: return "افتح"
        }
    }
    var body: some View {
        HStack(spacing: 14) {
            Text("\(n)").font(.headline).foregroundStyle(.white).frame(width: 30, height: 30).background(Circle().fill(color))
            Image(systemName: a.icon ?? "sparkles").font(.title2).foregroundStyle(color).frame(width: 30)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(a.title).font(.headline)
                    if a.priority == 1 { Pill(text: "مهم جداً", color: Brand.bad) }
                }
                if let d = a.detail, !d.isEmpty { Text(d).font(.callout).foregroundStyle(.secondary).lineLimit(2) }
            }
            Spacer()
            Button(button, action: act).glassButton(prominent: a.priority == 1)
        }
        .padding(14)
        .glassCard(16)
    }
}

struct BriefCard: View {
    var b: Brief
    var open: () -> Void
    var todayKey: String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f.string(from: Date()) }
    var body: some View {
        let e = b.campaign?.expected
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Pill(text: b.priority == 1 ? "الأولوية الأولى" : "أولوية \(b.priority ?? 0)", color: b.priority == 1 ? Brand.bad : Brand.warn)
                Spacer()
                if let t = b.task, b.status == "assigned" {
                    Pill(text: "مع \(t.employee ?? "سالي") · \(t.stateLabel)", color: Brand.accent)
                } else if b.status == "delivered" {
                    Pill(text: "سلّمت الفيديو ✓", color: Brand.ok)
                } else {
                    Pill(text: b.status == "shot" ? "انصوّر ✓" : b.status == "live" ? "شغّال" : "لسا", color: b.status == "todo" ? .secondary : Brand.ok)
                }
            }
            Text(b.title).font(.title3.bold())
            if let g = b.goal { Text(g).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            HStack(alignment: .bottom, spacing: 16) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("النتيجة المتوقعة").font(.caption).foregroundStyle(.secondary)
                    Text("حوالي \(Int(e?.mid ?? 0)) محادثة").font(.system(size: 24, weight: .bold, design: .rounded)).foregroundStyle(Brand.ok)
                    Text("بين \(Int(e?.low ?? 0)) و \(Int(e?.high ?? 0))").font(.caption2).foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 0) {
                    Text("الميزانية").font(.caption).foregroundStyle(.secondary)
                    Text(usd(b.campaign?.spend)).font(.title3.bold())
                    Text("\(usd(b.campaign?.daily))/يوم × \(Int(b.campaign?.days ?? 0)) أيام").font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
            }
            Text("\(b.shots?.count ?? 0) لقطات · \(b.format ?? "")").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            if let t = b.task, let e = t.endDay {
                Label(b.status == "delivered" ? "وصل الفيديو \(String((t.delivered_at ?? "").prefix(16)).replacingOccurrences(of: "T", with: " "))" : "موعد التسليم: \(e)",
                      systemImage: b.status == "delivered" ? "checkmark.circle.fill" : "calendar.badge.clock")
                    .font(.caption.bold()).foregroundStyle(b.status == "delivered" ? Brand.ok : (e < todayKey ? Brand.bad : Brand.accent))
            }
            Button(action: open) { Label("التعليمات لقطة لقطة", systemImage: "film").frame(maxWidth: .infinity) }
                .glassButton(prominent: b.priority == 1).controlSize(.large)
        }
        .padding(16)
        .glassCard(18)
    }
}

struct BriefSheet: View {
    var b: Brief
    @ObservedObject var m: ManagerStore
    @ObservedObject var store = Store.shared
    @Environment(\.dismiss) private var dismiss
    @State private var importing = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(b.title).font(.title2.bold())
                Spacer()
                Button("إغلاق") { dismiss() }.keyboardShortcut(.cancelAction).glassButton()
            }.padding(16)
            Divider()
            ScrollView { BriefContent(b: b).padding(20) }
            Divider()
            AssignBar(b: b, m: m, importing: $importing, close: { dismiss() })
                .padding(16)
        }
        .background(AuroraBackground())
        .fileImporter(isPresented: $importing, allowedContentTypes: [.movie, .video, .mpeg4Movie, .quickTimeMovie]) { r in
            if case .success(let url) = r {
                Task { await store.upload(url, brief: b.id); await m.load(); dismiss() }
            }
        }
    }
}

struct BriefContent: View {
    var b: Brief
    @ObservedObject var store = Store.shared
    var body: some View {
                VStack(alignment: .leading, spacing: 16) {
                    if let w = b.why {
                        Card { VStack(alignment: .leading, spacing: 4) { Text("ليش هالفيديو").font(.headline); Text(w).fixedSize(horizontal: false, vertical: true) } }
                    }
                    if let f = b.format { Label(f, systemImage: "rectangle.portrait").font(.callout.bold()) }
                    Text("صوّر هيك — لقطة لقطة").font(.title3.bold())
                    ForEach(b.shots ?? [], id: \.self) { s in
                        HStack(alignment: .top, spacing: 14) {
                            VStack(spacing: 2) {
                                Text("\(s.n)").font(.system(size: 22, weight: .bold)).foregroundStyle(.white)
                                    .frame(width: 44, height: 44).background(Circle().fill(Brand.accent))
                                Text(s.sec ?? "").font(.caption2).foregroundStyle(.secondary)
                            }
                            VStack(alignment: .leading, spacing: 6) {
                                Text(s.shot).font(.body).fixedSize(horizontal: false, vertical: true)
                                if let t = s.text, !t.isEmpty {
                                    HStack(spacing: 6) { Image(systemName: "textformat"); Text("نص على الشاشة: ").bold() + Text(t) }
                                        .font(.callout).padding(.horizontal, 10).padding(.vertical, 5)
                                        .background(Capsule().fill(Brand.accent.opacity(0.12)))
                                }
                            }
                            Spacer()
                        }
                        .padding(12).glassCard(14)
                    }
                    if let v = b.voice {
                        Card { VStack(alignment: .leading, spacing: 4) { Label("التعليق الصوتي", systemImage: "mic.fill").font(.headline); Text(v).fixedSize(horizontal: false, vertical: true) } }
                    }
                    if let t = b.tips, !t.isEmpty {
                        Card { VStack(alignment: .leading, spacing: 4) { Label("نصايح التصوير", systemImage: "lightbulb.fill").font(.headline).foregroundStyle(Brand.warn); ForEach(t, id: \.self) { Text("• " + $0) } } }
                    }
                    if let c = b.caption {
                        Card {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack { Text("نص الإعلان").font(.headline); Spacer()
                                    Button("نسخ") { UIPasteboard.general.string = c; store.toast = "انسخ" }.glassButton() }
                                Text(c).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    if let k = b.campaign {
                        Card {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("أنا بعلنه هيك").font(.headline)
                                HStack(spacing: 10) {
                                    Stat(title: "الميزانية", value: usd(k.spend), note: "\(usd(k.daily))/يوم × \(Int(k.days ?? 0)) أيام")
                                    Stat(title: "المتوقع", value: "حوالي \(Int(k.expected?.mid ?? 0)) محادثة", note: "بين \(Int(k.expected?.low ?? 0)) و \(Int(k.expected?.high ?? 0))", color: Brand.ok)
                                    Stat(title: "تكلفة المحادثة المتوقعة", value: usd(k.cp_mid), note: "إعلان جديد ≈ أرقامك × 1.1")
                                }
                                if let a = k.audience { (Text("الجمهور: ").bold() + Text(a)).font(.callout) }
                                (Text("الوجهة: ").bold() + Text("رسائل واتساب فقط")).font(.callout)
                            }
                        }
                    }
                }
    }
}


/// Bottom of a brief: hand it to the filming engineer on NEON Admin, or upload the video yourself.
struct AssignBar: View {
    var b: Brief
    @ObservedObject var m: ManagerStore
    @Binding var importing: Bool
    var close: () -> Void
    @ObservedObject var store = Store.shared
    @State private var due = Calendar.current.date(byAdding: .day, value: 2, to: Date()) ?? Date()
    @State private var working = false
    @State private var password = ""
    @State private var showLink = false

    var linked: Bool { m.data?.admin?.linked ?? false }
    var person: String { m.data?.admin?.assignee?.name ?? "سالي" }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let t = b.task, b.status == "assigned" || b.status == "delivered" {
                HStack(spacing: 8) {
                    Image(systemName: b.status == "delivered" ? "checkmark.seal.fill" : "person.badge.clock.fill")
                        .foregroundStyle(b.status == "delivered" ? Brand.ok : Brand.accent)
                    Text(b.status == "delivered" ? "\(t.employee ?? person) سلّمت الفيديو — وصل لـ NEON Ads" : "المهمة مع \(t.employee ?? person) على NEON Admin · \(t.stateLabel) · التسليم \(t.endDay ?? "")").bold()
                    Spacer()
                }
                if let n = t.submission_note, !n.isEmpty { Text("ملاحظتها: \(n)").font(.callout).foregroundStyle(.secondary) }
                if let n = t.note { Text(n).font(.callout).foregroundStyle(Brand.warn) }
            }
            if showLink || (!linked && b.task == nil && showLink) {
                HStack {
                    SecureField("باسورد أدمن NEON Admin", text: $password).textFieldStyle(.roundedBorder).frame(width: 260)
                    Button("اربط") {
                        working = true
                        Task {
                            if let e = await m.link(password: password, assignee: "سالي") { store.toast = e } else { store.toast = "انربط NEON Admin ✓"; showLink = false }
                            password = ""; working = false
                        }
                    }.glassButton(prominent: true).disabled(password.count < 4 || working)
                    Text("مرة وحدة بس — بينحفظ على الماك").font(.caption).foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 10) {
                if b.task == nil || b.status == "todo" {
                    DatePicker("التسليم", selection: $due, in: Date()..., displayedComponents: .date).frame(width: 190)
                    Button {
                        if !linked { showLink = true; return }
                        working = true
                        Task {
                            if let e = await m.assign(b, due: due) { store.toast = e } else { store.toast = "انبعتت لـ \(person) على NEON Admin ✓ — وصلها إشعار"; close() }
                            working = false
                        }
                    } label: {
                        if working { ProgressView().controlSize(.small) } else { Label("ابعتها لـ \(person) كمهمة", systemImage: "paperplane.fill") }
                    }
                    .glassButton(prominent: true).controlSize(.large).disabled(working)
                }
                Spacer()
                Button("علّمه مصوّر") { Task { await m.setStatus(b, "shot"); close() } }.glassButton()
                Button { importing = true } label: { Label("صوّرته أنا — ارفع", systemImage: "square.and.arrow.up") }.glassButton()
            }
        }
    }
}

#endif
