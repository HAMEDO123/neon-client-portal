import SwiftUI
import UIKit

// The studio's cameras, from the server's side. The manager adds Tapo cameras
// here; the site keeps them (passwords sealed, never sent back), tells the
// camera relay on the office PC about them, and hands the phone three things:
//
//   GET  get/cameras/list                → CameraList (no passwords, ever)
//   POST do/cameras/save | delete | test  → add, change, remove, try one
//   GET  get/cameras/presets?id=          → whether it moves, and its saved positions
//   POST do/cameras/move | stop | goto    → pan and tilt (ONVIF, on the server)
//   GET  /api/mobile/cameras/<id>/frame   → a JPEG, now
//   GET  /api/mobile/cameras/<id>/live    → MJPEG, for as long as it is read
//
// src/lib/cameras.ts has the whole picture. Manager only: somebody on the team
// is answered 403.

// MARK: - What the server says

/// One camera (`CameraView` in src/lib/cameras.ts).
struct CameraItem: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let ip: String?
    let username: String?
    let hasPassword: Bool?
    /// "camera-account", "tapo-account", or nil for one written into the
    /// relay's own file on the office PC.
    let login: String?
    /// False for one written into the relay's file by hand: watchable, not changeable here.
    let editable: Bool?
    /// Whether it moved the last time it was tried; nil not yet known.
    let ptz: Bool?
    /// Whether the office PC could reach it just now; nil not checked.
    let online: Bool?

    var canEdit: Bool { editable ?? false }
    var signsInWithTapoAccount: Bool { login == "tapo-account" }
}

struct CameraList: Decodable {
    let cameras: [CameraItem]
    /// Said in place of the cameras when there are none.
    let why: String?
    /// "running" or "down": whether the relay on the office PC answered.
    let relay: String?

    var relayDown: Bool { relay == "down" }
}

/// The result of trying a camera, said for a person.
struct CameraTestResult: Decodable, Equatable {
    let ok: Bool
    let message: String
    let ptz: Bool?
}

struct CameraSaveResult: Decodable {
    let camera: CameraItem
    let test: CameraTestResult
}

/// A position saved on the camera (in the Tapo app: "Marked positions").
struct CameraPreset: Decodable, Identifiable, Hashable {
    let token: String
    let name: String
    var id: String { token }
}

struct CameraControls: Decodable {
    let canMove: Bool
    let presets: [CameraPreset]
    let why: String?
}

enum CameraFeedError: LocalizedError {
    /// The server refused: its sentence, when it said one.
    case refused(Int, String?)
    case notAPicture
    case network

    var errorDescription: String? {
        switch self {
        case .refused(_, let message?): return L(message)
        case .refused(let status, nil): return L("The server had a problem (%d). Try again.", status)
        case .notAPicture: return L("The camera didn't send a picture.")
        case .network: return L("Can't reach the studio server. Check the connection and try again.")
        }
    }

    var status: Int? {
        if case .refused(let status, _) = self { return status }
        return nil
    }
}

// MARK: - The calls

extension APIClient {
    func camerasList() async throws -> Loaded<CameraList> {
        try await read("cameras/list", as: CameraList.self)
    }

    /// Never kept on disk: what a camera can do now is the only useful answer.
    func cameraControls(id: String) async throws -> CameraControls {
        try await readFresh("cameras/presets", ["id": id], as: CameraControls.self)
    }

    /// Adds a camera, or changes one (`id`). An empty password keeps the saved
    /// one. The server tries it straight away and says how that went.
    func saveCamera(id: String?, name: String, ip: String, username: String, password: String) async throws -> CameraSaveResult {
        var form: [String: Any] = ["name": name, "ip": ip, "username": username, "password": password]
        if let id { form["id"] = id }
        guard let result = try await perform("cameras/save", form: form).result(CameraSaveResult.self) else { throw APIError.decoding }
        return result
    }

    func deleteCamera(id: String) async throws {
        try await perform("cameras/delete", args: [id])
    }

    func testCamera(id: String) async throws -> CameraTestResult {
        guard let result = try await perform("cameras/test", args: [id]).result(CameraTestResult.self) else { throw APIError.decoding }
        return result
    }

    // Moving is posted straight rather than through `perform`: a finger held
    // on the pad sends a move several times a second, and none of them is a
    // change any other screen needs to hear about.

    /// Pan (x, right is +) and tilt (y, up is +), each −1…1, for about a second.
    func moveCamera(id: String, x: Double, y: Double) async throws {
        try await post("do/cameras/move", json: ["args": [id, x, y]])
    }

    func stopCamera(id: String) async throws {
        try await post("do/cameras/stop", json: ["args": [id]])
    }

    func gotoCameraPreset(id: String, token: String) async throws {
        try await post("do/cameras/goto", json: ["args": [id, token]])
    }
}

// MARK: - Where the pictures come from

/// Everything the camera screens ask for — the studio's server, or (in a
/// Debug build, for screenshots) drawn stand-ins that touch no network.
@MainActor
protocol CameraFeedSource: AnyObject {
    func list() async throws -> Loaded<CameraList>
    /// The camera's picture now, decoded and ready to draw.
    func snapshot(id: String, width: Int) async throws -> UIImage
    /// The live MJPEG bytes as they arrive. Ends when the stream ends; throws
    /// CameraFeedError for a refusal.
    func liveBytes(id: String, hd: Bool) -> AsyncThrowingStream<Data, Error>
    func controls(id: String) async throws -> CameraControls
    func move(id: String, x: Double, y: Double) async throws
    func stop(id: String) async throws
    func goto(id: String, preset: String) async throws
    func save(id: String?, name: String, ip: String, username: String, password: String) async throws -> CameraSaveResult
    func delete(id: String) async throws
    func test(id: String) async throws -> CameraTestResult
    /// A picture was refused with 401: this token is no longer good.
    func signedOut()
}

