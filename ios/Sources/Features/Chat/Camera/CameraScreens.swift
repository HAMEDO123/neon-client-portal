#if DEBUG
import AVFoundation
import SwiftUI

/// The chat camera for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots. None of
/// them touches the network: the photo and the video are drawn here.
///
/// - camera: the camera itself (black on the simulator, which has none; grant
///   Photos first — `xcrun simctl privacy <device> grant photos com.neonjo.staff`
///   — or the strip waits on the system's question)
/// - camera-note: the camera in VIDEO NOTE
/// - camera-editor: a photo just taken, as the editor opens it
/// - camera-editor-marked: the same with text, a sticker and a drawing on it
/// - camera-editor-draw, camera-editor-text, camera-editor-crop,
///   camera-editor-stickers: each tool out
/// - camera-editor-hd: HD switched on
/// - camera-video: a recorded video waiting to be sent, with the trim bar
/// - camera-note-review: a video note waiting to be sent
/// - camera-video-export: makes the MP4s the chat would send from a video
///   drawn here, and says what came out (size, shape, codec)
enum CameraScreens {
    static let ids: [String] = [
        "camera", "camera-note", "camera-editor", "camera-editor-marked", "camera-editor-draw",
        "camera-editor-text", "camera-editor-crop", "camera-editor-stickers", "camera-editor-hd",
        "camera-video", "camera-note-review", "camera-video-export",
    ]

    static let chatName = "NEON Team"

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "camera":
            return AnyView(ChatCameraScreen(chatName: chatName) { _, _ in })
        case "camera-note":
            return AnyView(ChatCameraScreen(chatName: chatName, mode: .videoNote) { _, _ in })
        case "camera-editor":
            return AnyView(CameraEditorFixture())
        case "camera-editor-marked":
            return AnyView(CameraEditorFixture(marked: true))
        case "camera-editor-draw":
            return AnyView(CameraEditorFixture(marked: true, tool: .draw))
        case "camera-editor-text":
            return AnyView(CameraEditorFixture(opening: .text("Kitchen — final")))
        case "camera-editor-crop":
            return AnyView(CameraEditorFixture(tool: .crop))
        case "camera-editor-stickers":
            return AnyView(CameraEditorFixture(opening: .stickers))
        case "camera-editor-hd":
            return AnyView(CameraEditorFixture(hd: true))
        case "camera-video":
            return AnyView(CameraVideoFixture(note: false))
        case "camera-note-review":
            return AnyView(CameraVideoFixture(note: true))
        case "camera-video-export":
            return AnyView(CameraExportCheck())
        default:
            return nil
        }
    }
}

