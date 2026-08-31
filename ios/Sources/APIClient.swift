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
}
