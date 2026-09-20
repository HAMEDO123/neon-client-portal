import Foundation

enum APIError: Error {
    case invalidPassword
    case network
    case unauthorized
}

@MainActor
final class APIClient: ObservableObject {
    static let shared = APIClient()

    // The studio's own PC serves the platform now; Render was the address
    // until the switch-over. Rebuild and sideload again for this to take hold.
    private let baseURL = URL(string: "https://clients.neonjo.com/api/mobile")!

    // The token is the same signed session token the web login issues as a
    // cookie — this just carries it as a header instead. It is kept in the
    // Keychain (see TokenStore), not UserDefaults: this build is signed and
    // installed by the whole team rather than sideloaded onto one phone.
    @Published private(set) var token: String? {
        didSet {
            if let token { TokenStore.write(token) } else { TokenStore.delete() }
        }
    }

    #if DEBUG
    // CI screenshot fixture only — see Models.swift's DashboardResponse.preview.
    // Never compiled into the Release build used for real installs.
    static let uiTestMode = ProcessInfo.processInfo.arguments.contains("-uiTestMode")
    #endif

    private init() {
        token = TokenStore.read()
        #if DEBUG
        if Self.uiTestMode { token = "preview" }
        #endif
    }

    /// Who we are signed in as. Nil until /me answers — the app asks on every
    /// launch rather than trusting a stored token, which proves nothing about
    /// whether the account still exists or is still enabled.
    @Published private(set) var actor: Actor?

    var isLoggedIn: Bool { token != nil }

    func login(password: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["password": password])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        guard http.statusCode == 200 else { throw APIError.invalidPassword }

