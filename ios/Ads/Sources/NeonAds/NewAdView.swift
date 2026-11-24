#if targetEnvironment(macCatalyst)
import SwiftUI
import UniformTypeIdentifiers
import ServiceManagement

struct NewAdPage: View {
    @ObservedObject var store = Store.shared
    @State private var importing = false
    @State private var dropping = false

    var body: some View {
        Group {
            VStack(alignment: .leading, spacing: 16) {
                PageHeader(title: "إعلان جديد", subtitle: "ارفع الفيديو ← Claude بيحلّله بالتشات ← بتراجع الخطة وبترفعها على ميتا")
                VStack(spacing: 8) {
                    Image(systemName: "film.stack").font(.system(size: 34)).foregroundStyle(Brand.accent)
                    Text("اسحب الفيديو هون أو اضغط تختار").font(.headline)
                    Text("بنقطّعه صور ونفرّغ الكلام — بعدها اكتب لـ Claude: حلّل").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity).padding(30)
                .background(RoundedRectangle(cornerRadius: 14).fill(dropping ? Brand.accent.opacity(0.12) : Brand.accent.opacity(0.04)))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Brand.accent.opacity(0.5), style: StrokeStyle(lineWidth: 2, dash: [7])))
                .contentShape(Rectangle())
                .onTapGesture { importing = true }
                .onDrop(of: [.fileURL], isTargeted: $dropping) { providers in
                    guard let p = providers.first else { return false }
                    _ = p.loadObject(ofClass: URL.self) { url, _ in
                        if let url { Task { await store.upload(url) } }
                    }
                    return true
                }
                .fileImporter(isPresented: $importing, allowedContentTypes: [.movie, .video, .mpeg4Movie, .quickTimeMovie]) { r in
                    if case .success(let url) = r { Task { await store.upload(url) } }
                }

                Text("إعلانات معمولة بالبرنامج").font(.title3.bold()).padding(.top, 6)
                ForEach(store.jobs) { j in JobCard(job: j) }
                if store.jobs.isEmpty { Card { Text("ما في إعلانات لسا").foregroundStyle(.secondary) } }
            }
            .padding(24)
        }
    }
}

struct JobCard: View {
    @ObservedObject var store = Store.shared
    var job: Job
    @State private var plan: JSONValue = .null
    @State private var confirmLive = false

    let order = ["prepared", "planned", "dryrun", "live"]
    let names = ["الفيديو جاهز", "خطة Claude", "تجربة", "على ميتا"]
    static let DEST = ["whatsapp": "رسائل واتساب", "messenger": "رسائل ماسنجر", "instagram_direct": "رسائل إنستغرام",
                       "website": "زيارات الموقع", "awareness": "وصول ووعي"]

    var body: some View {
        Card {
            HStack(alignment: .top, spacing: 18) {
                thumb.frame(width: 150, height: 266).clipShape(RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 10) {
                    Text(plan["campaign_name"]?.string ?? job.id).font(.headline)
                    Text("\(job.created ?? "")\(job.video?.duration.opt.map { String(format: " · %.0f ث", $0) } ?? "")\(job.video?.shape.map { " · \($0)" } ?? "")")
                        .font(.caption).foregroundStyle(.secondary)
                    steps
                    if let r = job.running { HStack { ProgressView().controlSize(.small); Text(r) }.padding(8).background(RoundedRectangle(cornerRadius: 8).fill(Brand.warn.opacity(0.1))) }
                    if job.running == nil && job.state == "prepared" {
                        HStack {
                            Text("الفيديو جاهز ولسا ما إله خطة.").foregroundStyle(.secondary)
                            Button("اطلب من Claude يحلّله") {
                                Task { await store.askBrain("analyze_video", "حلّل الفيديو واعمل خطة إعلان", ["job": job.id]) }
                            }.buttonStyle(.borderedProminent)
                        }
                    }
                    if plan["strategy"] != nil { planEditor }
                    results
                }
            }
        }
        .onAppear { plan = job.plan ?? .null }
        .onChange(of: job.plan) { new in plan = new ?? .null }
        .confirmationDialog("أرفع الحملة على ميتا؟", isPresented: $confirmLive) {
            Button("ارفعها (موقفة)") { Task { await store.run(job, live: true) } }
            Button("إلغاء", role: .cancel) {}
        } message: { Text("بتنعمل موقفة وما بتصرف إشي لحد ما تشغّلها إنت.") }
    }

    @ViewBuilder var thumb: some View {
        if let p = job.video?.thumbnail ?? job.video?.frames?.first {
            AsyncImage(url: API.fileURL(p)) { $0.resizable().scaledToFill() } placeholder: { Color.black }
        } else { Color.black }
    }

    var steps: some View {
        let at = order.firstIndex(of: job.state) ?? -1
        return HStack(spacing: 6) {
            ForEach(Array(names.enumerated()), id: \.offset) { i, n in
                Pill(text: n, color: i <= at ? Brand.ok : i == at + 1 ? Brand.warn : .secondary)
            }
        }
    }

