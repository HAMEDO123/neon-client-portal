#if DEBUG
import SwiftUI
import UIKit

/// The cameras for the debug router (App/DebugScreens.swift): `-neonScreen
/// <id>` opens one straight from launch, for screenshots. None of them touches
/// the network or a real camera: the pictures are drawn here, and the live
/// ones are real MJPEG bytes made here and fed through the same scanner and
/// decoder as the studio's stream, in pieces of random size.
///
/// - cameras: the grid — four cameras, one sending no picture
/// - cameras-empty: no cameras yet, with the button to add the first
/// - cameras-relay-down: the relay on the office PC is not running
/// - cameras-loading: the list never arrives (the shimmer)
/// - camera-add, camera-edit: the sheet
/// - camera-added, camera-add-failed: the sheet after saving, with the test's answer
/// - camera-live: watching one, with the stick and saved positions
/// - camera-live-fixed: one that cannot move
/// - camera-live-lost: the stream refused
/// - camera-live-landscape: watching one with the phone turned (the scene is
///   asked for landscape; the simulator turns with it)
/// - camera-net-check: the real network path — NetworkCameraSource,
///   MJPEGConnection, the scanner and the feed — against a server on this Mac
///   (never the studio's): SIMCTL_CHILD_NEON_CAMERAS_CHECK_ORIGIN (e.g.
///   http://127.0.0.1:3999), …_CHECK_TOKEN and …_CHECK_ID. The feed prints
///   "[cameras] live …" lines to the console.
enum CamerasScreens {
    static let ids: [String] = [
        "cameras", "cameras-empty", "cameras-relay-down", "cameras-loading",
        "camera-add", "camera-edit", "camera-added", "camera-add-failed",
        "camera-live", "camera-live-fixed", "camera-live-lost", "camera-live-landscape", "camera-net-check",
    ]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "cameras":
            return debugPushed(CamerasRootView(source: CameraFixtureSource()))
        case "cameras-empty":
            return debugPushed(CamerasRootView(source: CameraFixtureSource(cameras: [])))
        case "cameras-relay-down":
            return debugPushed(CamerasRootView(source: CameraFixtureSource(cameras: [], relayDown: true)))
        case "cameras-loading":
            return debugPushed(CamerasRootView(source: CameraFixtureSource(neverAnswers: true)))
        case "camera-add":
            return sheet(CameraFormSheet(target: .add, source: CameraFixtureSource()))
        case "camera-edit":
            return sheet(CameraFormSheet(target: .edit(CameraFixtureSource.sample[0]), source: CameraFixtureSource()))
        case "camera-added":
            return sheet(CameraFormSheet(
                target: .edit(CameraFixtureSource.sample[0]),
                source: CameraFixtureSource(),
                result: CameraTestResult(ok: true, message: "Connected — the picture is coming through, and the camera can be moved from the app.", ptz: true)
            ))
        case "camera-add-failed":
            return sheet(CameraFormSheet(
                target: .edit(CameraFixtureSource.sample[1]),
                source: CameraFixtureSource(),
                result: CameraTestResult(
                    ok: false,
                    message: "The camera refused the username or password. Use the Camera Account from the Tapo app (the camera → ⚙︎ → Advanced Settings → Camera Account), not the Tapo login.",
                    ptz: nil
                )
            ))
        case "camera-live":
            return live(CameraFixtureSource(), at: 0)
        case "camera-live-fixed":
            return live(CameraFixtureSource(), at: 1)
        case "camera-live-lost":
            return live(CameraFixtureSource(liveRefusal: "The camera isn't sending a live picture."), at: 0)
        case "camera-net-check":
            let environment = ProcessInfo.processInfo.environment
            guard let origin = environment["NEON_CAMERAS_CHECK_ORIGIN"].flatMap(URL.init(string:)),
                  origin.host == "127.0.0.1" || origin.host == "localhost",
                  let token = environment["NEON_CAMERAS_CHECK_TOKEN"],
                  let id = environment["NEON_CAMERAS_CHECK_ID"] else { return nil }
            let camera = CameraItem(id: id, name: "Network check", ip: nil, username: nil, hasPassword: nil,
                                    login: "camera-account", editable: true, ptz: false, online: true)
            return AnyView(CameraNetworkCheckHost(source: NetworkCameraSource(origin: origin, token: token), camera: camera))
        case "camera-live-landscape":
            return AnyView(CameraLiveFixtureHost(source: CameraFixtureSource(), start: CameraFixtureSource.sample[0].id, landscape: true))
        default:
            return nil
        }
    }

    @MainActor private static func sheet<V: View>(_ content: V) -> AnyView {
        AnyView(
            NavigationStack {
                CamerasRootView(source: CameraFixtureSource())
            }
            .sheet(isPresented: .constant(true)) { content }
        )
    }

    @MainActor private static func live(_ source: CameraFixtureSource, at index: Int) -> AnyView {
        AnyView(CameraLiveFixtureHost(source: source, start: CameraFixtureSource.sample[index].id))
    }
}

