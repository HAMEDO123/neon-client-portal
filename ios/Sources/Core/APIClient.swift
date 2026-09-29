import CryptoKit
import Foundation

/// Which side of the studio a token belongs to. The server decides it at
/// sign-in and the whole app follows: one build, two sets of screens.
enum Side: String, Codable {
    case admin = "ADMIN"
    case employee = "EMPLOYEE"
}

/// Who is signed in, as the server last said. Not a secret — the token is —
/// so it sits in UserDefaults as a plain cache of `/login` and `/me`.
struct Identity: Codable, Equatable {
    let side: Side
    let id: String?
    let name: String
}

enum APIError: LocalizedError {
    case invalidCredentials
    /// The server could not be reached at all.
    case network
    /// The token was refused: the person has been signed out.
    case unauthorized
    /// The server understood and said no, in a sentence worth showing.
    case refused(String)
    case server(Int)
    case decoding

    var errorDescription: String? {
        switch self {
        case .invalidCredentials: return L("Invalid email or password.")
        case .network: return L("Can't reach the studio server. Check the connection and try again.")
        case .unauthorized: return L("You have been signed out. Sign in again.")
        case .refused(let message): return message
        case .server(let code): return L("The server had a problem (%d). Try again.", code)
        case .decoding: return L("The server answered in a shape this app doesn't understand. Update the app.")
        }
    }
}

/// A value from the server, and — when the server could not be reached — the
/// time the copy being shown was saved. `cachedAt == nil` means it is live.
struct Loaded<T> {
    let value: T
    let cachedAt: Date?
}

/// One file in a multipart upload.
struct UploadFile {
    let field: String
    let filename: String
    let mimeType: String
    let data: Data
}

@MainActor
final class APIClient: ObservableObject {
    static let shared = APIClient()

    // The studio's own PC serves the platform, through a Cloudflare tunnel.
    private let baseURL = URL(string: "https://clients.neonjo.com/api/mobile")!
    private static let identityKey = "session_identity"

    @Published private(set) var token: String?
    @Published private(set) var identity: Identity?
    /// Set when a request was refused mid-session, so the sign-in screen can
    /// say why the person is looking at it instead of treating it as an error.
    @Published var signedOutNotice = false

    #if DEBUG
    // CI screenshot fixture only — see Models.swift's DashboardResponse.preview.
    // Never compiled into the Release build used for real installs. Nothing
    // but the dashboard has a fixture: every other call fails as offline.
    static let uiTestMode = ProcessInfo.processInfo.arguments.contains("-uiTestMode")
    #endif

    private init() {
        token = TokenStore.read()
        if token != nil,
           let data = UserDefaults.standard.data(forKey: Self.identityKey),
           let saved = try? JSONDecoder().decode(Identity.self, from: data) {
            identity = saved
        } else if token != nil {
            // A token from before the app knew about sides was the manager's:
            // the admin app was the only thing that could have issued it.
            identity = Identity(side: .admin, id: nil, name: "Manager")
        }
        #if DEBUG
        if Self.uiTestMode {
            token = "preview"
            identity = Identity(side: .admin, id: nil, name: "Manager")
        }
        #endif
    }

    var isLoggedIn: Bool { token != nil && identity != nil }
    var side: Side? { identity?.side }

    // MARK: - Signing in and out