    var planEditor: some View {
        let s = plan["strategy"], a = plan["audience"]
        let budget = s?["daily_budget"]?.number ?? 0, days = s?["days"]?.number ?? 0
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Stat(title: "الوجهة", value: Self.DEST[s?["destination"]?.string ?? ""] ?? "—")
                VStack(alignment: .leading, spacing: 3) {
                    Text("الميزانية اليومية $").font(.caption).foregroundStyle(.secondary)
                    TextField("", value: Binding(get: { budget }, set: { plan["strategy"]?["daily_budget"] = .number($0) }), format: .number)
                        .textFieldStyle(.roundedBorder).frame(width: 90)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("عدد الأيام").font(.caption).foregroundStyle(.secondary)
                    TextField("", value: Binding(get: { days }, set: { plan["strategy"]?["days"] = .number($0) }), format: .number)
                        .textFieldStyle(.roundedBorder).frame(width: 70)
                }
                Stat(title: "المجموع التقريبي", value: usd(budget * days))
            }
            if let desc = a?["description"]?.string { (Text("الجمهور: ").bold() + Text(desc)).font(.callout).foregroundStyle(.secondary) }
            ForEach(Array((plan["copies"]?.array ?? []).enumerated()), id: \.offset) { i, _ in
                VStack(alignment: .leading, spacing: 5) {
                    Text("النص \(i + 1)").font(.caption.bold())
                    TextField("العنوان", text: copyBinding(i, "headline")).textFieldStyle(.roundedBorder)
                    TextEditor(text: copyBinding(i, "primary_text")).font(.body).frame(minHeight: 70)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.15)))
                }
                .padding(10).background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.03)))
            }
            HStack {
                Button("حفظ التعديلات") { Task { await store.savePlan(job, plan) } }
                Button("تجربة بدون إرسال") { Task { await store.run(job, live: false) } }.disabled(job.running != nil)
                Button("ارفع الحملة على ميتا (موقفة)") { confirmLive = true }
                    .glassButton(prominent: true).disabled(job.running != nil || job.result != nil)
            }
        }
    }

    func copyBinding(_ i: Int, _ field: String) -> Binding<String> {
        Binding(get: { plan["copies"]?.array[safe: i]?[field]?.string ?? "" },
                set: { v in
                    var arr = plan["copies"]?.array ?? []
                    guard i < arr.count else { return }
                    arr[i][field] = .string(v)
                    plan["copies"] = .array(arr)
                })
    }

    @ViewBuilder var results: some View {
        if let r = job.result {
            HStack {
                Image(systemName: "checkmark.seal.fill").foregroundStyle(Brand.ok)
                Text("الحملة على ميتا").bold()
                if let l = r.ads_manager, let u = URL(string: l) { Link("افتح بـ Ads Manager", destination: u) }
            }
            if let n = r.note { Text(n).font(.caption).foregroundStyle(.secondary) }
        } else if let d = job.dryrun {
            Label("التجربة نجحت على الورق: حملة + مجموعة + \(d.ad_ids?.count ?? 0) إعلانات — ما انبعت إشي لميتا", systemImage: "checkmark.circle")
                .foregroundStyle(Brand.ok).font(.callout)
        }
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

struct ConnectView: View {
    @ObservedObject var store = Store.shared
    @State private var token = ""
    @State private var loginOn = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PageHeader(title: "الربط والإعدادات")
                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        Toggle("شغّل NEON لحاله لما يشتغل الماك", isOn: Binding(
                            get: { loginOn },
                            set: { on in
                                do { if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() } }
                                catch { store.toast = error.localizedDescription }
                                loginOn = SMAppService.mainApp.status == .enabled
                            })).toggleStyle(.switch).font(.headline)
                        Text("الويدجت والـ Brain بياخذوا أرقامهم من محرّك NEON Ads على هالماك. NEON بيشغّل المحرّك أول ما ينفتح، والمحرّك بيضل شغّال حتى لو سكّرت NEON. هالخيار بيفتح NEON لحاله بعد إعادة تشغيل الماك، فبيرجع المحرّك معه.")
                            .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        HStack {
                            Circle().fill(store.engineUp ? Brand.ok : Brand.bad).frame(width: 8, height: 8)
                            Text(store.engineUp ? "المحرّك شغّال" : "المحرّك مطفي").font(.callout)
                        }
                    }
                }
                .onAppear { loginOn = SMAppService.mainApp.status == .enabled }
                Card {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Circle().fill(store.connected ? Brand.ok : Brand.bad).frame(width: 10, height: 10)
                            Text(store.connected ? "متصل" : "مش متصل").font(.headline)
                        }
                        if let s = store.status {
                            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                                GridRow { Text("المستخدم").foregroundStyle(.secondary); Text(s.check.user ?? "—") }
                                GridRow { Text("الحساب الإعلاني").foregroundStyle(.secondary); Text(s.account ?? "—") }
                                GridRow { Text("الصفحة").foregroundStyle(.secondary); Text(s.check.page ?? s.page ?? "—") }
                                GridRow { Text("العملة").foregroundStyle(.secondary); Text(s.check.currency ?? "—") }
                                GridRow { Text("التوكن").foregroundStyle(.secondary); Text(s.token ?? "—") }
                            }
                            if let e = s.check.error { Text(e).foregroundStyle(Brand.bad).font(.callout) }
                        } else { Text(store.engineUp ? "بفحص…" : "المحرّك مطفي").foregroundStyle(.secondary) }
                    }
                }
                AdminLinkCard()
                Card {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("توكن جديد").font(.headline)
                        Text("بتجيبه من Graph API Explorer (تطبيق NEON Ads، صلاحيات ads_management و ads_read)").foregroundStyle(.secondary).font(.callout)
                        HStack {
                            TextField("الصق التوكن (EAA…)", text: $token).textFieldStyle(.roundedBorder)
                                .environment(\.layoutDirection, .leftToRight)
                            Button("حفظ") { Task { await store.saveToken(token); token = "" } }.disabled(token.count < 40)
                        }
                        Button("اسحب التوكن من كروم أو الحافظة") { Task { await store.grabToken() } }
                    }
                }
            }
            .padding(24)
        }
    }
}