        struct LoginResponse: Codable { let token: String; let actor: Actor? }
        let decoded = try JSONDecoder().decode(LoginResponse.self, from: data)
        token = decoded.token
        actor = decoded.actor
    }

    /// Sign in as somebody on the team, with their own email and password.
    /// The manager keeps using the studio's shared password above.
    func login(email: String, password: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["email": email, "password": password])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        guard http.statusCode == 200 else { throw APIError.invalidPassword }

        struct LoginResponse: Codable { let token: String; let actor: Actor? }
        let decoded = try JSONDecoder().decode(LoginResponse.self, from: data)
        token = decoded.token
        actor = decoded.actor
    }

    /// Confirms the stored token still means something, and says which kind of
    /// person is holding it.
    ///
    /// A 401 signs out; anything else is left alone on purpose. An unreachable
    /// server is not an invalid token, and treating it as one would throw the
    /// whole team out over a tunnel that dropped for a minute.
    func refreshActor() async {
        guard let token else { return }
        var request = URLRequest(url: baseURL.appendingPathComponent("me"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse
        else { return }

        if http.statusCode == 401 {
            self.token = nil
            actor = nil
            return
        }
        guard http.statusCode == 200 else { return }

        struct MeResponse: Codable { let actor: Actor }
        actor = try? JSONDecoder().decode(MeResponse.self, from: data).actor
    }

    func logout() {
        token = nil
        actor = nil
    }

    // MARK: - Chat

    func fetchConversations() async throws -> [ConversationSummary] {
        struct Response: Codable { let conversations: [ConversationSummary] }
        return try await get("chat", as: Response.self).conversations
    }

    func fetchMessages(conversation: String) async throws -> [ChatMessage] {
        struct Response: Codable { let messages: [ChatMessage] }
        return try await get("chat/\(conversation)", as: Response.self).messages
    }

    @discardableResult
    func sendMessage(conversation: String, body: String) async throws -> ChatMessage {
        guard let token else { throw APIError.unauthorized }
        var request = URLRequest(url: baseURL.appendingPathComponent("chat/\(conversation)"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["body": body])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        if http.statusCode == 401 { self.token = nil; throw APIError.unauthorized }
        guard http.statusCode == 200 else { throw APIError.network }

        struct Response: Codable { let message: ChatMessage }
        return try JSONDecoder().decode(Response.self, from: data).message
    }

    /// One authorized GET, since every read below is the same seven lines.
    /// A 401 clears the token so the app returns to the sign-in screen rather
    /// than showing an empty list it cannot explain.
    private func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        guard let token else { throw APIError.unauthorized }
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        if http.statusCode == 401 {
            self.token = nil
            throw APIError.unauthorized
        }
        guard http.statusCode == 200 else { throw APIError.network }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func fetchDashboard() async throws -> DashboardResponse {
        #if DEBUG
        if Self.uiTestMode { return .preview }
        #endif
        guard let token else { throw APIError.unauthorized }
        var request = URLRequest(url: baseURL.appendingPathComponent("dashboard"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        if http.statusCode == 401 {
            self.token = nil
            throw APIError.unauthorized
        }
        guard http.statusCode == 200 else { throw APIError.network }
        return try JSONDecoder().decode(DashboardResponse.self, from: data)
    }

    func fetchProject(id: String) async throws -> ProjectDetail {
        guard let token else { throw APIError.unauthorized }
        var request = URLRequest(url: baseURL.appendingPathComponent("projects/\(id)"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        if http.statusCode == 401 {
            self.token = nil
            throw APIError.unauthorized
        }
        guard http.statusCode == 200 else { throw APIError.network }
        return try JSONDecoder().decode(ProjectDetail.self, from: data)
    }

    func postComment(projectId: String, message: String, refLabel: String? = nil) async throws -> ProjectDetail.CommentItem {
        guard let token else { throw APIError.unauthorized }
        var request = URLRequest(url: baseURL.appendingPathComponent("projects/\(projectId)/comments"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: String] = ["message": message]
        if let refLabel { body["refLabel"] = refLabel }
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw APIError.network }
        return try JSONDecoder().decode(ProjectDetail.CommentItem.self, from: data)
    }

    func setCommentStatus(projectId: String, commentId: String, status: String) async throws {
        guard let token else { throw APIError.unauthorized }
        var request = URLRequest(url: baseURL.appendingPathComponent("projects/\(projectId)/comments"))
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["commentId": commentId, "status": status])

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw APIError.network }
    }

    // Full overview edit — pass every field; empty strings clear optional
    // columns server-side, matching the web admin form's semantics.
    func updateProject(id: String, fields: [String: Any]) async throws {
        guard let token else { throw APIError.unauthorized }
        var request = URLRequest(url: baseURL.appendingPathComponent("projects/\(id)"))
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: fields)

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw APIError.network }
    }

    func createProject(fields: [String: Any]) async throws -> ProjectSummary {
        guard let token else { throw APIError.unauthorized }
        var request = URLRequest(url: baseURL.appendingPathComponent("projects"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: fields)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw APIError.network }
        return try JSONDecoder().decode(ProjectSummary.self, from: data)
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
        try await uploadMultipart(
            path: "projects/\(projectId)/gallery",
            fields: fields,
            files: images.map { ("image", "photo.jpg", "image/jpeg", $0) }
        )
    }

    func uploadCover(projectId: String, image: Data) async throws {
        try await uploadMultipart(
            path: "projects/\(projectId)/cover",
            fields: [:],
            files: [("image", "cover.jpg", "image/jpeg", image)]
        )
    }

    private func uploadMultipart(
        path: String,
        fields: [String: String],
        files: [(name: String, filename: String, mimeType: String, data: Data)]
    ) async throws {
        guard let token else { throw APIError.unauthorized }
        let boundary = "neon-\(UUID().uuidString)"
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        for (key, value) in fields {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }
        for file in files {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(file.name)\"; filename=\"\(file.filename)\"\r\n".data(using: .utf8)!)
            body.append("Content-Type: \(file.mimeType)\r\n\r\n".data(using: .utf8)!)
            body.append(file.data)
            body.append("\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw APIError.network }
    }
}
