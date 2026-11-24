#if targetEnvironment(macCatalyst)
import Foundation
import SwiftUI
import WidgetKit

enum API {
    static func data(_ path: String, method: String = "GET", body: Data? = nil, headers: [String: String] = [:], timeout: TimeInterval = 60) async throws -> Data {
        var req = URLRequest(url: URL(string: path, relativeTo: Backend.base)!)
        req.httpMethod = method
        req.httpBody = body
        req.timeoutInterval = timeout
        headers.forEach { req.setValue($1, forHTTPHeaderField: $0) }
        let (d, r) = try await URLSession.shared.data(for: req)
        if let h = r as? HTTPURLResponse, !(200..<300).contains(h.statusCode) {
            let msg = (try? JSONSerialization.jsonObject(with: d) as? [String: Any])?["error"] as? String
            throw NSError(domain: "NEONAds", code: h.statusCode, userInfo: [NSLocalizedDescriptionKey: msg ?? "خطأ \(h.statusCode)"])
        }
        return d
    }
    static func get<T: Decodable>(_ path: String, timeout: TimeInterval = 60) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await data(path, timeout: timeout))
    }
    @discardableResult
    static func post(_ path: String, json: Encodable? = nil) async throws -> Data {
        let body = try json.map { try JSONEncoder().encode($0) }
        return try await data(path, method: "POST", body: body, headers: ["Content-Type": "application/json"])
    }
    static func fileURL(_ local: String) -> URL {
        var c = URLComponents(url: Backend.base.appendingPathComponent("file"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "p", value: local)]
        return c.url!
    }
}

/// The marketing section's badges, apart from the store: it publishes only when a number moves.
@MainActor
public final class AdsBadges: ObservableObject {
    public static let shared = AdsBadges()
    @Published public internal(set) var approvals = 0
}

/// Starts the engine (~/neon-ads/dashboard.py) if nothing is listening on 127.0.0.1:8793.
/// Mac Catalyst has no `Process`, so it is spawned with posix_spawn: a login zsh (for the
/// same PATH and Python the terminal has) that `exec`s python. The engine outlives the app —
/// closing NEON leaves it running, as closing the old NEON Ads app did.
enum Engine {
    static let root: String = {
        if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir { return String(cString: dir) + "/neon-ads" }
        return NSHomeDirectory() + "/neon-ads"
    }()
    private static var starting = false

    static func isUp() async -> Bool {
        (try? await API.data("/api/jobs", timeout: 1.5)) != nil
    }
    static var installed: Bool { FileManager.default.fileExists(atPath: root + "/dashboard.py") }

    @MainActor
    static func ensureRunning() async {
        if await isUp() { return }
        guard installed, !starting else { return }
        starting = true
        defer { starting = false }
        let cmd = "cd '\(root)' && exec python3 dashboard.py >> /tmp/neon-ads-dash.log 2>&1"
        let args = ["/bin/zsh", "-lc", cmd]
        var cargs: [UnsafeMutablePointer<CChar>?] = args.map { strdup($0) } + [nil]
        defer { cargs.forEach { free($0) } }
        var fa: posix_spawn_file_actions_t?
        posix_spawn_file_actions_init(&fa)
        posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0)
        defer { posix_spawn_file_actions_destroy(&fa) }
        var attr: posix_spawnattr_t?
        posix_spawnattr_init(&attr)
        // its own process group, so it is not taken down with the app
        posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETPGROUP))
        posix_spawnattr_setpgroup(&attr, 0)
        defer { posix_spawnattr_destroy(&attr) }
        var pid: pid_t = 0
        guard posix_spawn(&pid, "/bin/zsh", &fa, &attr, &cargs, environ) == 0 else { return }
        for _ in 0..<40 {
            if await isUp() { return }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
    }
}

@MainActor
final class Store: ObservableObject {
    static let shared = Store()
    /// Approvals waiting for Hamed. The sidebar's badge reads `AdsBadges`, not this store, so the
    /// whole window is not redrawn every time the store changes (it changes every few seconds).
    @Published private(set) var pendingApprovals = 0 {
        didSet { if AdsBadges.shared.approvals != pendingApprovals { AdsBadges.shared.approvals = pendingApprovals } }
    }
    private var started = false
    @Published var status: StatusResp?
    @Published var campaigns: [Campaign] = []
    @Published var campaignsError: String?
    @Published var analyses: [String: Analysis] = [:]
    @Published var jobs: [Job] = []
    @Published var today: WidgetToday?
    @Published var widget: WidgetData?
    @Published var lastSync: Date?
    @Published var syncing = false
    static let syncEvery: UInt64 = 300  // seconds (Meta call budget)
    private var syncLoop: Task<Void, Never>?
    @Published var loading = false
    @Published var engineUp = false
    @Published var toast: String?
    @Published var pending: PendingAction?
    @Published var brain: BrainSummary?
    @Published var showAsk = false
    private var poll: Task<Void, Never>?

    var connected: Bool { status?.check.ok ?? false }

    /// Once per app run: the engine, a first refresh, then the 5-minute sync.
    func start() async {
        if started { return }
        started = true
        await Engine.ensureRunning()
        engineUp = await Engine.isUp()
        await refreshAll()
        startSync()
    }