/// A photo drawn here: a living room with a window, a sofa, a lamp and a
/// plant — something an editor's tools can be seen against.
enum CameraFixtures {
    static let photo: UIImage = {
        let size = CGSize(width: 1200, height: 1600)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            let cg = context.cgContext
            let space = CGColorSpaceCreateDeviceRGB()
            func gradient(_ top: UIColor, _ bottom: UIColor, _ rect: CGRect) {
                guard let g = CGGradient(colorsSpace: space, colors: [top.cgColor, bottom.cgColor] as CFArray, locations: [0, 1]) else { return }
                cg.saveGState()
                cg.clip(to: rect)
                cg.drawLinearGradient(g, start: CGPoint(x: rect.midX, y: rect.minY), end: CGPoint(x: rect.midX, y: rect.maxY), options: [])
                cg.restoreGState()
            }
            // Wall and floor.
            gradient(UIColor(red: 0.93, green: 0.90, blue: 0.85, alpha: 1), UIColor(red: 0.84, green: 0.80, blue: 0.74, alpha: 1), CGRect(x: 0, y: 0, width: 1200, height: 1100))
            gradient(UIColor(red: 0.62, green: 0.47, blue: 0.34, alpha: 1), UIColor(red: 0.45, green: 0.32, blue: 0.22, alpha: 1), CGRect(x: 0, y: 1100, width: 1200, height: 500))
            for plank in stride(from: 0, to: 1200, by: 150) {
                UIColor.black.withAlphaComponent(0.08).setFill()
                UIRectFill(CGRect(x: CGFloat(plank), y: 1100, width: 3, height: 500))
            }
            // The window and its sky.
            let window = CGRect(x: 640, y: 200, width: 420, height: 620)
            gradient(UIColor(red: 0.53, green: 0.75, blue: 0.96, alpha: 1), UIColor(red: 0.86, green: 0.93, blue: 0.99, alpha: 1), window)
            UIColor.white.setFill()
            UIRectFill(CGRect(x: window.midX - 8, y: window.minY, width: 16, height: window.height))
            UIRectFill(CGRect(x: window.minX, y: window.midY - 8, width: window.width, height: 16))
            UIColor.white.setStroke()
            let frame = UIBezierPath(rect: window)
            frame.lineWidth = 22
            frame.stroke()
            // A rug, the sofa and its cushions.
            UIColor(red: 0.90, green: 0.86, blue: 0.80, alpha: 1).setFill()
            UIBezierPath(ovalIn: CGRect(x: 120, y: 1230, width: 960, height: 260)).fill()
            UIColor(red: 0.27, green: 0.36, blue: 0.47, alpha: 1).setFill()
            UIBezierPath(roundedRect: CGRect(x: 110, y: 880, width: 820, height: 300), cornerRadius: 60).fill()
            UIColor(red: 0.22, green: 0.30, blue: 0.40, alpha: 1).setFill()
            UIBezierPath(roundedRect: CGRect(x: 80, y: 1010, width: 880, height: 190), cornerRadius: 50).fill()
            UIColor(red: 0.93, green: 0.68, blue: 0.36, alpha: 1).setFill()
            UIBezierPath(roundedRect: CGRect(x: 190, y: 900, width: 200, height: 160), cornerRadius: 36).fill()
            UIColor(red: 0.88, green: 0.88, blue: 0.84, alpha: 1).setFill()
            UIBezierPath(roundedRect: CGRect(x: 640, y: 900, width: 200, height: 160), cornerRadius: 36).fill()
            // A floor lamp.
            UIColor(red: 0.18, green: 0.18, blue: 0.2, alpha: 1).setFill()
            UIRectFill(CGRect(x: 1040, y: 640, width: 12, height: 560))
            UIColor(red: 0.98, green: 0.92, blue: 0.75, alpha: 1).setFill()
            let shade = UIBezierPath()
            shade.move(to: CGPoint(x: 990, y: 640))
            shade.addLine(to: CGPoint(x: 1100, y: 640))
            shade.addLine(to: CGPoint(x: 1075, y: 540))
            shade.addLine(to: CGPoint(x: 1015, y: 540))
            shade.close()
            shade.fill()
            // A plant.
            UIColor(red: 0.80, green: 0.45, blue: 0.30, alpha: 1).setFill()
            UIBezierPath(roundedRect: CGRect(x: 40, y: 760, width: 110, height: 130), cornerRadius: 14).fill()
            UIColor(red: 0.20, green: 0.52, blue: 0.33, alpha: 1).setFill()
            for leaf in 0..<7 {
                let angle = CGFloat(leaf) * .pi / 7 + .pi
                let center = CGPoint(x: 95 + cos(angle) * 70, y: 700 + sin(angle) * 110)
                UIBezierPath(ovalIn: CGRect(x: center.x - 30, y: center.y - 60, width: 60, height: 140)).fill()
            }
            // A picture on the wall.
            UIColor(red: 0.20, green: 0.20, blue: 0.24, alpha: 1).setFill()
            UIRectFill(CGRect(x: 220, y: 380, width: 300, height: 220))
            gradient(UIColor(red: 0.55, green: 0.42, blue: 0.85, alpha: 1), UIColor(red: 0.35, green: 0.62, blue: 0.95, alpha: 1), CGRect(x: 236, y: 396, width: 268, height: 188))
        }
    }()

    /// Three seconds panning across the photo, as an H.264 MP4 in the
    /// temporary folder.
    static func video() async -> URL? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("camera-fixture.mp4")
        if FileManager.default.fileExists(atPath: url.path) { return url }
        let width = 720
        let height = 1280
        guard let writer = try? AVAssetWriter(outputURL: url, fileType: .mp4) else { return nil }
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
        ])
        input.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
        ])
        guard writer.canAdd(input) else { return nil }
        writer.add(input)
        guard writer.startWriting() else { return nil }
        writer.startSession(atSourceTime: .zero)
        guard let image = photo.cgImage else { return nil }
        for frame in 0..<90 {
            while !input.isReadyForMoreMediaData { try? await Task.sleep(nanoseconds: 2_000_000) }
            guard let pool = adaptor.pixelBufferPool else { break }
            var made: CVPixelBuffer?
            CVPixelBufferPoolCreatePixelBuffer(nil, pool, &made)
            guard let buffer = made else { break }
            CVPixelBufferLockBaseAddress(buffer, [])
            if let context = CGContext(
                data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
            ) {
                let scale = CGFloat(height) / 1600 * 1.15
                let drawn = CGSize(width: 1200 * scale, height: 1600 * scale)
                let pan = (drawn.width - CGFloat(width)) * CGFloat(frame) / 89
                context.draw(image, in: CGRect(x: -pan, y: (CGFloat(height) - drawn.height) / 2, width: drawn.width, height: drawn.height))
            }
            CVPixelBufferUnlockBaseAddress(buffer, [])
            adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: 30))
        }
        input.markAsFinished()
        await writer.finishWriting()
        return writer.status == .completed ? url : nil
    }
}

private struct CameraEditorFixture: View {
    @StateObject private var model: ChatPhotoEditModel
    @State private var caption = ""
    let opening: ChatPhotoEditor.Opening?