    /// With an email, somebody on the team; without one, the manager's shared password.
    func login(email: String?, password: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body = ["password": password]
        if let email, !email.isEmpty { body["email"] = email }
        request.httpBody = try JSONEncoder().encode(body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw APIError.network
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        if http.statusCode == 401 { throw APIError.invalidCredentials }
        guard http.statusCode == 200 else { throw APIError.server(http.statusCode) }

        struct LoginResponse: Decodable {
            let token: String
            let side: Side?
            let id: String?
            let name: String?
        }
        guard let decoded = try? JSONDecoder().decode(LoginResponse.self, from: data) else { throw APIError.decoding }

        let side = decoded.side ?? .admin
        signedOutNotice = false
        ResponseCache.clear()
        TokenStore.write(decoded.token)
        setIdentity(Identity(side: side, id: decoded.id, name: decoded.name ?? (side == .admin ? "Manager" : "")))
        token = decoded.token
    }

    func logout() {
        // This phone stops receiving the person's notifications — asked while
        // the token still works, then signed out without waiting on it.
        let bearer = token
        Task {
            await PushCenter.shared.unregister(bearer: bearer)
        }
        signOut(notice: false)
    }

    private func signOut(notice: Bool) {
        TokenStore.delete()
        UserDefaults.standard.removeObject(forKey: Self.identityKey)
        // What the last person's screens showed is theirs, not the next person's.
        ResponseCache.clear()
        token = nil
        identity = nil
        signedOutNotice = notice
    }

    private func setIdentity(_ value: Identity) {
        identity = value
        if let data = try? JSONEncoder().encode(value) {
            UserDefaults.standard.set(data, forKey: Self.identityKey)
        }
    }

    // MARK: - The one path every request takes

    private func url(_ path: String, _ query: [URLQueryItem]) -> URL {
        let url = baseURL.appendingPathComponent(path)
        guard !query.isEmpty, var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        components.queryItems = query
        return components.url ?? url
    }

    /// Sends one request and returns the body of a 2xx answer.
    ///
    /// A 401 on a signed-in session is the server saying this person no longer
    /// has access — disabled in the admin, or the token expired — so it signs
    /// out rather than retrying. Any other refusal carries the server's own
    /// sentence ("Only the manager marks work done, after reviewing it.").
    private func send(_ request: URLRequest) async throws -> Data {
        #if DEBUG
        if Self.uiTestMode { throw APIError.network }
        #endif
        guard let token else { throw APIError.unauthorized }
        var request = request
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        // Always the server's answer now, never a copy URLCache kept.
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let data: Data
        let response: URLResponse
        do {
            // Run apart from the calling screen's task. When a screen goes
            // away mid-request (a tab switch, a refresh) SwiftUI cancels its
            // task; a cancelled request used to arrive here as "the network is
            // down", which put the offline banner over the whole app while the
            // server was perfectly fine. The answer is simply used or dropped.
            (data, response) = try await Task.detached(priority: .userInitiated) {
                try await URLSession.shared.data(for: request)
            }.value
        } catch {
            throw APIError.network
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.network }

        switch http.statusCode {
        case 200..<300:
            return data
        case 401:
            // Only if the token that was refused is still the one we hold: a
            // late answer to an old session must not sign out a new one.
            if self.token == token { signOut(notice: true) }
            throw APIError.unauthorized
        default:
            struct ServerError: Decodable { let error: String }
            if let message = try? JSONDecoder().decode(ServerError.self, from: data).error {
                throw APIError.refused(message)
            }
            throw APIError.server(http.statusCode)
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            #if DEBUG
            print("Decoding \(T.self) failed:", error)
            #endif
            throw APIError.decoding
        }
    }

    /// A GET whose answer is kept on disk, so a screen can still show what the
    /// server last said when the phone is offline — marked as such.
    func load<T: Decodable>(_ path: String, query: [URLQueryItem] = [], as type: T.Type = T.self) async throws -> Loaded<T> {
        let target = url(path, query)
        let key = cacheKey(for: target)
        do {
            let data: Data
            do {
                data = try await send(URLRequest(url: target))
            } catch APIError.network {
                // One quiet retry before calling anything "offline": a single
                // dropped request on a phone is common and means nothing.
                try? await Task.sleep(nanoseconds: 800_000_000)
                data = try await send(URLRequest(url: target))
            }
            let value = try decode(T.self, from: data)
            ResponseCache.save(data, for: key)
            return Loaded(value: value, cachedAt: nil)
        } catch APIError.network {
            if let cached = ResponseCache.read(key), let value = try? JSONDecoder().decode(T.self, from: cached.data) {
                return Loaded(value: value, cachedAt: cached.savedAt)
            }
            throw APIError.network
        }
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], as type: T.Type = T.self) async throws -> T {
        try await load(path, query: query, as: type).value
    }

