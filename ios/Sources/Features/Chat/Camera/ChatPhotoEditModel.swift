import Photos
import SwiftUI
import UIKit

// The photo editor's state, kept in the photo's own terms so it survives a
// crop or a turn: every point is a fraction of the picture's width and height
// (0…1), every size a fraction of its width. Laying it over the picture on
// screen and burning it into the picture for sending read the same numbers,
// so what is sent is what was seen.

/// A colour in the editor's palette, by index, so a stroke or a text keeps
/// one value that both SwiftUI and UIKit can draw.
enum ChatEditPalette {
    static let colors: [UIColor] = [
        .white,
        .black,
        UIColor(Color.neonDanger),
        UIColor(Color.neonOrange),
        UIColor(Color.neonAmber),
        UIColor(Color.neonSuccess),
        UIColor(Color.neonCyan),
        UIColor(Color.neonBlue),
        UIColor(Color.neonPurple),
        UIColor(Color.neonPink),
    ]

    static func color(_ index: Int) -> UIColor { colors[max(0, min(index, colors.count - 1))] }

    static func name(_ index: Int) -> String {
        switch index {
        case 0: return L("White")
        case 1: return L("Black")
        case 2: return L("Red")
        case 3: return L("Orange")
        case 4: return L("Yellow")
        case 5: return L("Green")
        case 6: return L("Cyan")
        case 7: return L("Blue")
        case 8: return L("Purple")
        default: return L("Pink")
        }
    }
}

/// One line drawn with the pencil.
struct ChatEditStroke: Identifiable, Equatable {
    let id = UUID()
    var points: [CGPoint]
    var color: Int
    /// As a fraction of the picture's width.
    var width: CGFloat
}

/// A sticker or a piece of text laid over the picture.
struct ChatEditOverlay: Identifiable, Equatable {
    enum Kind: Equatable {
        case emoji(String)
        case text(String)
    }

    let id: UUID
    var kind: Kind
    var color: Int = 0
    /// Text on a coloured box rather than bare.
    var boxed = false
    /// Its middle, as a fraction of the picture.
    var center = CGPoint(x: 0.5, y: 0.45)
    var scale: CGFloat = 1
    var rotation: Angle = .zero

    init(kind: Kind, color: Int = 0, boxed: Bool = false, center: CGPoint = CGPoint(x: 0.5, y: 0.45)) {
        id = UUID()
        self.kind = kind
        self.color = color
        self.boxed = boxed
        self.center = center
    }

    /// Its type size at scale 1, as a fraction of the picture's width.
    var baseSize: CGFloat {
        switch kind {
        case .emoji: return 0.17
        case .text: return 0.075
        }
    }
}

@MainActor
final class ChatPhotoEditModel: ObservableObject {
    enum Tool: Equatable {
        case crop, draw, text
    }

    /// The picture, upright, one pixel per point.
    @Published private(set) var image: UIImage
    @Published var strokes: [ChatEditStroke] = []
    @Published var overlays: [ChatEditOverlay] = []
    @Published var tool: Tool?
    /// Sent at the size it was taken rather than the chat's usual size.
    @Published var hd = false
    @Published var penColor = 0
    @Published var penWidth: CGFloat = 0.012

    init(image: UIImage) {
        self.image = image
    }

    var aspect: CGFloat { image.size.height > 0 ? image.size.width / image.size.height : 1 }

    var isEdited: Bool { !strokes.isEmpty || !overlays.isEmpty }

    // MARK: Crop and turn

