import Foundation

enum APIError: Error {
    case invalidPassword
    case network
    case unauthorized
}

@MainActor
final class APIClient: ObservableObject {
    static let shared = APIClient()

    private let baseURL = URL(string: "https://neon-client-portal.onrender.com/api/mobile")!

    // The token is the same signed session token the web login issues as a
    // cookie — this just carries it as a header instead. Session-lifetime
    // sensitivity, same as a browser cookie file, so UserDefaults is fine
    // rather than Keychain for this first pass.
    @Published private(set) var token: String? {
        didSet { UserDefaults.standard.set(token, forKey: "session_token") }
    }

    #if DEBUG
    // CI screenshot fixture only — see Models.swift's DashboardResponse.preview.
    // Never compiled into the Release build used for real installs.
    static let uiTestMode = ProcessInfo.processInfo.arguments.contains("-uiTestMode")
    #endif

    private init() {
        token = UserDefaults.standard.string(forKey: "session_token")
        #if DEBUG
        if Self.uiTestMode { token = "preview" }
        #endif
    }

    var isLoggedIn: Bool { token != nil }

    func login(password: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["password": password])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        guard http.statusCode == 200 else { throw APIError.invalidPassword }

        struct LoginResponse: Codable { let token: String }
        let decoded = try JSONDecoder().decode(LoginResponse.self, from: data)
        token = decoded.token
    }

    func logout() {
        token = nil
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

    func updateProject(
        id: String,
        pipelineStatus: String? = nil,
        completionPercent: Int? = nil,
        publishState: String? = nil
    ) async throws {
        guard let token else { throw APIError.unauthorized }
        var request = URLRequest(url: baseURL.appendingPathComponent("projects/\(id)"))
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [:]
        if let pipelineStatus { body["pipelineStatus"] = pipelineStatus }
        if let completionPercent { body["completionPercent"] = completionPercent }
        if let publishState { body["publishState"] = publishState }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw APIError.network }
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