    @discardableResult
    func post(_ path: String, json: [String: Any]) async throws -> Data {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: json)
        return try await send(request)
    }

    @discardableResult
    func postMultipart(_ path: String, fields: [String: String], files: [UploadFile]) async throws -> Data {
        let boundary = "neon-\(UUID().uuidString)"
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.timeoutInterval = 180
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        func append(_ string: String) { body.append(Data(string.utf8)) }
        for (key, value) in fields {
            append("--\(boundary)\r\n")
            append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n")
            append("\(value)\r\n")
        }
        for file in files {
            // Quotes and line breaks in a name would end the header early.
            let safeName = file.filename.replacingOccurrences(of: "\"", with: "'").replacingOccurrences(of: "\r\n", with: " ")
            append("--\(boundary)\r\n")
            append("Content-Disposition: form-data; name=\"\(file.field)\"; filename=\"\(safeName)\"\r\n")
            append("Content-Type: \(file.mimeType)\r\n\r\n")
            body.append(file.data)
            append("\r\n")
        }
        append("--\(boundary)--\r\n")
        request.httpBody = body
        return try await send(request)
    }

    private func cacheKey(for url: URL) -> String {
        let who = identity.map { "\($0.side.rawValue)-\($0.id ?? "manager")" } ?? "nobody"
        return "\(who) \(url.absoluteString)"
    }

    // MARK: - Whoever is signed in

    /// Refreshes who this token belongs to. The app calls it on launch and on
    /// returning to the foreground — it is also how a disabled account finds
    /// out, on its next tap, that it no longer has access.
    func fetchMe() async throws -> Me {
        let me = try await get("me", as: Me.self)
        setIdentity(Identity(side: me.side, id: me.id ?? identity?.id, name: me.name))
        return me
    }

    // MARK: - The manager's projects

    func fetchDashboard() async throws -> Loaded<DashboardResponse> {
        #if DEBUG
        if Self.uiTestMode { return Loaded(value: .preview, cachedAt: nil) }
        #endif
        return try await load("dashboard", as: DashboardResponse.self)
    }

    func fetchProject(id: String) async throws -> ProjectDetail {
        try await get("projects/\(id)", as: ProjectDetail.self)
    }

    func postComment(projectId: String, message: String, refLabel: String? = nil) async throws -> ProjectDetail.CommentItem {
        var body: [String: Any] = ["message": message]
        if let refLabel { body["refLabel"] = refLabel }
        return try decode(ProjectDetail.CommentItem.self, from: try await post("projects/\(projectId)/comments", json: body))
    }

    func setCommentStatus(projectId: String, commentId: String, status: String) async throws {
        try await sendJSON("PATCH", "projects/\(projectId)/comments", ["commentId": commentId, "status": status])
    }

    // Full overview edit — pass every field; empty strings clear optional
    // columns server-side, matching the web admin form's semantics.
    func updateProject(id: String, fields: [String: Any]) async throws {
        try await sendJSON("PATCH", "projects/\(id)", fields)
    }

    func createProject(fields: [String: Any]) async throws -> ProjectSummary {
        try decode(ProjectSummary.self, from: try await post("projects", json: fields))
    }

    func uploadGalleryImages(
        projectId: String,
        spaceId: String?,
        spaceName: String?,
        caption: String?,
        images: [Data]
    ) async throws {
        var fields: [String: String] = [:]
        if let spaceId { fields["spaceId"] = spaceId }
        if let spaceName { fields["spaceName"] = spaceName }
        if let caption, !caption.isEmpty { fields["caption"] = caption }
        try await postMultipart(
            "projects/\(projectId)/gallery",
            fields: fields,
            files: images.map { UploadFile(field: "image", filename: "photo.jpg", mimeType: "image/jpeg", data: $0) }
        )
    }

    func uploadCover(projectId: String, image: Data) async throws {
        try await postMultipart(
            "projects/\(projectId)/cover",
            fields: [:],
            files: [UploadFile(field: "image", filename: "cover.jpg", mimeType: "image/jpeg", data: image)]
        )
    }

    @discardableResult
    func sendJSON(_ method: String, _ path: String, _ json: [String: Any]) async throws -> Data {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: json)
        return try await send(request)
    }

    // MARK: - The registry routes (src/lib/mobile/rpc.ts)
    //
    // Everything beyond the original handful of routes goes through two:
    // `get/<area>/<name>` for reads and `do/<area>/<name>` for actions. An
    // action calls the website's own server action, so its rules, guard and
    // notifications are the website's.

    /// A read, e.g. `read("team/employees")` or `read("projects/detail", ["id": id])`.
    func read<T: Decodable>(_ name: String, _ params: [String: String?] = [:], as type: T.Type = T.self) async throws -> Loaded<T> {
        let query = params
            .compactMap { key, value in value.map { URLQueryItem(name: key, value: $0) } }
            .sorted { $0.name < $1.name }
        return try await load("get/\(name)", query: query, as: T.self)
    }

    /// An action with JSON arguments (in the order the server action takes
    /// them) and/or the fields a website form would post. Use `NSNull()` for
    /// a null argument. Posts `.neonDataChanged` on success so open screens
    /// can re-read.
    @discardableResult
    func perform(_ name: String, args: [Any] = [], form: [String: Any] = [:]) async throws -> ActionOutcome {
        var body: [String: Any] = ["args": args]
        if !form.isEmpty { body["form"] = form }
        let data = try await post("do/\(name)", json: body)
        return finish(name, data)
    }

    /// An action that carries files: multipart, with the arguments as `__args`.
    @discardableResult
    func performUpload(_ name: String, args: [Any] = [], fields: [String: String] = [:], files: [UploadFile]) async throws -> ActionOutcome {
        var all = fields
        if !args.isEmpty, let encoded = try? JSONSerialization.data(withJSONObject: args) {
            all["__args"] = String(data: encoded, encoding: .utf8)
        }
        let data = try await postMultipart("do/\(name)", fields: all, files: files)
        return finish(name, data)
    }

    private func finish(_ name: String, _ data: Data) -> ActionOutcome {
        let outcome = ActionOutcome(data: data)
        NotificationCenter.default.post(name: .neonDataChanged, object: name)
        return outcome
    }

    // MARK: - The employee's own work

    func fetchToday() async throws -> Loaded<TodayResponse> {
        try await load("today", as: TodayResponse.self)
    }

    func fetchTasks(filter: TaskFilter) async throws -> Loaded<TasksResponse> {
        try await load("tasks", query: [URLQueryItem(name: "filter", value: filter.rawValue)], as: TasksResponse.self)
    }

    func fetchTask(id: String) async throws -> Loaded<StaffTask> {
        struct Wrapper: Decodable { let task: StaffTask }
        let loaded = try await load("tasks/\(id)", as: Wrapper.self)
        return Loaded(value: loaded.value.task, cachedAt: loaded.cachedAt)
    }

    /// Start a task, or put it back. Nothing else is offered: sending work for
    /// review is `submitProof`, and "done" is the manager's word.
    func setTaskState(id: String, state: String) async throws {
        try await post("tasks/\(id)/status", json: ["state": state])
    }

    /// Hands finished work in — a board cell or a job handed out by hand, the
    /// server finds which. Answers SUBMITTED, never DONE.
    func submitProof(taskId: String, file: UploadFile, note: String?) async throws {
        var fields: [String: String] = [:]
        if let note, !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { fields["note"] = note }
        try await postMultipart("tasks/\(taskId)/proof", fields: fields, files: [file])
    }

    func fetchNotifications() async throws -> Loaded<NotificationsResponse> {
        try await load("notifications", query: [URLQueryItem(name: "take", value: "100")], as: NotificationsResponse.self)
    }

    /// One by id, or every unread one when `id` is nil.
    func markNotificationsRead(id: String?) async throws {
        var body: [String: Any] = [:]
        if let id { body["id"] = id }
        try await post("notifications/read", json: body)
    }

    // MARK: - Chat

    func fetchConversations() async throws -> Loaded<ConversationsResponse> {
        try await load("chat/conversations", as: ConversationsResponse.self)
    }

    func fetchMessages(conversation: String, take: Int = 150) async throws -> Loaded<[ChatMessage]> {
        struct Wrapper: Decodable { let messages: [ChatMessage] }
        let loaded = try await load(
            "chat/messages",
            query: [URLQueryItem(name: "conversation", value: conversation), URLQueryItem(name: "take", value: String(take))],
            as: Wrapper.self
        )
        return Loaded(value: loaded.value.messages, cachedAt: loaded.cachedAt)
    }

    struct SentMessage: Decodable { let message: ChatMessage }

    func sendMessage(conversation: String, text: String) async throws -> ChatMessage {
        let data = try await post("chat/messages", json: ["conversation": conversation, "body": text])
        return try decode(SentMessage.self, from: data).message
    }

    /// A photo goes as `photo`, anything else as `document` — the names the
    /// web chat box posts, read by the same function on the server.
    func sendAttachment(conversation: String, text: String, file: UploadFile) async throws -> ChatMessage {
        var fields = ["conversation": conversation]
        if !text.isEmpty { fields["body"] = text }
        let data = try await postMultipart("chat/messages", fields: fields, files: [file])
        return try decode(SentMessage.self, from: data).message
    }

    func markConversationRead(_ conversation: String) async throws {
        try await post("chat/read", json: ["conversation": conversation])
    }
}

