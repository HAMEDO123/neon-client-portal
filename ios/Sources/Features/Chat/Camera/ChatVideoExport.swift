import AVFoundation
import UIKit

/// A video made ready for the chat: an H.264 MP4 the server takes as a file
/// (`document`, video/mp4, at most 50 MB — storage.ts RULES.document). It
/// starts at 1280×720 and steps down a size whenever the system's estimate
/// says it would not fit, checking the real file afterwards; a video note is
/// cut to a 640-pixel square from its middle.
enum ChatVideoExport {
    enum Failure: LocalizedError {
        case unreadable
        case tooLarge
        case failed(String?)

        var errorDescription: String? {
            switch self {
            case .unreadable: return L("That video could not be read.")
            case .tooLarge: return L("This video is too long to send. Trim it shorter.")
            case .failed(let reason): return reason ?? L("That video could not be prepared.")
            }
        }
    }

    static let noteSide: CGFloat = 640

    /// The MP4, in the temporary folder; the caller deletes it once read.
    static func mp4(
        from asset: AVAsset,
        range: CMTimeRange?,
        square: Bool,
        progress: @escaping @MainActor (Double) -> Void
    ) async throws -> URL {
        let wanted = square
            ? [AVAssetExportPresetHighestQuality, AVAssetExportPreset960x540, AVAssetExportPreset640x480, AVAssetExportPresetMediumQuality]
            : [AVAssetExportPreset1280x720, AVAssetExportPreset960x540, AVAssetExportPreset640x480,
               AVAssetExportPresetMediumQuality, AVAssetExportPresetLowQuality]
        var presets: [String] = []
        for preset in wanted where await AVAssetExportSession.compatibility(ofExportPreset: preset, with: asset, outputFileType: .mp4) {
            presets.append(preset)
        }
        let tracks = try await asset.loadTracks(withMediaType: .video)
        guard !presets.isEmpty, !tracks.isEmpty else { throw Failure.unreadable }
        let composition = square ? try await cropComposition(for: asset, shape: 1, longSide: noteSide) : nil
        let budget = Int64(ChatCameraUpload.fileLimit)

        for (index, preset) in presets.enumerated() {
            try Task.checkCancellation()
            guard let session = AVAssetExportSession(asset: asset, presetName: preset) else { continue }
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("chat-video-\(UUID().uuidString)")
                .appendingPathExtension("mp4")
            session.outputURL = url
            session.outputFileType = .mp4
            session.shouldOptimizeForNetworkUse = true
            if let range { session.timeRange = range }
            if let composition { session.videoComposition = composition }

            let isLast = index == presets.count - 1
            if !isLast, let estimate = try? await estimatedLength(of: session), estimate > budget * 9 / 10 {
                continue
            }
            try await run(session, progress: progress)
            let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? .max
            if size <= budget { return url }
            try? FileManager.default.removeItem(at: url)
        }
        throw Failure.tooLarge
    }