    /// Real-time sync: quietly pull everything from Meta every minute and push it to the widget.
    func startSync() {
        syncLoop?.cancel()
        syncLoop = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: Store.syncEvery * 1_000_000_000)
                guard let self else { return }
                if !(await Engine.isUp()) { await Engine.ensureRunning() }
                await self.refreshAll(quiet: true)
            }
        }
    }

    func refreshAll(quiet: Bool = false) async {
        if !quiet { loading = true }
        syncing = true
        async let s: Void = refreshStatus()
        async let c: Void = refreshCampaigns()
        async let j: Void = refreshJobs()
        async let w: Void = refreshToday()
        async let a: Void = refreshApprovals()
        _ = await (s, c, j, w, a)
        loading = false
        syncing = false
        engineUp = status != nil
        lastSync = Date()
        WidgetCenter.shared.reloadAllTimelines()
    }

    func refreshApprovals() async {
        if let all: [Approval] = try? await API.get("/api/approvals") {
            pendingApprovals = all.filter { $0.status == "pending" }.count
        }
    }

    func refreshStatus() async { status = try? await API.get("/api/status") }

    func refreshCampaigns() async {
        do {
            let r: CampaignsResp = try await API.get("/api/campaigns")
            campaigns = r.campaigns ?? []
            campaignsError = r.ok ? nil : r.error
            analyses = (try? await API.get("/api/analyses")) ?? [:]
        } catch { campaignsError = error.localizedDescription }
    }

    func refreshToday() async {
        let w: WidgetData? = try? await API.get("/api/widget", timeout: 90)
        if let w { widget = w; today = w.today }
    }

    func refreshJobs() async {
        jobs = (try? await API.get("/api/jobs")) ?? jobs
        poll?.cancel()
        if jobs.contains(where: { $0.running != nil }) {
            poll = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                await self?.refreshJobs()
            }
        }
    }

    func detail(_ id: String) async throws -> Detail { try await API.get("/api/campaign/\(id)", timeout: 90) }

    // MARK: actions
    func saveToken(_ t: String) async {
        do { try await API.post("/api/token", json: ["token": t.trimmingCharacters(in: .whitespacesAndNewlines)]); toast = "انحفظ التوكن"; await refreshAll() }
        catch { toast = error.localizedDescription }
    }
    func grabToken() async {
        do {
            let d = try await API.post("/api/token/chrome")
            let r = (try? JSONSerialization.jsonObject(with: d) as? [String: Any]) ?? [:]
            if r["ok"] as? Bool == true { toast = "لقطت التوكن"; await refreshAll() } else { toast = r["error"] as? String ?? "ما لقيت توكن" }
        } catch { toast = error.localizedDescription }
    }
    func upload(_ url: URL, brief: String? = nil) async {
        let ok = url.startAccessingSecurityScopedResource(); defer { if ok { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            toast = "برفع \(url.lastPathComponent)…"
            _ = try await API.data("/api/upload", method: "POST", body: data,
                                   headers: ["X-Filename": url.lastPathComponent.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "video.mp4",
                                             "X-Brief": brief ?? ""].filter { !$0.value.isEmpty }, timeout: 600)
            toast = "انرفع ✓ — Claude رح يحلّله ويعمل خطة الإعلان، والجواب بيطلع بـ «مكتبي»"
            await refreshJobs()
        } catch { toast = error.localizedDescription }
    }
    func savePlan(_ job: Job, _ plan: JSONValue) async {
        do { try await API.post("/api/jobs/\(job.id)/plan", json: plan); toast = "انحفظت الخطة"; await refreshJobs() }
        catch { toast = error.localizedDescription }
    }
    /// neon://ads?c=<id>&a=<action> (the widget's buttons; neonads://action?… from the old app's widget)
    /// → the confirmation sheet. Nothing is changed on Meta until it is confirmed there.
    func handle(url: URL) async {
        guard url.scheme == "neonads" || (url.scheme == "neon" && url.host == "ads"), let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let c = q.first(where: { $0.name == "c" })?.value, let a = q.first(where: { $0.name == "a" })?.value else { return }
        if widget == nil { await refreshToday() }
        let wc = widget?.campaigns?.first { $0.id == c }
            ?? WidgetCampaign(id: c, name: campaigns.first { $0.id == c }?.cleanName ?? c, spend: 0, conv: 0, reach: 0)
        pending = PendingAction(campaign: wc, action: a)
    }

    func perform(_ p: PendingAction) async {
        do {
            let d = try await API.post("/api/campaign/\(p.campaign.id)/action", json: ["action": p.action])
            let r = (try? JSONSerialization.jsonObject(with: d) as? [String: Any]) ?? [:]
            toast = (r["ok"] as? Bool == true) ? "تم ✅ — انعدّلت على ميتا" : (r["error"] as? String ?? "ما زبط")
        } catch { toast = error.localizedDescription }
        await refreshAll(quiet: true)
    }

    func run(_ job: Job, live: Bool) async {
        do { try await API.post("/api/jobs/\(job.id)/\(live ? "live" : "dryrun")"); await refreshJobs() }
        catch { toast = error.localizedDescription }
    }
}

#endif
