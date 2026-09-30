import PhotosUI
import SwiftUI

/// Somebody's face that can be changed: their avatar with a camera badge on
/// it, and — on a tap — the photo library, the camera (where the phone has
/// one) and Remove.
///
/// One control for every place a face is set, so the wording, the shrinking
/// and the "remove" path cannot drift between them: a person's own profile,
/// the manager's own account card, and the manager on anybody's page. The
/// screen decides *whose* face `save` writes (the token for your own, the
/// employee's id for the manager's); this only picks and sends.
///
///     FacePicker(name: me.name, photo: facePhotoURL(api.myPhoto)) { file in
///         try await api.setMyPhoto(file)
///     }
///
/// What is picked shows at once and stays until the saved URL arrives, so a
/// new face never flickers back to initials while it loads; if saving fails
/// it goes, and the server's own sentence says why.
struct FacePicker: View {
    let name: String
    /// The face now, or nil for initials.
    let photo: URL?
    var size: CGFloat = 56
    var style: AvatarStyle = .solid
    var ring = false
    /// Saves a face (an upload made by `UploadMaker.photo`), or takes it off
    /// with nil. A thrown error's sentence is shown as it is.
    let save: (UploadFile?) async throws -> Void

    @State private var item: PhotosPickerItem?
    @State private var showLibrary = false
    @State private var showCamera = false
    @State private var busy = false
    /// What was just picked, drawn until the new URL takes over.
    @State private var preview: UIImage?
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        Menu {
            Button {
                showLibrary = true
            } label: {
                Label(L("Choose from library"), systemImage: "photo.on.rectangle")
            }
            if CameraPicker.isAvailable {
                Button {
                    showCamera = true
                } label: {
                    Label(L("Take a photo"), systemImage: "camera")
                }
            }
            if photo != nil || preview != nil {
                Button(role: .destructive) {
                    Task { await send(nil) }
                } label: {
                    Label(L("Remove photo"), systemImage: "trash")
                }
            }
        } label: {
            face
        }
        .disabled(busy)
        .accessibilityLabel(Text(verbatim: name))
        .accessibilityHint(photo == nil ? L("Add a photo") : L("Change photo"))
        .photosPicker(isPresented: $showLibrary, selection: $item, matching: .images)
        .onChange(of: item) { picked in
            guard let picked else { return }
            item = nil
            Task {
                guard let data = try? await picked.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
                    Haptic.error()
                    Toast.error(L("That photo could not be read."))
                    return
                }
                await use(image)
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                Task { await use(image) }
            }
            .ignoresSafeArea()
        }
        // The saved URL is here: it draws from now on (or the initials do,
        // after a removal). Fetched first, at the size the avatar asks for,
        // so the picture just chosen hands over to the stored one without
        // the initials flashing in between.
        .onChange(of: photo) { saved in
            Task {
                if let saved, preview != nil {
                    _ = await ImagePipeline.shared.image(saved, pixels: size * displayScale)
                }
                preview = nil
            }
        }
    }

    private var face: some View {
        ZStack {
            if let preview {
                Image(uiImage: preview)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(Circle())
                    .overlay {
                        if ring { Circle().strokeBorder(Color.white, lineWidth: max(1.5, size * 0.05)) }
                    }
            } else {
                AvatarView(url: photo, name: name, size: size, ring: ring, style: style)
            }
        }
        // A camera on the face, so it reads as something to tap rather than
        // a picture of somebody — and the spinner while it is being sent.
        .overlay(alignment: .bottomTrailing) {
            let badge = max(22, size * 0.34)
            Circle()
                .fill(busy ? AnyShapeStyle(Color.black.opacity(0.5)) : AnyShapeStyle(LinearGradient.neonAction))
                .frame(width: badge, height: badge)
                .overlay {
                    if busy {
                        ProgressView().controlSize(.small).tint(.white)
                    } else {
                        Image(systemName: "camera.fill")
                            .font(.system(size: badge * 0.44, weight: .bold))
                            .foregroundStyle(Color.white)
                    }
                }
                .overlay(Circle().strokeBorder(Color.white, lineWidth: 2))
                .offset(x: size * 0.04, y: size * 0.04)
        }
        .contentShape(Circle())
    }

    private func use(_ image: UIImage) async {
        guard let file = UploadMaker.photo(image, name: "face.jpg") else {
            Haptic.error()
            Toast.error(L("That photo could not be read."))
            return
        }
        withNeonAnimation { preview = image }
        await send(file)
    }

    private func send(_ file: UploadFile?) async {
        busy = true
        defer { busy = false }
        do {
            try await save(file)
            Haptic.success()
            Toast.success(file == nil ? L("Photo removed") : L("Photo saved"))
            // A removal has no new URL to wait for.
            if file == nil { preview = nil }
        } catch {
            preview = nil
            Haptic.error()
            // The server says what to do about a file it cannot read; that
            // sentence is more use than "upload failed".
            Toast.error(error.localizedDescription)
        }
    }
}