    /// Turns the picture a quarter to the left `quarterTurns` times, then cuts
    /// it to `rect` (a fraction of the turned picture). Drawings and overlays
    /// move with it; anything left outside is simply cut off.
    func applyCrop(rect: CGRect, quarterTurns: Int) {
        var picture = image
        var strokes = strokes
        var overlays = overlays
        for _ in 0..<((quarterTurns % 4 + 4) % 4) {
            let widthOverHeight = picture.size.width / max(picture.size.height, 1)
            picture = picture.chatRotatedLeft()
            strokes = strokes.map { stroke in
                var turned = stroke
                turned.points = stroke.points.map { CGPoint(x: $0.y, y: 1 - $0.x) }
                turned.width = stroke.width * widthOverHeight
                return turned
            }
            overlays = overlays.map { overlay in
                var turned = overlay
                turned.center = CGPoint(x: overlay.center.y, y: 1 - overlay.center.x)
                turned.scale = overlay.scale * widthOverHeight
                turned.rotation = overlay.rotation - .degrees(90)
                return turned
            }
        }

        let bounds = CGRect(x: 0, y: 0, width: 1, height: 1)
        let cut = rect.intersection(bounds)
        if !cut.isNull, cut.width > 0.01, cut.height > 0.01, cut != bounds,
           let cg = picture.cgImage {
            let pixels = CGRect(
                x: cut.minX * CGFloat(cg.width), y: cut.minY * CGFloat(cg.height),
                width: cut.width * CGFloat(cg.width), height: cut.height * CGFloat(cg.height)
            ).integral
            if let cropped = cg.cropping(to: pixels) {
                picture = UIImage(cgImage: cropped, scale: 1, orientation: .up)
                let move = { (point: CGPoint) in
                    CGPoint(x: (point.x - cut.minX) / cut.width, y: (point.y - cut.minY) / cut.height)
                }
                strokes = strokes.map { stroke in
                    var moved = stroke
                    moved.points = stroke.points.map(move)
                    moved.width = stroke.width / cut.width
                    return moved
                }
                overlays = overlays.map { overlay in
                    var moved = overlay
                    moved.center = move(overlay.center)
                    moved.scale = overlay.scale / cut.width
                    return moved
                }
            }
        }

        image = picture
        self.strokes = strokes
        self.overlays = overlays
    }

    // MARK: The finished picture

    /// The picture with every drawing, sticker and text burned in — what is
    /// saved and sent.
    func flattened() -> UIImage {
        guard isEdited else { return image }
        let size = image.size
        let width = size.width
        let rendered = overlays.map { ($0, Self.render($0, pictureWidth: width)) }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        format.preferredRange = .standard
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            image.draw(at: .zero)
            let cg = context.cgContext
            cg.setLineCap(.round)
            cg.setLineJoin(.round)
            for stroke in strokes {
                let path = Self.path(stroke.points, in: CGRect(origin: .zero, size: size))
                cg.addPath(path.cgPath)
                cg.setStrokeColor(ChatEditPalette.color(stroke.color).cgColor)
                cg.setLineWidth(max(1, stroke.width * width))
                cg.strokePath()
            }
            for (overlay, picture) in rendered {
                guard let picture else { continue }
                cg.saveGState()
                cg.translateBy(x: overlay.center.x * size.width, y: overlay.center.y * size.height)
                cg.rotate(by: CGFloat(overlay.rotation.radians))
                let drawn = picture.size
                picture.draw(in: CGRect(x: -drawn.width / 2, y: -drawn.height / 2, width: drawn.width, height: drawn.height))
                cg.restoreGState()
            }
        }
    }

    /// One overlay drawn exactly as the screen draws it, at the picture's size.
    private static func render(_ overlay: ChatEditOverlay, pictureWidth: CGFloat) -> UIImage? {
        let renderer = ImageRenderer(content: ChatEditOverlayLabel(overlay: overlay, pictureWidth: pictureWidth))
        renderer.scale = 1
        renderer.isOpaque = false
        return renderer.uiImage
    }

    /// A smooth line through a stroke's points, in a frame of the picture.
    static func path(_ points: [CGPoint], in frame: CGRect) -> Path {
        var path = Path()
        let placed = points.map { CGPoint(x: frame.minX + $0.x * frame.width, y: frame.minY + $0.y * frame.height) }
        guard let first = placed.first else { return path }
        path.move(to: first)
        if placed.count == 1 {
            // A tap is a dot.
            path.addLine(to: CGPoint(x: first.x + 0.01, y: first.y))
            return path
        }
        // Through the midpoints, so a quick scribble is a curve, not a zigzag.
        for index in 1..<placed.count {
            let previous = placed[index - 1]
            let current = placed[index]
            let middle = CGPoint(x: (previous.x + current.x) / 2, y: (previous.y + current.y) / 2)
            path.addQuadCurve(to: middle, control: previous)
        }
        if let last = placed.last { path.addLine(to: last) }
        return path
    }
}

/// A sticker or a piece of text, drawn at a picture of a given width — on
/// screen (the picture as shown) and into the finished photo alike.
struct ChatEditOverlayLabel: View {
    let overlay: ChatEditOverlay
    let pictureWidth: CGFloat