    private static func estimatedLength(of session: AVAssetExportSession) async throws -> Int64 {
        try await withCheckedThrowingContinuation { continuation in
            session.estimateOutputFileLength { length, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: length)
                }
            }
        }
    }

    private static func run(_ session: AVAssetExportSession, progress: @escaping @MainActor (Double) -> Void) async throws {
        // The session is only read for its progress and told to stop from
        // the other tasks; AVFoundation allows both from any thread.
        let shared = ChatExportHandle(session: session)
        let poll = Task {
            while !Task.isCancelled {
                let done = Double(shared.session.progress)
                await progress(done)
                try? await Task.sleep(nanoseconds: 120_000_000)
            }
        }
        defer { poll.cancel() }
        await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                shared.session.exportAsynchronously { continuation.resume() }
            }
        } onCancel: {
            shared.session.cancelExport()
        }
        switch session.status {
        case .completed:
            await progress(1)
        case .cancelled:
            if let url = session.outputURL { try? FileManager.default.removeItem(at: url) }
            throw CancellationError()
        default:
            if let url = session.outputURL { try? FileManager.default.removeItem(at: url) }
            throw Failure.failed(session.error?.localizedDescription)
        }
    }

    /// A centred cut of the picture, turned upright: `shape` is its width
    /// over height for an upright (portrait) video, turned for one taken on
    /// its side, so a cut fixed to the phone's screen stays fixed to it. The
    /// cut is scaled so its long side is at most `longSide`.
    private static func cropComposition(for asset: AVAsset, shape: CGFloat, longSide: CGFloat) async throws -> AVMutableVideoComposition? {
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { return nil }
        let (natural, transform, rate) = try await track.load(.naturalSize, .preferredTransform, .nominalFrameRate)
        let duration = try await asset.load(.duration)
        let oriented = CGRect(origin: .zero, size: natural).applying(transform)
        let frame = CGRect(x: 0, y: 0, width: abs(oriented.width), height: abs(oriented.height))
        guard frame.width > 0, frame.height > 0, shape > 0 else { return nil }
        let portrait = frame.height >= frame.width
        let cut = ChatCameraController.centred(aspect: portrait ? shape : 1 / shape, in: frame)
        let scale = min(1, longSide / max(cut.width, cut.height))
        // Even sizes: H.264 wants them.
        let render = CGSize(
            width: max(2, (cut.width * scale / 2).rounded(.down) * 2),
            height: max(2, (cut.height * scale / 2).rounded(.down) * 2)
        )
        let placed = transform
            .concatenating(CGAffineTransform(translationX: -oriented.minX - cut.minX, y: -oriented.minY - cut.minY))
            .concatenating(CGAffineTransform(scaleX: render.width / cut.width, y: render.height / cut.height))

        let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
        layer.setTransform(placed, at: .zero)
        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
        instruction.layerInstructions = [layer]

        let composition = AVMutableVideoComposition()
        composition.renderSize = render
        let fps = rate > 0 ? Int32(rate.rounded()) : 30
        composition.frameDuration = CMTime(value: 1, timescale: max(1, fps))
        composition.instructions = [instruction]
        return composition
    }

    // MARK: Stories

    /// A video for a story: an H.264 MP4 at most 1280 pixels on its long
    /// side, cut to what the full-screen preview showed when `screenShape`
    /// (the screen's short side over its long side) is given, else kept to
    /// its own shape. A story has no 50 MB budget of its own here — the
    /// story composer makes its own copy for the server.
    static func storyMP4(
        from asset: AVAsset,
        range: CMTimeRange?,
        screenShape: CGFloat?,
        progress: @escaping @MainActor (Double) -> Void
    ) async throws -> URL {
        let tracks = try await asset.loadTracks(withMediaType: .video)
        guard !tracks.isEmpty else { throw Failure.unreadable }
        var composition: AVMutableVideoComposition?
        if let screenShape { composition = try await cropComposition(for: asset, shape: screenShape, longSide: 1280) }
        let wanted = composition != nil
            ? [AVAssetExportPresetHighestQuality, AVAssetExportPreset1280x720]
            : [AVAssetExportPreset1280x720, AVAssetExportPresetMediumQuality]
        for preset in wanted where await AVAssetExportSession.compatibility(ofExportPreset: preset, with: asset, outputFileType: .mp4) {
            guard let session = AVAssetExportSession(asset: asset, presetName: preset) else { continue }
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("story-video-\(UUID().uuidString)")
                .appendingPathExtension("mp4")
            session.outputURL = url
            session.outputFileType = .mp4
            session.shouldOptimizeForNetworkUse = true
            if let range { session.timeRange = range }
            if let composition { session.videoComposition = composition }
            try await run(session, progress: progress)
            return url
        }
        throw Failure.unreadable
    }

    /// A few frames across a video, for the trim bar.
    static func frames(of asset: AVAsset, count: Int, height: CGFloat) async -> [UIImage] {
        guard let duration = try? await asset.load(.duration), duration.seconds > 0 else { return [] }
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: height * 3, height: height * 3)
        generator.requestedTimeToleranceBefore = CMTime(seconds: 0.5, preferredTimescale: 600)
        generator.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)
        var images: [UIImage] = []
        for index in 0..<count {
            let time = CMTime(seconds: duration.seconds * (Double(index) + 0.5) / Double(count), preferredTimescale: 600)
            if let frame = try? await generator.image(at: time) {
                images.append(UIImage(cgImage: frame.image))
            }
        }
        return images
    }
}

/// An export session handed to the progress poll and the cancel handler.
private struct ChatExportHandle: @unchecked Sendable {
    let session: AVAssetExportSession
}