/// The studio's server.
@MainActor
final class NetworkCameraSource: CameraFeedSource {
    static let shared = NetworkCameraSource()

    private var api: APIClient { APIClient.shared }
    private var lastSignOutCheck = Date.distantPast

    func list() async throws -> Loaded<CameraList> { try await api.camerasList() }
    func controls(id: String) async throws -> CameraControls { try await api.cameraControls(id: id) }
    func move(id: String, x: Double, y: Double) async throws { try await api.moveCamera(id: id, x: x, y: y) }
    func stop(id: String) async throws { try await api.stopCamera(id: id) }
    func goto(id: String, preset: String) async throws { try await api.gotoCameraPreset(id: id, token: preset) }
    func delete(id: String) async throws { try await api.deleteCamera(id: id) }
    func test(id: String) async throws -> CameraTestResult { try await api.testCamera(id: id) }

    func save(id: String?, name: String, ip: String, username: String, password: String) async throws -> CameraSaveResult {
        try await api.saveCamera(id: id, name: name, ip: ip, username: username, password: password)
    }

    /// The pictures are fetched outside APIClient (they are bytes, not JSON),
    /// with its token, the way `send` attaches it.
    private func request(_ id: String, _ kind: String, query: [URLQueryItem] = []) -> URLRequest? {
        guard let token = api.token else { return nil }
        let url = portalOrigin
            .appendingPathComponent("api/mobile/cameras")
            .appendingPathComponent(id)
            .appendingPathComponent(kind)
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        if !query.isEmpty { components?.queryItems = query }
        guard let target = components?.url else { return nil }
        var request = URLRequest(url: target)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        return request
    }

    /// A 401 means this token is no longer good. Asking `/me` lets APIClient
    /// do what it always does then — sign out, with the notice — rather than
    /// the picture code deciding that by itself.
    func signedOut() {
        guard Date().timeIntervalSince(lastSignOutCheck) > 30 else { return }
        lastSignOutCheck = Date()
        Task { _ = try? await APIClient.shared.fetchMe() }
    }

    func snapshot(id: String, width: Int) async throws -> UIImage {
        guard var request = request(id, "frame", query: [URLQueryItem(name: "width", value: String(width))]) else {
            throw CameraFeedError.refused(401, nil)
        }
        request.timeoutInterval = 20
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            if Task.isCancelled { throw CancellationError() }
            throw CameraFeedError.network
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else {
            if status == 401 { signedOut() }
            throw CameraFeedError.refused(status, CameraFeedErrorBody.message(data))
        }
        guard let image = await CameraDecoder.decode(data) else { throw CameraFeedError.notAPicture }
        return image
    }

    func liveBytes(id: String, hd: Bool) -> AsyncThrowingStream<Data, Error> {
        guard let request = request(id, "live", query: hd ? [URLQueryItem(name: "quality", value: "hd")] : []) else {
            return AsyncThrowingStream { $0.finish(throwing: CameraFeedError.refused(401, nil)) }
        }
        return MJPEGConnection.stream(request)
    }
}

/// `{ "error": "…" }`, the server's sentence on a refusal.
enum CameraFeedErrorBody {
    static func message(_ data: Data) -> String? {
        struct Body: Decodable { let error: String }
        return try? JSONDecoder().decode(Body.self, from: data).error
    }
}

/// Turns JPEG bytes into a picture ready to draw — off the main thread, so a
/// stream of them never makes the screen stutter.
enum CameraDecoder {
    static func decode(_ data: Data) async -> UIImage? {
        await Task.detached(priority: .userInitiated) {
            guard let image = UIImage(data: data) else { return nil }
            return image.preparingForDisplay() ?? image
        }.value
    }
}

// MARK: - The live connection

/// One live MJPEG connection: URLSession's bytes as they arrive, in the
/// pieces the network delivers them, until the stream ends or is cancelled.
/// A refusal (anything but 200) ends it with the server's sentence.
final class MJPEGConnection: NSObject, URLSessionDataDelegate {
    private let continuation: AsyncThrowingStream<Data, Error>.Continuation
    private var session: URLSession?
    private var status = 0
    private var refusal = Data()

    private init(_ continuation: AsyncThrowingStream<Data, Error>.Continuation) {
        self.continuation = continuation
    }

    static func stream(_ request: URLRequest) -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream(bufferingPolicy: .unbounded) { continuation in
            let connection = MJPEGConnection(continuation)
            let configuration = URLSessionConfiguration.ephemeral
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            configuration.urlCache = nil
            // Quiet for this long means the stream has died. The first frame
            // can take several seconds (the relay starts a transcoder and waits
            // for a keyframe), so not less.
            configuration.timeoutIntervalForRequest = 25
            // The server ends a connection after half an hour; the feed opens the next.
            configuration.timeoutIntervalForResource = 40 * 60
            let session = URLSession(configuration: configuration, delegate: connection, delegateQueue: nil)
            connection.session = session
            session.dataTask(with: request).resume()
            continuation.onTermination = { _ in session.invalidateAndCancel() }
        }
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        status = (response as? HTTPURLResponse)?.statusCode ?? 0
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if status == 200 {
            continuation.yield(data)
        } else if refusal.count < 4096 {
            refusal.append(data)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if status != 200, status != 0 {
            continuation.finish(throwing: CameraFeedError.refused(status, CameraFeedErrorBody.message(refusal)))
        } else if let error, (error as? URLError)?.code != .cancelled {
            continuation.finish(throwing: CameraFeedError.network)
        } else {
            continuation.finish()
        }
        session.finishTasksAndInvalidate()
        self.session = nil
    }
}