/// The last answer the server gave for each GET, on disk in Caches — plainly a
/// cache of what the server said, never the authority. Wiped on every sign-in
/// and sign-out so one person never sees another's.
enum ResponseCache {
    private static var directory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("api", isDirectory: true)
    }

    private static func file(for key: String) -> URL {
        let name = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(name)
    }

    static func save(_ data: Data, for key: String) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: file(for: key), options: [.atomic, .completeFileProtection])
    }

    static func read(_ key: String) -> (data: Data, savedAt: Date)? {
        let url = file(for: key)
        guard let data = try? Data(contentsOf: url) else { return nil }
        let savedAt = (try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate] as? Date) ?? Date()
        return (data, savedAt)
    }

    static func clear() {
        try? FileManager.default.removeItem(at: directory)
    }
}

/// What an action answered: `{ ok, result, redirect }`.
struct ActionOutcome {
    let data: Data

    private struct Envelope<T: Decodable>: Decodable {
        let result: T?
        let redirect: String?
    }

    /// Where the website would go next after this, e.g. "/admin/projects/<id>".
    var redirect: String? {
        (try? JSONDecoder().decode(Envelope<IgnoredValue>.self, from: data))?.redirect
    }

    /// The action's return value, decoded.
    func result<T: Decodable>(_ type: T.Type = T.self) throws -> T? {
        do {
            return try JSONDecoder().decode(Envelope<T>.self, from: data).result
        } catch {
            throw APIError.decoding
        }
    }
}

/// Decodes anything and keeps nothing.
struct IgnoredValue: Decodable {
    init(from decoder: Decoder) throws {}
}

extension Notification.Name {
    /// Posted after any successful action; `object` is the action's name
    /// ("projects/update"). Screens re-read when something they show changed.
    static let neonDataChanged = Notification.Name("neonDataChanged")
}