struct NewAdView: View {
    
    var body: some View { ScrollView { NewAdPage() } }
}


struct AdminLinkCard: View {
    @ObservedObject var store = Store.shared
    @State private var link: AdminLink?
    @State private var password = ""
    @State private var who = "سالي"
    @State private var working = false
    @State private var result: String?
    @State private var ok = false

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: "person.2.badge.gearshape.fill").foregroundStyle(Brand.accent)
                    Text("الربط مع NEON Admin (مهام التصوير)").font(.headline)
                    Spacer()
                    Pill(text: link?.linked == true ? "مربوط ✓" : "مش مربوط", color: link?.linked == true ? Brand.ok : Brand.gray)
                }
                if let a = link?.assignee { Text("المهام بتروح لـ: \(a.name)\(a.role.map { " — \($0)" } ?? "")").font(.callout.bold()).foregroundStyle(Brand.ok) }
                Text("بتكبس «ابعتها لسالي» على أي فيديو → بتنعمل مهمة على NEON Admin → بتصوّر وبتمنتج وبترفع MP4 كإثبات → الفيديو بيوصل هون لحاله.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    SecureField("باسورد أدمن NEON Admin", text: $password)
                        .textFieldStyle(.roundedBorder)
                        .environment(\.layoutDirection, .leftToRight)
                        .onSubmit { connect() }
                    TextField("مين بتصوّر؟", text: $who).textFieldStyle(.roundedBorder).frame(width: 140)
                    Button(action: connect) {
                        if working { ProgressView().controlSize(.small).frame(width: 50) } else { Text("اربط").frame(width: 50) }
                    }
                    .buttonStyle(.borderedProminent).controlSize(.large)
                    .disabled(working)
                }
                if password.isEmpty && result == nil {
                    Text("اكتب الباسورد بالإنجليزي (نفس باسورد NEON Admin) واكبس اربط أو Enter").font(.caption).foregroundStyle(.secondary)
                }
                if let r = result {
                    Label(r, systemImage: ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(ok ? Brand.ok : Brand.bad).font(.callout.bold())
                        .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 8).fill((ok ? Brand.ok : Brand.bad).opacity(0.1)))
                }
            }
        }
        .task { link = try? await API.get("/api/admin-link") }
    }

    func connect() {
        guard !password.isEmpty else { result = "اكتب الباسورد أول"; ok = false; return }
        working = true; result = "عم يتحقق من NEON Admin…"; ok = true
        Task {
            do {
                let d = try await API.post("/api/admin-link", json: ["password": password, "assignee": who])
                let r = (try? JSONSerialization.jsonObject(with: d) as? [String: Any]) ?? [:]
                if r["ok"] as? Bool == true {
                    let name = ((r["assignee"] as? [String: Any])?["name"] as? String) ?? who
                    ok = true; result = "انربط ✓ — المهام بتروح لـ \(name)"; password = ""
                } else {
                    ok = false
                    let e = r["error"] as? String ?? "ما زبط"
                    result = e.contains("401") || e.contains("Invalid") ? "الباسورد غلط — تأكد إنه نفس باسورد الأدمن وإن الكيبورد إنجليزي" : e
                }
            } catch { ok = false; result = "ما قدرت أوصل المحرّك: \(error.localizedDescription)" }
            link = try? await API.get("/api/admin-link")
            working = false
        }
    }
}

#endif
