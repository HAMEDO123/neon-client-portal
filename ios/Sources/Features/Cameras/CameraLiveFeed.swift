import SwiftUI
import UIKit

/// One camera's live picture, for the full-screen view.
///
/// The bytes are read off the main thread and cut into JPEG pictures by
/// `MJPEGScanner`; only the newest waiting picture is ever decoded (off the
/// main thread too), and at most fifteen a second reach the screen — a phone
/// that falls behind skips pictures rather than showing old ones late. A
/// stream that drops, or goes quiet, is opened again: at once if it had been
/// running a while, otherwise after a growing pause, up to fifteen seconds.
/// The last picture stays on screen meanwhile. `stop()` ends it — the view
/// going away, or the app leaving the foreground.
@MainActor
final class CameraLiveFeed: ObservableObject {
    enum Phase: Equatable {
        case idle
        case connecting
        case live
        /// The connection is gone and being opened again; `message` is the
        /// server's reason when it refused.
        case lost(String?)
    }

    @Published private(set) var image: UIImage?
    @Published private(set) var phase: Phase = .idle
    /// The picture on screen as the camera's own JPEG — what "save" keeps.
    private(set) var jpeg: Data?
    private(set) var cameraId: String?
    private(set) var hd = false

    static let maxFramesPerSecond = 15.0
    /// No picture for this long after opening, or between pictures, and the
    /// stream is taken as dead.
    private static let firstFrameWait: TimeInterval = 20
    private static let frameGap: TimeInterval = 8

    private let source: CameraFeedSource
    private var task: Task<Void, Never>?
    private var lastFrameAt = Date()
    private var hadFrame = false

    init(source: CameraFeedSource) {
        self.source = source
    }

    /// Shows this camera, live. `placeholder` (its latest snapshot) stands in
    /// until the first live picture arrives.
    func start(id: String, hd: Bool, placeholder: UIImage?) {
        if task != nil, cameraId == id, self.hd == hd { return }
        task?.cancel()
        if cameraId != id {
            image = placeholder
            jpeg = nil
        }
        cameraId = id
        self.hd = hd
        hadFrame = false
        phase = .connecting
        task = Task { [weak self] in await self?.run(id: id, hd: hd) }
    }

    func stop() {
        task?.cancel()
        task = nil
        phase = .idle
    }

    private enum Outcome {
        case ended
        case stalled
        case failed
        case refused(Int, String?)
    }

    private func run(id: String, hd: Bool) async {
        var pause: Double = 1
        while !Task.isCancelled {
            let opened = Date()
            let outcome = await connect(id: id, hd: hd)
            if Task.isCancelled { return }

            switch outcome {
            case .refused(let status, let message):
                phase = .lost(message.map(L))
                // Signed out, not the manager's, or no such camera: asking
                // again will not change the answer.
                if status == 401 || status == 403 || status == 404 {
                    if status == 401 { source.signedOut() }
                    task = nil
                    return
                }
            case .ended, .stalled, .failed:
                phase = .lost(nil)
            }

            // A connection that ran a while (the server ends one after half
            // an hour) is opened again at once; one that keeps failing waits longer each time.
            let ranAWhile = Date().timeIntervalSince(opened) > 20
            pause = ranAWhile ? 0.3 : min(pause * 2, 15)
            try? await Task.sleep(nanoseconds: UInt64(pause * 1_000_000_000))
        }
    }

    /// One connection, until it ends. Pictures go to the screen as they come.
    private func connect(id: String, hd: Bool) async -> Outcome {
        let bytes = source.liveBytes(id: id, hd: hd)

        // The newest complete picture waits here; an older one waiting is
        // dropped when a newer one arrives — that is how a slow phone skips.
        var sink: AsyncStream<Data>.Continuation!
        let pictures = AsyncStream<Data>(bufferingPolicy: .bufferingNewest(1)) { sink = $0 }
        let output = sink!

        let reader = Task.detached(priority: .userInitiated) { () -> Outcome in
            var scanner = MJPEGScanner()
            defer { output.finish() }
            do {
                for try await chunk in bytes {
                    if Task.isCancelled { return .stalled }
                    for picture in scanner.append(chunk) { output.yield(picture) }
                }
                return Task.isCancelled ? .stalled : .ended
            } catch let error as CameraFeedError {
                if case .refused(let status, let message) = error { return .refused(status, message) }
                return .failed
            } catch {
                return Task.isCancelled ? .stalled : .failed
            }
        }

        lastFrameAt = Date()
        let watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard let self else { return }
                let limit = self.hadFrame ? Self.frameGap : Self.firstFrameWait
                if Date().timeIntervalSince(self.lastFrameAt) > limit {
                    reader.cancel()
                    return
                }
            }
        }

        await withTaskCancellationHandler {
            var next = pictures.makeAsyncIterator()
            var shownAt = Date.distantPast
            while !Task.isCancelled {
                // Wait out the frame interval first, so whatever arrives
                // meanwhile replaces the picture that would have been late.
                let wait = 1 / Self.maxFramesPerSecond - Date().timeIntervalSince(shownAt)
                if wait > 0 { try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000)) }
                guard let picture = await next.next() else { break }
                guard let decoded = await CameraDecoder.decode(picture), !Task.isCancelled else { continue }
                image = decoded
                jpeg = picture
                shownAt = Date()
                lastFrameAt = shownAt
                hadFrame = true
                if phase != .live { phase = .live }
            }
        } onCancel: {
            reader.cancel()
        }

        watchdog.cancel()
        reader.cancel()
        return await reader.value
    }
}