/// The live view as the grid presents it: full screen over the page.
private struct CameraLiveFixtureHost: View {
    let source: CameraFixtureSource
    let start: String
    var landscape = false
    @StateObject private var wall = CameraWall()

    var body: some View {
        Color.black
            .ignoresSafeArea()
            .fullScreenCover(isPresented: .constant(true)) {
                CameraLiveView(cameras: CameraFixtureSource.sample, startAt: start, source: source, wall: wall)
                    .neonLanguage()
            }
            .task {
                guard landscape else { return }
                try? await Task.sleep(nanoseconds: 600_000_000)
                let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
                scene?.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight))
            }
    }
}

/// The live view over the real network source, pointed at this Mac.
private struct CameraNetworkCheckHost: View {
    let source: NetworkCameraSource
    let camera: CameraItem
    @StateObject private var wall = CameraWall()

    var body: some View {
        Color.black
            .ignoresSafeArea()
            .fullScreenCover(isPresented: .constant(true)) {
                CameraLiveView(cameras: [camera], startAt: camera.id, source: source, wall: wall)
                    .neonLanguage()
            }
            .task {
                // One snapshot through the same source, as a tile would ask.
                do {
                    let picture = try await source.snapshot(id: camera.id, width: 640)
                    print("[cameras] snapshot \(camera.id): \(Int(picture.size.width * picture.scale))×\(Int(picture.size.height * picture.scale))")
                } catch {
                    print("[cameras] snapshot \(camera.id) failed: \(error)")
                }
            }
    }
}

/// Cameras drawn here: the same answers the server gives, with no network.
@MainActor
final class CameraFixtureSource: CameraFeedSource {
    static let sample: [CameraItem] = [
        CameraItem(id: "cfrontdoor1", name: "Entrance", ip: "192.168.1.21", username: "studio_cam", hasPassword: true,
                   login: "camera-account", editable: true, ptz: true, online: true),
        CameraItem(id: "cstudio0002", name: "Design studio", ip: "192.168.1.22", username: "studio_cam", hasPassword: true,
                   login: "camera-account", editable: true, ptz: false, online: true),
        CameraItem(id: "cmeeting003", name: "غرفة الاجتماعات", ip: "192.168.1.23", username: "studio_cam", hasPassword: true,
                   login: "camera-account", editable: true, ptz: true, online: true),
        CameraItem(id: "cstore00004", name: "Store room", ip: "192.168.1.24", username: "owner@example.com", hasPassword: true,
                   login: "tapo-account", editable: true, ptz: false, online: false),
    ]

    private let cameras: [CameraItem]
    private let relayDown: Bool
    private let neverAnswers: Bool
    private let liveRefusal: String?

    init(cameras: [CameraItem]? = nil, relayDown: Bool = false, neverAnswers: Bool = false, liveRefusal: String? = nil) {
        self.cameras = cameras ?? Self.sample
        self.relayDown = relayDown
        self.neverAnswers = neverAnswers
        self.liveRefusal = liveRefusal
    }

    func list() async throws -> Loaded<CameraList> {
        if neverAnswers {
            try await Task.sleep(nanoseconds: 3_600_000_000_000)
        }
        try? await Task.sleep(nanoseconds: 300_000_000)
        let why: String? = cameras.isEmpty ? (relayDown ? "The camera relay on the office PC isn't running." : "The cameras aren't connected yet.") : nil
        return Loaded(value: CameraList(cameras: cameras, why: why, relay: relayDown ? "down" : "running"), cachedAt: nil)
    }

    func snapshot(id: String, width: Int) async throws -> UIImage {
        try await Task.sleep(nanoseconds: 250_000_000)
        guard let index = Self.sample.firstIndex(where: { $0.id == id }), index != 3 else {
            throw CameraFeedError.notAPicture
        }
        let picture = await Task.detached { CameraFixtureArt.frame(index, at: Date(), size: CGSize(width: 640, height: 360)) }.value
        return picture
    }

