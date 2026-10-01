import AVFoundation
import Photos
import PhotosUI
import SwiftUI

/// The chat's own camera, opened full screen from the composer's camera
/// button (and + → Camera): take or pick a photo or a video, edit it, write a
/// caption and send it — through the chat's own send path, handed back as the
/// same `UploadFile` a picked photo or file is.
///
///     .fullScreenCover(isPresented: $showCamera) {
///         ChatCameraScreen(chatName: title, caption: draft) { file, caption in … }
///     }
///
/// A photo comes back as `photo` (shrunk as the chat shrinks photos, unless
/// HD), a video as `document` (an H.264 MP4 within 50 MB). The caption is
/// the message's text.
///
/// The same screen serves a story (`NeonCameraView`): no video note, no
/// caption or chat, photos cut to what the full-screen preview showed.
struct ChatCameraScreen: View {
    /// Where what is taken goes.
    enum Purpose {
        /// A chat: caption, the chat's name and send.
        case chat(name: String, onSend: (UploadFile, String) -> Void)
        /// A story: handed back as a photo or an MP4; the story composer
        /// does the rest.
        case story(onPhoto: (UIImage) -> Void, onVideo: (URL) -> Void, onCancel: () -> Void)
    }

    let purpose: Purpose

    @StateObject private var camera = ChatCameraController()
    @StateObject private var library = ChatRecentPhotos()
    @State private var caption: String
    @State private var mode: ChatCameraMode
    @State private var editing: ChatPhotoEditModel?
    @State private var video: ChatCameraVideo?
    @State private var showGallery = false
    @State private var galleryItem: PhotosPickerItem?
    @State private var showLibrary = false
    @State private var loading = false
    /// Copies of picked videos, deleted when the camera closes.
    @State private var pickedFiles: [URL] = []
    @Environment(\.dismiss) private var dismiss

    init(chatName: String, caption: String = "", mode: ChatCameraMode = .photo, onSend: @escaping (UploadFile, String) -> Void) {
        purpose = .chat(name: chatName, onSend: onSend)
        _caption = State(initialValue: caption)
        _mode = State(initialValue: mode)
    }

    init(story onPhoto: @escaping (UIImage) -> Void, onVideo: @escaping (URL) -> Void, onCancel: @escaping () -> Void) {
        purpose = .story(onPhoto: onPhoto, onVideo: onVideo, onCancel: onCancel)
        _caption = State(initialValue: "")
        _mode = State(initialValue: .photo)
    }

    private var showingCamera: Bool { editing == nil && video == nil }

    private var isStory: Bool {
        if case .story = purpose { return true }
        return false
    }

    private var chatName: String {
        if case .chat(let name, _) = purpose { return name }
        return ""
    }

    /// The screen's short side over its long side, for cutting a story's
    /// recording to what the preview showed.
    private var screenShape: CGFloat? {
        guard let size = camera.previewSize else { return nil }
        return min(size.width, size.height) / max(size.width, size.height)
    }

