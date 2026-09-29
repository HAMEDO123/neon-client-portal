import UIKit
import ImageIO

/// Every picture the app shows from the server comes through here.
///
/// It replaced `AsyncImage`, which has no cache worth the name, cancels a load
/// that scrolls off a lazy grid and then shows the failure for good, and
/// decodes whatever it is sent at full size. A project's gallery is thirty-odd
/// 2400-pixel renders: through `AsyncImage` that was seconds per photo, a grid
/// of placeholders that never filled, and enough decoded pixels to get the app
/// killed for memory. Here:
///
/// - our own media route is asked for a picture the width it will be shown at
///   (`/api/media?w=`), so a thumbnail is a few dozen kilobytes;
/// - what arrives is decoded straight to that size (ImageIO), never at full size;
/// - decoded pictures stay in memory, and the downloads on disk (512 MB), so
///   scrolling back or opening the gallery again is instant;
/// - two views asking for the same picture share one download.
final class ImagePipeline: @unchecked Sendable {
    static let shared = ImagePipeline()

    /// The widths /api/media resizes to — the same list as the server's
    /// `MEDIA_WIDTHS` (src/lib/media-width.ts), so a phone asks for exactly
    /// the copies the server keeps.
    static let widths: [Int] = [160, 320, 640, 1080, 1600]

    private let memory = NSCache<NSString, UIImage>()
    private let session: URLSession
    private var inFlight: [String: Task<UIImage?, Never>] = [:]
    private let lock = NSLock()

    private init() {
        memory.totalCostLimit = 160 * 1024 * 1024
        let config = URLSessionConfiguration.default
        let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent("NeonImages", isDirectory: true)
        config.urlCache = URLCache(memoryCapacity: 24 * 1024 * 1024, diskCapacity: 512 * 1024 * 1024, directory: folder)
        // Files behind the media route never change under the same address.
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.timeoutIntervalForRequest = 30
        config.httpMaximumConnectionsPerHost = 6
        session = URLSession(configuration: config)
    }

    /// The server width a picture shown `pixels` wide is fetched at, or nil
    /// for the original (wider than the largest size, or unknown).
    static func bucket(_ pixels: CGFloat) -> Int? {
        guard pixels > 0 else { return nil }
        return widths.first { CGFloat($0) >= pixels }
    }

    /// The address to fetch: our own media route resizes on the server; any
    /// other address is fetched as it is and shrunk here.
    static func sizedURL(_ url: URL, width: Int?) -> URL {
        let absolute = url.absoluteURL
        guard let width, absolute.host == portalOrigin.host, absolute.path == "/api/media",
              var components = URLComponents(url: absolute, resolvingAgainstBaseURL: false) else { return absolute }
        var items = (components.queryItems ?? []).filter { $0.name != "w" }
        items.append(URLQueryItem(name: "w", value: String(width)))
        components.queryItems = items
        return components.url ?? absolute
    }

    private static func key(_ url: URL, _ width: Int?) -> String {
        "\(width ?? 0)|\(url.absoluteString)"
    }

    /// A picture already decoded at this size, without waiting — for drawing
    /// the first frame of a view that has been on screen before.
    func cached(_ url: URL?, pixels: CGFloat) -> UIImage? {
        guard let url else { return nil }
        return memory.object(forKey: Self.key(url, Self.bucket(pixels)) as NSString)
    }

    /// The picture at `url`, for showing `pixels` wide (physical pixels, not
    /// points). nil when it could not be fetched or read, after one retry.
    func image(_ url: URL, pixels: CGFloat) async -> UIImage? {
        let width = Self.bucket(pixels)
        let key = Self.key(url, width)
        if let hit = memory.object(forKey: key as NSString) { return hit }

        lock.lock()
        let task: Task<UIImage?, Never>
        if let running = inFlight[key] {
            task = running
        } else {
            let session = session
            task = Task.detached(priority: .userInitiated) {
                await Self.fetch(Self.sizedURL(url, width: width), width: width, session: session)
            }
            inFlight[key] = task
        }
        lock.unlock()

        let result = await task.value
        lock.lock()
        inFlight[key] = nil
        lock.unlock()
        if let result, let cg = result.cgImage {
            memory.setObject(result, forKey: key as NSString, cost: cg.bytesPerRow * cg.height)
        }
        return result
    }

    private static func fetch(_ url: URL, width: Int?, session: URLSession) async -> UIImage? {
        for attempt in 0..<2 {
            if attempt > 0 { try? await Task.sleep(nanoseconds: 600_000_000) }
            guard let (data, response) = try? await session.data(from: url) else { continue }
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                // A 404 will not become a picture by asking again.
                if http.statusCode == 404 { return nil }
                continue
            }
            // Longest side: twice the width covers a portrait picture shown
            // that wide; an original is capped at the size uploads are kept at.
            let longest = width.map { $0 * 2 } ?? 2400
            if let image = decode(data, longest: longest) { return image }
        }
        return nil
    }

    /// Decodes straight to the size it will be shown at, never at full size,
    /// and upright (the EXIF orientation applied).
    private static func decode(_ data: Data, longest: Int) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else {
            return nil
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: longest,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }
}