    init(marked: Bool = false, tool: ChatPhotoEditModel.Tool? = nil, opening: ChatPhotoEditor.Opening? = nil, hd: Bool = false) {
        let model = ChatPhotoEditModel(image: CameraFixtures.photo)
        if marked {
            var title = ChatEditOverlay(kind: .text("Living room ✓"), color: 0, boxed: true, center: CGPoint(x: 0.5, y: 0.2))
            title.rotation = .degrees(-4)
            var note = ChatEditOverlay(kind: .text("Move the lamp here"), color: 4, center: CGPoint(x: 0.42, y: 0.58))
            note.scale = 0.8
            var sticker = ChatEditOverlay(kind: .emoji("👍"), center: CGPoint(x: 0.8, y: 0.83))
            sticker.rotation = .degrees(12)
            model.overlays = [title, note, sticker]
            model.strokes = [
                ChatEditStroke(points: (0...24).map { step in
                    let t = CGFloat(step) / 24
                    return CGPoint(x: 0.62 + 0.3 * t, y: 0.62 - 0.12 * sin(t * .pi))
                }, color: 2, width: 0.012),
                ChatEditStroke(points: [CGPoint(x: 0.88, y: 0.6), CGPoint(x: 0.92, y: 0.62), CGPoint(x: 0.89, y: 0.66)], color: 2, width: 0.012),
            ]
        }
        model.tool = tool
        model.hd = hd
        _model = StateObject(wrappedValue: model)
        self.opening = opening
    }

    var body: some View {
        ChatPhotoEditor(
            model: model,
            chatName: CameraScreens.chatName,
            caption: $caption,
            onClose: {},
            onRetake: {},
            onSend: { _ in },
            opening: opening
        )
        .preferredColorScheme(.dark)
        .neonLanguage()
    }
}

private struct CameraVideoFixture: View {
    let note: Bool
    @State private var video: ChatCameraVideo?
    @State private var caption = ""

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let video {
                ChatVideoReview(video: video, chatName: CameraScreens.chatName, caption: $caption,
                                onClose: {}, onRetake: {}, onSend: { _ in })
            } else {
                ProgressView().tint(.white)
            }
        }
        .preferredColorScheme(.dark)
        .neonLanguage()
        .task {
            guard let url = await CameraFixtures.video() else { return }
            video = ChatCameraVideo(asset: AVURLAsset(url: url), fileURL: url, isNote: note, fromLibrary: false)
        }
    }
}

/// Makes the two MP4s the chat would send (a video and a video note) from
/// the drawn video, and reports what came out.
private struct CameraExportCheck: View {
    @State private var lines: [String] = []
    @State private var running = true

    var body: some View {
        NeonScroll {
            SectionCard("Video export", subtitle: "From a 3 s 720×1280 H.264 fixture", symbol: "film", hue: .purple) {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(lines, id: \.self) { line in
                        Text(verbatim: line).font(.system(.footnote, design: .monospaced))
                    }
                    if running { ProgressView() }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .task { await check() }
    }

    private func check() async {
        guard let source = await CameraFixtures.video() else {
            lines.append("fixture: failed")
            running = false
            return
        }
        lines.append("fixture: \(await describe(source))")
        for square in [false, true] {
            do {
                let url = try await ChatVideoExport.mp4(from: AVURLAsset(url: source), range: nil, square: square) { _ in }
                lines.append("\(square ? "note" : "video"): \(await describe(url))")
                try? FileManager.default.removeItem(at: url)
            } catch {
                lines.append("\(square ? "note" : "video"): \(error.localizedDescription)")
            }
        }
        let trimmed = CMTimeRange(start: CMTime(seconds: 1, preferredTimescale: 600), end: CMTime(seconds: 2.5, preferredTimescale: 600))
        if let url = try? await ChatVideoExport.mp4(from: AVURLAsset(url: source), range: trimmed, square: false, progress: { _ in }) {
            lines.append("trim 1–2.5 s: \(await describe(url))")
            try? FileManager.default.removeItem(at: url)
        }
        running = false
    }

    private func describe(_ url: URL) async -> String {
        let asset = AVURLAsset(url: url)
        let bytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
        let seconds = (try? await asset.load(.duration))?.seconds ?? 0
        var shape = "?"
        var codec = "?"
        if let track = try? await asset.loadTracks(withMediaType: .video).first,
           let (natural, transform, formats) = try? await track.load(.naturalSize, .preferredTransform, .formatDescriptions) {
            let turned = CGRect(origin: .zero, size: natural).applying(transform)
            shape = "\(Int(abs(turned.width)))×\(Int(abs(turned.height)))"
            if let format = formats.first {
                let code = CMFormatDescriptionGetMediaSubType(format)
                codec = String(bytes: [24, 16, 8, 0].map { UInt8((code >> $0) & 0xFF) }, encoding: .ascii) ?? "?"
            }
        }
        let audio = ((try? await asset.loadTracks(withMediaType: .audio)) ?? []).isEmpty ? "no sound" : "sound"
        return "\(url.pathExtension) \(shape) \(codec) \(String(format: "%.2f", seconds)) s \(byteCount(bytes)) \(audio)"
    }
}
#endif
