import AVFoundation
import Photos
import PhotosUI
import SwiftUI
import UIKit

// The newest photos and videos on the phone, for the strip above the shutter
// and the grid it opens into — read with PhotoKit, so it needs the person's
// say-so: asked for when the camera opens and not before. With "Limited
// Access" the strip shows what was shared plus a tile to share more; with no
// access the strip is not drawn at all, and the gallery button still opens the
// system's own picker, which needs no permission.

@MainActor
final class ChatRecentPhotos: NSObject, ObservableObject {
    @Published private(set) var status: PHAuthorizationStatus = .notDetermined
    /// Newest first: the strip's share.
    @Published private(set) var recent: [PHAsset] = []
    /// Newest first: everything the app may see, for the grid.
    @Published private(set) var all: PHFetchResult<PHAsset>?

    let images = PHCachingImageManager()
    private var registered = false

    static let stripCount = 40

    var canRead: Bool { status == .authorized || status == .limited }
    var isLimited: Bool { status == .limited }
    /// Something to put in the strip.
    var hasStrip: Bool {
        #if DEBUG
        if !fixtureThumbs.isEmpty { return true }
        #endif
        return !recent.isEmpty || isLimited
    }

    #if DEBUG
    /// The debug router's stand-in for the library, so the strip can be
    /// screenshotted where Photos cannot be granted without a tap.
    static var fixtures: [UIImage] = []
    @Published private(set) var fixtureThumbs: [UIImage] = []
    #endif

    /// Asks once, the first time the camera opens; reads what it may.
    func start() {
        #if DEBUG
        if !Self.fixtures.isEmpty {
            status = .authorized
            fixtureThumbs = Self.fixtures
            return
        }
        #endif
        status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if status == .notDetermined {
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { [weak self] answer in
                Task { @MainActor in
                    self?.status = answer
                    self?.reload()
                }
            }
        } else {
            reload()
        }
    }

    func stop() {
        if registered { PHPhotoLibrary.shared().unregisterChangeObserver(self) }
        registered = false
        images.stopCachingImagesForAllAssets()
    }

    private func reload() {
        guard canRead else {
            recent = []
            all = nil
            return
        }
        if !registered {
            PHPhotoLibrary.shared().register(self)
            registered = true
        }
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.predicate = NSPredicate(
            format: "mediaType == %d OR mediaType == %d",
            PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue
        )
        let result = PHAsset.fetchAssets(with: options)
        all = result
        let count = min(result.count, Self.stripCount)
        recent = count > 0 ? result.objects(at: IndexSet(integersIn: 0..<count)) : []
    }

    /// "Limited Access": the system sheet for sharing more photos with the app.
    func shareMore() {
        guard let presenter = UIApplication.shared.chatCameraTopController else { return }
        PHPhotoLibrary.shared().presentLimitedLibraryPicker(from: presenter)
    }

    // MARK: Reading one

    /// A photo at up to 4096 pixels, upright. From iCloud when it is not on
    /// the phone.
    func photo(_ asset: PHAsset) async -> UIImage? {
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = true
        options.resizeMode = .fast
        let longest = CGFloat(max(asset.pixelWidth, asset.pixelHeight))
        let ratio = min(1, 4096 / max(longest, 1))
        let size = CGSize(width: CGFloat(asset.pixelWidth) * ratio, height: CGFloat(asset.pixelHeight) * ratio)
        let image: UIImage? = await withCheckedContinuation { continuation in
            var resumed = false
            images.requestImage(for: asset, targetSize: size, contentMode: .aspectFit, options: options) { image, info in
                // High quality answers once; guard anyway.
                guard !resumed else { return }
                if (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
                resumed = true
                continuation.resume(returning: image)
            }
        }
        guard let image else { return nil }
        return await Task.detached(priority: .userInitiated) { image.chatUpright(maxDimension: 4096) }.value
    }

    /// A video, as something AVFoundation can play and export.
    func video(_ asset: PHAsset) async -> AVAsset? {
        let options = PHVideoRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = true
        options.version = .current
        return await withCheckedContinuation { continuation in
            PHImageManager.default().requestAVAsset(forVideo: asset, options: options) { video, _, _ in
                continuation.resume(returning: video)
            }
        }
    }
}

extension ChatRecentPhotos: PHPhotoLibraryChangeObserver {
    nonisolated func photoLibraryDidChange(_ changeInstance: PHChange) {
        Task { @MainActor in
            self.status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            self.reload()
        }
    }
}

/// One asset's square thumbnail, with a video's length over its corner.
struct ChatAssetThumb: View {
    let asset: PHAsset
    let manager: PHCachingImageManager
    var side: CGFloat

