import SwiftUI
import UIKit

// Photos in a conversation, the way the latest WhatsApp draws them: the
// picture itself with rounded corners and no bubble around it, the time and
// ticks laid over its bottom corner on a soft shade, a caption (if there is
// one) in a slim bubble underneath, and four or more in a row from one person
// gathered into a grid. A tap opens the full-screen viewer, which can swipe
// through every photo in the conversation.
//
// Pictures are fetched once, shrunk to the size a phone shows them at, and
// kept in memory, so scrolling back up past them does not fetch or decode
// them again. How tall each one is is remembered too, so a photo seen before
// is laid out at its own shape straight away rather than jumping when it loads.

/// A photo's shape, clamped to what a chat shows: no taller than 3:4, no wider
/// than 16:10 — the way WhatsApp crops the extremes.
enum ChatPhotoLayout {
    static let width: CGFloat = 250
    static func height(aspect: CGFloat?) -> CGFloat {
        guard let aspect, aspect > 0 else { return width }
        let clamped = min(max(aspect, 0.75), 1.6)
        return (width / clamped).rounded()
    }
}

/// Fetched photos, shrunk for the screen, and their shapes. In memory only —
/// it is a copy of what the server has, and goes when the app does.
final class ChatPhotoCache {
    static let shared = ChatPhotoCache()

    private let images = NSCache<NSURL, UIImage>()
    private var aspects: [URL: CGFloat] = [:]
    private let lock = NSLock()

    private init() {
        images.countLimit = 120
    }

    func image(for url: URL) -> UIImage? { images.object(forKey: url as NSURL) }

    func aspect(for url: URL) -> CGFloat? {
        lock.lock(); defer { lock.unlock() }
        return aspects[url]
    }

    func store(_ image: UIImage, for url: URL) {
        images.setObject(image, forKey: url as NSURL)
        guard image.size.height > 0 else { return }
        lock.lock(); defer { lock.unlock() }
        aspects[url] = image.size.width / image.size.height
    }

    /// Fetches and shrinks one picture off the main thread. nil when it could
    /// not be fetched or read.
    func load(_ url: URL) async -> UIImage? {
        if let cached = image(for: url) { return cached }
        // A phone shows a chat photo about 250 points wide; 900 pixels covers
        // the sharpest screen without holding a 2400-pixel original in memory
        // for every photo scrolled past.
        guard let image = await ImagePipeline.shared.image(url, pixels: 900) else { return nil }
        store(image, for: url)
        return image
    }
}

/// One picture, filling whatever frame it is given. Loads through the cache,
/// shimmers while it does, and says so plainly when it cannot.
struct ChatPhotoImage: View {
    let url: URL?
    /// A picture this phone already has — a photo still on its way up.
    var local: UIImage?
    /// Told once the picture has arrived (not when it came from the cache).
    var onLoaded: ((UIImage) -> Void)?

    @State private var loaded: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let image = local ?? loaded {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            } else if failed {
                ZStack {
                    Color.neonInk.opacity(0.06)
                    VStack(spacing: 6) {
                        Image(systemName: "photo").font(.system(size: 26))
                        Text(L("Couldn't load the picture")).font(.system(size: 11, weight: .medium))
                    }
                    .foregroundStyle(Color.neonInk.opacity(0.4))
                }
            } else {
                Color.neonPurple.opacity(0.08).shimmer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        .task(id: url) {
            guard local == nil, let url else { return }
            if let cached = ChatPhotoCache.shared.image(for: url) {
                loaded = cached
                return
            }
            if let image = await ChatPhotoCache.shared.load(url) {
                onLoaded?(image)
                withAnimation(.easeOut(duration: 0.25)) { loaded = image }
            } else {
                failed = true
            }
        }
    }
}

/// One photo at its own shape (within ChatPhotoLayout's limits): the shape
/// the cache remembers, or a square until the picture arrives and says.
struct ChatPhotoFrame: View {
    let url: URL?
    var local: UIImage?
    /// Called just before the photo changes height, so the conversation can
    /// stay at the bottom if that is where it was.
    var onResize: (() -> Void)?

    @State private var aspect: CGFloat?

    init(url: URL?, local: UIImage? = nil, onResize: (() -> Void)? = nil) {
        self.url = url
        self.local = local
        self.onResize = onResize
        let known: CGFloat? = {
            if let local, local.size.height > 0 { return local.size.width / local.size.height }
            return url.flatMap { ChatPhotoCache.shared.aspect(for: $0) }
        }()
        _aspect = State(initialValue: known)
    }

    var body: some View {
        ChatPhotoImage(url: url, local: local) { image in
            guard image.size.height > 0 else { return }
            let learned = image.size.width / image.size.height
            guard ChatPhotoLayout.height(aspect: learned) != ChatPhotoLayout.height(aspect: aspect) else { return }
            onResize?()
            aspect = learned
        }
        .frame(width: ChatPhotoLayout.width, height: ChatPhotoLayout.height(aspect: aspect))
    }
}

/// The time, and on my own photos the ticks, over a photo's bottom corner on
/// a soft shade so they read on any picture.
struct ChatPhotoMeta: View {
    let time: String
    let delivery: ChatDelivery?
    var pinned = false

    var body: some View {
        HStack(spacing: 4) {
            if pinned { Image(systemName: "pin.fill").font(.system(size: 9)) }
            Text(time).font(.system(size: 11, weight: .medium)).monospacedDigit()
            if let delivery {
                ChatTicks(delivery: delivery, tint: .white.opacity(0.9))
            }
        }
        .foregroundStyle(.white)
        .shadow(color: .black.opacity(0.35), radius: 2, y: 0.5)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }
}

/// A shade rising from the bottom of a photo, under its time.
struct ChatPhotoShade: View {
    var body: some View {
        LinearGradient(colors: [.black.opacity(0), .black.opacity(0.45)], startPoint: .top, endPoint: .bottom)
            .frame(height: 44)
            .frame(maxHeight: .infinity, alignment: .bottom)
            .allowsHitTesting(false)
    }
}
