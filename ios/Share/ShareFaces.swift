import ImageIO
import SwiftUI
import UIKit

// A conversation's face in the picker, drawn as the app's chat list draws it
// (ChatListParts.swift): the studio's round mark for the team, a group's photo
// or its colour with a group glyph, a person's initials on their own colour
// with the green dot when they are here. Local equivalents, because the chat
// list's own pieces pull in half the app.

enum ShareTint {
    /// ChatTint.hues, in the same order, so a name keeps the colour it has in the app.
    private static let hues: [NeonHue] = [.purple, .pink, .cyan, .orange, .green, .indigo]

    /// nil for "ink", the manager's: a dark face rather than a colour.
    static func hue(name: String, color: String?) -> NeonHue? {
        switch color?.lowercased() {
        case "ink": return nil
        case "purple", "violet": return .purple
        case "pink", "rose", "fuchsia": return .pink
        case "cyan", "sky", "teal": return .cyan
        case "orange", "amber", "yellow": return .orange
        case "green", "emerald", "lime": return .green
        case "blue", "indigo": return .indigo
        default:
            let seed = name.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0x7FFF_FFFF }
            return hues[seed % hues.count]
        }
    }

    static func gradient(name: String, color: String?) -> LinearGradient {
        let pair: (Color, Color) = hue(name: name, color: color).map { ($0.color, $0.deep) } ?? (NeonHue.grey.deep, .neonInk)
        return LinearGradient(colors: [pair.0, pair.1], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    /// Two initials for a Latin name; one letter for an Arabic one, whose
    /// letters would otherwise join into a word that isn't one.
    static func initials(_ name: String) -> String {
        let words = name.split(whereSeparator: { $0.isWhitespace })
        guard let first = words.first?.first else { return "·" }
        if shareTextDirection(name) == .rightToLeft || words.count < 2 { return String(first).uppercased() }
        return (String(first) + (words[1].first.map(String.init) ?? "")).uppercased()
    }
}

struct ShareConversationFace: View {
    let conversation: ShareConversation
    var size: CGFloat = 46

    /// GROUP_AVATAR on the server: the studio's icon, which the team and every
    /// group without a photo of its own are sent.
    private static let studioIconPath = "/admin-icon-192.png"
    private static let studioMark = UIImage(named: "AppIcon60x60")

    var body: some View {
        if conversation.slug == "team" {
            studioFace
        } else {
            personFace
        }
    }

    private var studioFace: some View {
        ZStack {
            Color.white
            if let mark = Self.studioMark {
                Image(uiImage: mark).resizable().interpolation(.high).scaledToFill()
            } else {
                Text(verbatim: "N").font(.system(size: size * 0.45, weight: .heavy)).foregroundStyle(LinearGradient.neonBrand)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(Color.neonLine, lineWidth: 1))
        .accessibilityHidden(true)
    }

    private var personFace: some View {
        // The server answers /api/avatar?name=…&color=… for somebody with no
        // photo: their initials on their colour, drawn here with no download.
        let url = resolvedMediaURL(conversation.avatar)
        let generated = url?.path == "/api/avatar"
        let color = generated ? URLComponents(url: url!, resolvingAgainstBaseURL: true)?.queryItems?.first { $0.name == "color" }?.value : nil
        let photo = generated || url?.path == Self.studioIconPath ? nil : url
        return ZStack {
            ShareTint.gradient(name: conversation.title, color: color)
            if conversation.isGroup && photo == nil {
                Image(systemName: "person.3.fill")
                    .font(.system(size: size * 0.3, weight: .semibold))
                    .foregroundStyle(.white)
            } else {
                Text(verbatim: ShareTint.initials(conversation.title))
                    .font(.system(size: size * 0.4, weight: .bold))
                    .foregroundStyle(.white)
            }
            if let photo { ShareRemoteImage(url: photo, points: size) }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(alignment: .bottomTrailing) {
            if conversation.online {
                Circle()
                    .fill(Color.neonSuccess)
                    .frame(width: max(10, size * 0.27), height: max(10, size * 0.27))
                    .overlay(Circle().strokeBorder(Color.white, lineWidth: 2))
                    .offset(x: size * 0.02, y: size * 0.02)
            }
        }
        .accessibilityHidden(true)
    }
}

/// A photo from the server, decoded at the size it is shown. The platform's
/// own media route is asked for a small copy (`?w=`), as the app does.
struct ShareRemoteImage: View {
    let url: URL
    let points: CGFloat
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill().transition(.opacity)
            }
        }
        .task(id: url) {
            image = await ShareImages.shared.image(url, pixels: Int(points * 3))
        }
    }
}

final class ShareImages: @unchecked Sendable {
    static let shared = ShareImages()
    private let memory = NSCache<NSString, UIImage>()

    private init() {
        // Faces only, and an extension's memory is small.
        memory.countLimit = 60
    }

    func image(_ url: URL, pixels: Int) async -> UIImage? {
        let key = "\(pixels)|\(url.absoluteString)" as NSString
        if let hit = memory.object(forKey: key) { return hit }
        var target = url.absoluteURL
        if target.host == portalOrigin.host, target.path == "/api/media",
           var components = URLComponents(url: target, resolvingAgainstBaseURL: false) {
            var items = (components.queryItems ?? []).filter { $0.name != "w" }
            items.append(URLQueryItem(name: "w", value: pixels <= 160 ? "160" : "320"))
            components.queryItems = items
            target = components.url ?? target
        }
        guard let (data, response) = try? await URLSession.shared.data(from: target),
              (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true,
              let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary)
        else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: pixels,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let image = UIImage(cgImage: cg)
        memory.setObject(image, forKey: key)
        return image
    }
}