    @State private var image: UIImage?
    @State private var request: PHImageRequestID?

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Color.white.opacity(0.08)
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: side, height: side)
                    .clipped()
                    .transition(.opacity)
            }
            if asset.mediaType == .video {
                HStack(spacing: 3) {
                    Image(systemName: "video.fill").font(.system(size: 9, weight: .bold))
                    Text(verbatim: chatCameraClock(asset.duration)).font(.system(size: 10, weight: .semibold)).monospacedDigit()
                }
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.6), radius: 2)
                .padding(4)
                .environment(\.layoutDirection, .leftToRight)
            }
        }
        .frame(width: side, height: side)
        .clipped()
        .onAppear(perform: load)
        .onDisappear {
            if let request { manager.cancelImageRequest(request) }
            request = nil
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(asset.mediaType == .video ? L("Video") : L("Photo"))
        .accessibilityAddTraits(.isButton)
    }

    private func load() {
        guard image == nil else { return }
        let options = PHImageRequestOptions()
        options.deliveryMode = .opportunistic
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = true
        let pixels = side * 3
        request = manager.requestImage(
            for: asset, targetSize: CGSize(width: pixels, height: pixels), contentMode: .aspectFill, options: options
        ) { result, _ in
            guard let result else { return }
            DispatchQueue.main.async { image = result }
        }
    }
}

/// The grid the strip opens into when it is swiped up: every photo and video
/// the app may see, newest first.
struct ChatLibrarySheet: View {
    @ObservedObject var library: ChatRecentPhotos
    let onPick: (PHAsset) -> Void
    let onSystemPicker: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            GeometryReader { geo in
                let spacing: CGFloat = 2
                let side = floor((geo.size.width - spacing * 3) / 4)
                ScrollView {
                    if library.isLimited {
                        limitedNote.padding(NeonSpace.gutter)
                    }
                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(side), spacing: spacing), count: 4), spacing: spacing) {
                        if let all = library.all {
                            ForEach(0..<all.count, id: \.self) { index in
                                let asset = all.object(at: index)
                                Button {
                                    Haptic.tap()
                                    dismiss()
                                    onPick(asset)
                                } label: {
                                    ChatAssetThumb(asset: asset, manager: library.images, side: side)
                                }
                                .buttonStyle(PressableStyle(scale: 0.96))
                            }
                        }
                    }
                    if (library.all?.count ?? 0) == 0 {
                        EmptyState(symbol: "photo.on.rectangle", title: L("No photos to show"), hue: .grey)
                            .padding(.top, 40)
                    }
                }
            }
            .navigationTitle(L("Recents"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L("Close")) { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button(L("All photos")) {
                        dismiss()
                        onSystemPicker()
                    }
                }
            }
        }
        .neonSheet([.large])
    }

    private var limitedNote: some View {
        HStack(spacing: 10) {
            Image(systemName: "lock.fill").foregroundStyle(Color.neonTextSecondary)
            Text(L("NEON can see only the photos you shared with it."))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(L("Share more")) { library.shareMore() }
                .font(.neonFootnote.weight(.semibold))
        }
        .padding(12)
        .neonSurface(.glass, radius: NeonRadius.md)
    }
}

/// A video picked in the system picker, copied somewhere the app can read it.
struct ChatPickedMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let copy = FileManager.default.temporaryDirectory
                .appendingPathComponent("chat-picked-\(UUID().uuidString)")
                .appendingPathExtension(received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension)
            try FileManager.default.copyItem(at: received.file, to: copy)
            return ChatPickedMovie(url: copy)
        }
    }
}

/// "1:05" — a video's length or a recording's time.
func chatCameraClock(_ seconds: Double) -> String {
    let total = max(0, Int(seconds.rounded(.down)))
    return String(format: "%d:%02d", total / 60, total % 60)
}

extension UIApplication {
    /// The controller on top, to present a UIKit sheet from SwiftUI.
    var chatCameraTopController: UIViewController? {
        let scene = connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
        var top = scene?.windows.first { $0.isKeyWindow }?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}