    var body: some View {
        ZStack {
            ChatCameraView(
                camera: camera,
                library: library,
                mode: $mode,
                onClose: { cancel() },
                onPhoto: { image in open(photo: image) },
                onVideo: { url, note in
                    video = ChatCameraVideo(
                        asset: AVURLAsset(url: url), fileURL: url, isNote: note, fromLibrary: false,
                        screenShape: isStory ? screenShape : nil
                    )
                },
                onAsset: pick,
                onGallery: { showGallery = true },
                onLibrary: { showLibrary = true },
                modes: isStory ? [.video, .photo] : ChatCameraMode.allCases,
                maxVideoSeconds: isStory ? ChatVideoReview.storySeconds : nil,
                cropsToPreview: isStory
            )
            .opacity(showingCamera ? 1 : 0)
            .allowsHitTesting(showingCamera)

            if let editing {
                ChatPhotoEditor(
                    model: editing,
                    chatName: chatName,
                    caption: $caption,
                    onClose: { close() },
                    onRetake: { close() },
                    onSend: { file in send(file) },
                    forStory: storyPhoto
                )
                .transition(.opacity)
            } else if let video {
                ChatVideoReview(
                    video: video,
                    chatName: chatName,
                    caption: $caption,
                    onClose: { close() },
                    onRetake: { close() },
                    onSend: { file in send(file) },
                    forStory: storyVideo
                )
                .transition(.opacity)
            }

            if loading {
                ProgressView()
                    .controlSize(.large)
                    .tint(.white)
                    .padding(24)
                    .background(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous).fill(Color.black.opacity(0.6)))
                    .transition(.opacity)
            }
        }
        .animation(NeonMotion.resolved(NeonMotion.quick), value: showingCamera)
        .animation(NeonMotion.resolved(NeonMotion.quick), value: loading)
        .statusBarHidden(showingCamera)
        // The camera's black page wants white status-bar glyphs and dark
        // materials; this applies to the camera's own presentation only.
        .preferredColorScheme(.dark)
        .neonLanguage()
        .photosPicker(isPresented: $showGallery, selection: $galleryItem, matching: .any(of: [.images, .videos]), preferredItemEncoding: .current)
        .onChange(of: galleryItem) { item in
            guard let item else { return }
            galleryItem = nil
            Task { await load(item) }
        }
        .sheet(isPresented: $showLibrary) {
            ChatLibrarySheet(library: library, onPick: pick) {
                showGallery = true
            }
            .preferredColorScheme(.light)
        }
        .onAppear {
            camera.start()
            library.start()
        }
        .onDisappear {
            camera.stop()
            library.stop()
            for url in pickedFiles { try? FileManager.default.removeItem(at: url) }
        }
        .onChange(of: showingCamera) { visible in
            if visible { camera.resume() } else { camera.pause() }
        }
    }

    // MARK: Into the editor

    private func open(photo: UIImage) {
        Haptic.soft()
        editing = ChatPhotoEditModel(image: photo)
    }

    private func pick(_ asset: PHAsset) {
        guard !loading else { return }
        loading = true
        Task {
            defer { loading = false }
            if asset.mediaType == .video {
                guard let picked = await library.video(asset) else {
                    Toast.error(L("That video could not be read."))
                    return
                }
                video = ChatCameraVideo(asset: picked, fileURL: nil, isNote: false, fromLibrary: true)
            } else {
                guard let image = await library.photo(asset) else {
                    Toast.error(L("That photo could not be read."))
                    return
                }
                open(photo: image)
            }
        }
    }

    private func load(_ item: PhotosPickerItem) async {
        loading = true
        defer { loading = false }
        if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
            guard let movie = try? await item.loadTransferable(type: ChatPickedMovie.self) else {
                Toast.error(L("That video could not be read."))
                return
            }
            pickedFiles.append(movie.url)
            video = ChatCameraVideo(asset: AVURLAsset(url: movie.url), fileURL: movie.url, isNote: false, fromLibrary: true)
            return
        }
        guard let data = try? await item.loadTransferable(type: Data.self) else {
            Toast.error(L("That photo could not be read."))
            return
        }
        let image = await Task.detached(priority: .userInitiated) {
            UIImage(data: data)?.chatUpright(maxDimension: 4096)
        }.value
        guard let image else {
            Toast.error(L("That photo could not be read."))
            return
        }
        open(photo: image)
    }

    // MARK: Out

    /// ✕ on the editor or the review: back to the camera, this one put away.
    private func close() {
        editing = nil
        video = nil
    }

    private func send(_ file: UploadFile) {
        guard case .chat(_, let onSend) = purpose else { return }
        Haptic.success()
        onSend(file, caption.trimmingCharacters(in: .whitespacesAndNewlines))
        dismiss()
    }

    /// ✕ on the camera.
    private func cancel() {
        if case .story(_, _, let onCancel) = purpose { onCancel() }
        dismiss()
    }

    private var storyPhoto: ((UIImage) -> Void)? {
        guard case .story(let onPhoto, _, _) = purpose else { return nil }
        return { image in
            Haptic.success()
            onPhoto(image)
            dismiss()
        }
    }

    private var storyVideo: ((URL) -> Void)? {
        guard case .story(_, let onVideo, _) = purpose else { return nil }
        return { url in
            Haptic.success()
            onVideo(url)
            dismiss()
        }
    }
}

/// The NEON camera for something shown full screen — a story. The same
/// camera as the chat's (flash, zoom, focus, the recent photos, the gallery,
/// tap for a photo and hold for a video, VIDEO · PHOTO), then the editor's
/// tools (crop, text, stickers, drawing) and a Next button in place of the
/// caption and send:
///
///     .fullScreenCover(isPresented: $showCamera) {
///         NeonCameraView(purpose: .story) { image in … } onVideo: { url in … } onCancel: { … }
///     }
///
/// - `onPhoto`: the photo exactly as the full-screen preview showed it — the
///   sensor's 4:3 photo cut to the preview's visible part (the screen's
///   shape, about 9:19.5 upright, turned with the photo if it was taken on
///   its side), upright (`imageOrientation == .up`, scale 1), at most 4096
///   pixels long, with anything drawn on it burned in. A photo picked from
///   the library comes back as it is (not cut).
/// - `onVideo`: an H.264 MP4 in the temporary folder (the caller deletes it),
///   at most a minute and 1280 pixels long: a recording cut to the screen's
///   shape like the photo; a picked video at its own shape, trimmed.
/// - `onCancel`: ✕ on the camera.
///
/// It dismisses itself after calling any of the three.
struct NeonCameraView: View {
    enum Purpose {
        case story
    }

    let purpose: Purpose
    let onPhoto: (UIImage) -> Void
    let onVideo: (URL) -> Void
    var onCancel: () -> Void = {}

    init(
        purpose: Purpose = .story,
        onPhoto: @escaping (UIImage) -> Void,
        onVideo: @escaping (URL) -> Void,
        onCancel: @escaping () -> Void = {}
    ) {
        self.purpose = purpose
        self.onPhoto = onPhoto
        self.onVideo = onVideo
        self.onCancel = onCancel
    }

    var body: some View {
        switch purpose {
        case .story:
            ChatCameraScreen(story: onPhoto, onVideo: onVideo, onCancel: onCancel)
        }
    }
}