    func liveBytes(id: String, hd: Bool) -> AsyncThrowingStream<Data, Error> {
        let index = Self.sample.firstIndex { $0.id == id } ?? 0
        let refusal = liveRefusal
        let size = hd ? CGSize(width: 1280, height: 720) : CGSize(width: 640, height: 360)
        return AsyncThrowingStream { continuation in
            let task = Task.detached {
                if let refusal {
                    try? await Task.sleep(nanoseconds: 600_000_000)
                    continuation.finish(throwing: CameraFeedError.refused(502, refusal))
                    return
                }
                try? await Task.sleep(nanoseconds: 700_000_000)
                while !Task.isCancelled {
                    let jpeg = CameraFixtureArt.frame(index, at: Date(), size: size).jpegData(compressionQuality: 0.7) ?? Data()
                    var part = Data("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: \(jpeg.count)\r\n\r\n".utf8)
                    part.append(jpeg)
                    part.append(Data("\r\n".utf8))
                    // In pieces of any size, as a network hands them over.
                    var offset = 0
                    while offset < part.count {
                        let piece = min(Int.random(in: 700...9000), part.count - offset)
                        continuation.yield(part.subdata(in: offset..<offset + piece))
                        offset += piece
                    }
                    try? await Task.sleep(nanoseconds: 66_000_000)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func controls(id: String) async throws -> CameraControls {
        try? await Task.sleep(nanoseconds: 200_000_000)
        let camera = Self.sample.first { $0.id == id }
        guard camera?.ptz == true else { return CameraControls(canMove: false, presets: [], why: nil) }
        return CameraControls(canMove: true, presets: [
            CameraPreset(token: "1", name: "Door"),
            CameraPreset(token: "2", name: "Reception"),
            CameraPreset(token: "3", name: "المكتب"),
        ], why: nil)
    }

    func move(id: String, x: Double, y: Double) async throws {}
    func stop(id: String) async throws {}
    func goto(id: String, preset: String) async throws {}
    func delete(id: String) async throws {}
    func signedOut() {}

    func test(id: String) async throws -> CameraTestResult {
        try await Task.sleep(nanoseconds: 800_000_000)
        return CameraTestResult(ok: true, message: "Connected — the picture is coming through.", ptz: nil)
    }

    func save(id: String?, name: String, ip: String, username: String, password: String) async throws -> CameraSaveResult {
        try await Task.sleep(nanoseconds: 900_000_000)
        let camera = CameraItem(id: id ?? "cnewcamera1", name: name, ip: ip, username: username, hasPassword: true,
                                login: username.contains("@") ? "tapo-account" : "camera-account", editable: true, ptz: true, online: true)
        return CameraSaveResult(camera: camera, test: CameraTestResult(ok: true, message: "Connected — the picture is coming through, and the camera can be moved from the app.", ptz: true))
    }
}

/// A room as a CCTV camera sees it, with the time burned in like a Tapo's.
enum CameraFixtureArt {
    private static let palettes: [(UIColor, UIColor, UIColor)] = [
        (UIColor(red: 0.84, green: 0.80, blue: 0.74, alpha: 1), UIColor(red: 0.45, green: 0.33, blue: 0.24, alpha: 1), UIColor(red: 0.20, green: 0.33, blue: 0.46, alpha: 1)),
        (UIColor(red: 0.90, green: 0.90, blue: 0.88, alpha: 1), UIColor(red: 0.56, green: 0.56, blue: 0.58, alpha: 1), UIColor(red: 0.85, green: 0.55, blue: 0.25, alpha: 1)),
        (UIColor(red: 0.78, green: 0.84, blue: 0.86, alpha: 1), UIColor(red: 0.36, green: 0.31, blue: 0.27, alpha: 1), UIColor(red: 0.35, green: 0.25, blue: 0.55, alpha: 1)),
    ]

    static func frame(_ index: Int, at date: Date, size: CGSize) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let (wall, floor, accent) = palettes[index % palettes.count]
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            let cg = context.cgContext
            let w = size.width
            let h = size.height
            wall.setFill()
            cg.fill(CGRect(x: 0, y: 0, width: w, height: h * 0.62))
            floor.setFill()
            cg.fill(CGRect(x: 0, y: h * 0.62, width: w, height: h * 0.38))
            // A window with daylight.
            UIColor(red: 0.62, green: 0.80, blue: 0.95, alpha: 1).setFill()
            cg.fill(CGRect(x: w * 0.62, y: h * 0.12, width: w * 0.26, height: h * 0.34))
            UIColor.white.setStroke()
            cg.setLineWidth(max(2, w / 160))
            cg.stroke(CGRect(x: w * 0.62, y: h * 0.12, width: w * 0.26, height: h * 0.34))
            // A desk and a chair.
            accent.setFill()
            cg.fill(CGRect(x: w * 0.12, y: h * 0.52, width: w * 0.38, height: h * 0.08))
            UIColor.black.withAlphaComponent(0.55).setFill()
            cg.fill(CGRect(x: w * 0.14, y: h * 0.60, width: w * 0.02, height: h * 0.18))
            cg.fill(CGRect(x: w * 0.46, y: h * 0.60, width: w * 0.02, height: h * 0.18))
            // Somebody walking slowly across, so the picture is plainly live.
            let t = date.timeIntervalSinceReferenceDate
            let x = (0.15 + 0.7 * (0.5 + 0.5 * sin(t / 3))) * w
            UIColor(red: 0.18, green: 0.20, blue: 0.26, alpha: 0.85).setFill()
            cg.fillEllipse(in: CGRect(x: x - w * 0.025, y: h * 0.33, width: w * 0.05, height: w * 0.05))
            cg.fill(CGRect(x: x - w * 0.03, y: h * 0.33 + w * 0.05, width: w * 0.06, height: h * 0.30))
            // The camera's own clock, top left, as the Tapo burns it in.
            let stamp = Self.stamp.string(from: date)
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.monospacedDigitSystemFont(ofSize: max(12, h / 22), weight: .semibold),
                .foregroundColor: UIColor.white,
                .strokeColor: UIColor.black.withAlphaComponent(0.6),
                .strokeWidth: -2,
            ]
            (stamp as NSString).draw(at: CGPoint(x: w * 0.025, y: h * 0.03), withAttributes: attributes)
        }
    }

    private static let stamp: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()
}
#endif