    private var size: CGFloat { max(8, overlay.baseSize * overlay.scale * pictureWidth) }

    var body: some View {
        switch overlay.kind {
        case .emoji(let emoji):
            Text(verbatim: emoji)
                .font(.system(size: size))
                .fixedSize()
        case .text(let text):
            let color = Color(ChatEditPalette.color(overlay.color))
            Text(verbatim: text)
                .font(.system(size: size, weight: .bold))
                .multilineTextAlignment(.center)
                .foregroundStyle(overlay.boxed ? Self.ink(on: overlay.color) : color)
                .shadow(color: overlay.boxed ? .clear : .black.opacity(0.35), radius: size * 0.06)
                .padding(.horizontal, size * 0.35)
                .padding(.vertical, size * 0.18)
                .background {
                    if overlay.boxed {
                        RoundedRectangle(cornerRadius: size * 0.3, style: .continuous).fill(color)
                    }
                }
                .fixedSize()
        }
    }

    /// Text on a box: black on the light colours, white on the rest.
    static func ink(on index: Int) -> Color {
        [0, 4].contains(index) ? .black : .white
    }
}

// MARK: - Saving and sending

enum ChatCameraUpload {
    /// The server's ceiling for a photo (storage.ts RULES.image, 40 MB),
    /// less a margin.
    static let photoLimit = 39 * 1024 * 1024
    /// The server's ceiling for a file (storage.ts RULES.document, 50 MB),
    /// less a margin for the parts of the upload around it.
    static let fileLimit = 49 * 1024 * 1024

    /// A photo exactly as the chat sends one: the `photo` field, shrunk to
    /// 2400 pixels at the chat's usual quality (UploadMaker.photo) — or, with
    /// HD, at the size it was taken (up to 4096 pixels) and a higher quality,
    /// still inside the server's 40 MB. The server fits every chat photo
    /// within 2400 pixels when it stores it (storage.ts compressImage), so HD
    /// means it starts from the original rather than from a copy already
    /// shrunk once.
    static func photo(_ image: UIImage, hd: Bool) -> UploadFile? {
        guard hd else { return UploadMaker.photo(image) }
        var picture = image
        var quality: CGFloat = 0.92
        for _ in 0..<8 {
            guard let data = picture.jpegData(compressionQuality: quality) else { return nil }
            if data.count <= photoLimit {
                return UploadFile(field: "photo", filename: "photo.jpg", mimeType: "image/jpeg", data: data)
            }
            if quality > 0.7 {
                quality -= 0.1
            } else {
                picture = picture.scaledDown(maxDimension: max(picture.size.width, picture.size.height) * 0.75)
            }
        }
        return UploadMaker.photo(image)
    }

    /// Saves a photo to the phone's library, asking for "add only" access the
    /// first time. Says how it went.
    @MainActor static func save(image: UIImage) async {
        guard await addAccess() else { return }
        do {
            try await PHPhotoLibrary.shared().performChanges {
                PHAssetCreationRequest.creationRequestForAsset(from: image)
            }
            Haptic.success()
            Toast.success(L("Saved to Photos"))
        } catch {
            Toast.error(error)
        }
    }

    @MainActor static func save(videoAt url: URL) async {
        guard await addAccess() else { return }
        do {
            try await PHPhotoLibrary.shared().performChanges {
                _ = PHAssetCreationRequest.creationRequestForAssetFromVideo(atFileURL: url)
            }
            Haptic.success()
            Toast.success(L("Saved to Photos"))
        } catch {
            Toast.error(error)
        }
    }

    @MainActor private static func addAccess() async -> Bool {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else {
            Haptic.warning()
            Toast.warning(L("NEON can't save to Photos"), detail: L("Allow it in Settings › NEON › Photos."))
            return false
        }
        return true
    }
}

extension UIImage {
    /// A quarter turn to the left, one pixel per point.
    func chatRotatedLeft() -> UIImage {
        let turned = CGSize(width: size.height, height: size.width)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        format.preferredRange = .standard
        return UIGraphicsImageRenderer(size: turned, format: format).image { context in
            let cg = context.cgContext
            cg.translateBy(x: 0, y: turned.height)
            cg.rotate(by: -.pi / 2)
            draw(in: CGRect(origin: .zero, size: size))
        }
    }
}
