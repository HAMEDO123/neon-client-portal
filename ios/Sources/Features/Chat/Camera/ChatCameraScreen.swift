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
struct ChatCameraScreen: View {
    let chatName: String
    let onSend: (UploadFile, String) -> Void

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
        self.chatName = chatName
        self.onSend = onSend
        _caption = State(initialValue: caption)
        _mode = State(initialValue: mode)
    }

    private var showingCamera: Bool { editing == nil && video == nil }

    var body: some View {
        ZStack {
            ChatCameraView(
                camera: camera,
                library: library,
                mode: $mode,
                onClose: { dismiss() },
                onPhoto: { image in open(photo: image) },
                onVideo: { url, note in
                    video = ChatCameraVideo(asset: AVURLAsset(url: url), fileURL: url, isNote: note, fromLibrary: false)
                },
                onAsset: pick,
                onGallery: { showGallery = true },
                onLibrary: { showLibrary = true }
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
                    onSend: { file in send(file) }
                )
                .transition(.opacity)
            } else if let video {
                ChatVideoReview(
                    video: video,
                    chatName: chatName,
                    caption: $caption,
                    onClose: { close() },
                    onRetake: { close() },
                    onSend: { file in send(file) }
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
        Haptic.success()
        onSend(file, caption.trimmingCharacters(in: .whitespacesAndNewlines))
        dismiss()
    }
}
