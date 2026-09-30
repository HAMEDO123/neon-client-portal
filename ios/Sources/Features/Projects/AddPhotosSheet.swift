import Photos
import PhotosUI
import SwiftUI

/// Uploading into a space — camera or library, several at once. One request
/// per photo, exactly like the website's own uploader (image-upload-form.tsx):
/// the request body limit applies to the raw upload, before compression, so a
/// handful of camera photos sent together would be refused however small they
/// end up once compressed.
struct AddPhotosSheet: View {
    let projectId: String
    let space: GallerySpace
    let onDone: () -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var isBeforeAfter = false
    @State private var caption = ""
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var shots: [CameraShot] = []
    @State private var previews: [PendingPhoto: UIImage] = [:]
    @State private var states: [PendingPhoto: UploadState] = [:]
    @State private var beforeItem: PhotosPickerItem?
    @State private var afterItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var isUploading = false
    @State private var errorMessage: String?

    private struct CameraShot: Identifiable, Hashable {
        let id = UUID()
        let image: UIImage
    }

    /// A photo waiting to go up: from the library or just taken.
    private enum PendingPhoto: Hashable {
        case library(PhotosPickerItem)
        case camera(UUID)
    }

    private enum UploadState: Equatable {
        case uploading, done, failed
    }

    private var photos: [PendingPhoto] {
        pickerItems.map { .library($0) } + shots.map { .camera($0.id) }
    }

    private var doneCount: Int { photos.filter { states[$0] == .done }.count }

    var body: some View {
        SheetScaffold(
            L("Add Photos"),
            subtitle: space.name,
            symbol: "photo.badge.plus",
            primaryTitle: primaryTitle,
            isPrimaryEnabled: isValid && !isUploading
        ) {
            await upload()
        } content: {
            SegmentedPill(
                selection: $isBeforeAfter.animation(NeonMotion.resolved(NeonMotion.smooth)),
                options: [false, true],
                title: { $0 ? L("Before / After pair") : L("Photos") },
                symbol: { $0 ? "square.split.2x1" : "photo.stack" }
            )
            .disabled(isUploading)

            if isBeforeAfter {
                pairSection
                    .transition(.neonRise)
            } else {
                photosSection
                    .transition(.neonRise)
            }

            FormSection(footer: L("Shown under the photo on the client's page.")) {
                NeonTextField(L("Photo caption"), text: $caption, prompt: L("e.g. View from the entrance"), symbol: "text.quote", hint: L("Optional"))
            }

            if isUploading || doneCount > 0, !isBeforeAfter, !photos.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(L("%d of %d uploaded", doneCount, photos.count))
                            .font(.system(.footnote, weight: .semibold))
                            .foregroundStyle(Color.neonInk)
                        Spacer()
                        Text(NeonFormat.percent(Double(doneCount) / Double(max(photos.count, 1)) * 100))
                            .font(.system(.footnote, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(NeonHue.purple.deep)
                    }
                    ProgressBar(progress: Double(doneCount) / Double(max(photos.count, 1)), height: 8)
                }
                .padding(NeonSpace.card)
                .neonSurface(.glass, radius: NeonRadius.lg)
                .transition(.neonRise)
            }

            if let errorMessage {
                StatusNote(
                    symbol: "exclamationmark.triangle.fill",
                    tone: .danger,
                    title: doneCount > 0 ? L("Some photos failed") : L("The photos weren't uploaded"),
                    detail: errorMessage
                )
                .transition(.neonRise)
            }
        }
        .neonSheet([.large])
        .interactiveDismissDisabled(isUploading)
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                let shot = CameraShot(image: image)
                withNeonAnimation(NeonMotion.bouncy) {
                    shots.append(shot)
                    previews[.camera(shot.id)] = image.preparingThumbnail(of: CGSize(width: 240, height: 240)) ?? image
                }
            }
            .ignoresSafeArea()
        }
        .onChange(of: pickerItems) { items in
            Task { await loadPreviews(items) }
        }
    }

    private var primaryTitle: String {
        if isUploading {
            return isBeforeAfter ? L("Uploading…") : L("Uploading %d/%d…", min(doneCount + 1, photos.count), photos.count)
        }
        if !isBeforeAfter, doneCount > 0 { return L("Upload the rest") }
        return L("Upload")
    }

    private var isValid: Bool {
        isBeforeAfter ? afterItem != nil : photos.contains { states[$0] != .done }
    }

    // MARK: - Several photos

    private var photosSection: some View {
        VStack(alignment: .leading, spacing: NeonSpace.md) {
            HStack(spacing: NeonSpace.sm) {
                PhotosPicker(selection: $pickerItems, maxSelectionCount: 20, matching: .images, photoLibrary: .shared()) {
                    ProjectActionTileLabel(title: L("From the library"), symbol: "photo.on.rectangle.angled", hue: .blue)
                }
                .buttonStyle(.pressable)
                if CameraPicker.isAvailable {
                    Button {
                        Haptic.tap()
                        showCamera = true
                    } label: {
                        ProjectActionTileLabel(title: L("Take a photo"), symbol: "camera.fill", hue: .purple)
                    }
                    .buttonStyle(.pressable)
                }
            }
            .disabled(isUploading)

            if photos.isEmpty {
                Text(L("Pick up to 20 at a time. Each one goes up on its own, and a retry sends only the ones that didn't."))
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                    ForEach(photos, id: \.self) { photo in
                        thumbnail(photo)
                            .transition(.neonPop)
                    }
                }
            }
        }
    }

    private func thumbnail(_ photo: PendingPhoto) -> some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous)
        return Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let preview = previews[photo] {
                    Image(uiImage: preview).resizable().scaledToFill()
                } else {
                    Rectangle().fill(NeonHue.grey.wash).shimmer()
                }
            }
            .overlay {
                switch states[photo] {
                case .uploading:
                    ZStack {
                        Color.black.opacity(0.35)
                        ProgressView().tint(.white)
                    }
                case .done:
                    ZStack(alignment: .bottomTrailing) {
                        Color.white.opacity(0.25)
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(.title3, weight: .bold))
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.white, Color.neonSuccess)
                            .padding(5)
                    }
                    .transition(.neonPop)
                case .failed:
                    ZStack(alignment: .bottomTrailing) {
                        Color.neonDanger.opacity(0.25)
                        Image(systemName: "exclamationmark.circle.fill")
                            .font(.system(.title3, weight: .bold))
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.white, Color.neonDanger)
                            .padding(5)
                    }
                case nil:
                    EmptyView()
                }
            }
            .clipShape(shape)
            .overlay(alignment: .topTrailing) {
                if !isUploading, states[photo] != .done {
                    Button {
                        Haptic.tap()
                        remove(photo)
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 22, height: 22)
                            .background(Circle().fill(Color.black.opacity(0.55)))
                            .overlay(Circle().strokeBorder(Color.white.opacity(0.7), lineWidth: 1))
                            .frame(width: 34, height: 34)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.pressable)
                    .offset(x: 8, y: -8)
                    .accessibilityLabel(Text(L("Remove")))
                }
            }
    }

    // MARK: - A before/after pair

    private var pairSection: some View {
        VStack(alignment: .leading, spacing: NeonSpace.md) {
            HStack(spacing: NeonSpace.md) {
                pairSlot(title: L("Before photo (optional)"), item: $beforeItem, hue: .grey)
                pairSlot(title: L("After photo"), item: $afterItem, hue: .purple, isRequired: true)
            }
            Text(L("One “after” photo, with an optional “before” to compare."))
                .font(.neonSubtitle)
                .foregroundStyle(Color.neonTextTertiary)
                .padding(.horizontal, 4)
        }
        .disabled(isUploading)
    }

    private func pairSlot(title: String, item: Binding<PhotosPickerItem?>, hue: NeonHue, isRequired: Bool = false) -> some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
        return PhotosPicker(selection: item, matching: .images, photoLibrary: .shared()) {
            VStack(spacing: 8) {
                Color.clear
                    .aspectRatio(3 / 4, contentMode: .fit)
                    .overlay {
                        if let chosen = item.wrappedValue, let preview = previews[.library(chosen)] {
                            Image(uiImage: preview).resizable().scaledToFill()
                        } else {
                            VStack(spacing: 8) {
                                IconTile(item.wrappedValue == nil ? "plus" : "photo", hue: hue, size: 40, style: .filled)
                                Text(item.wrappedValue == nil ? L("Choose") : L("Loading"))
                                    .font(.system(.caption, weight: .semibold))
                                    .foregroundStyle(hue.deep)
                            }
                        }
                    }
                    .background(shape.fill(hue.wash))
                    .clipShape(shape)
                    .overlay(shape.strokeBorder(hue.color.opacity(0.35), style: StrokeStyle(lineWidth: 1.5, dash: item.wrappedValue == nil ? [6, 5] : [])))
                HStack(spacing: 3) {
                    Text(title)
                    if isRequired {
                        Text(verbatim: "*").foregroundStyle(Color.neonDanger)
                    }
                }
                .font(.system(.footnote, weight: .semibold))
                .foregroundStyle(Color.neonInk.opacity(0.8))
                .lineLimit(2)
                .multilineTextAlignment(.center)
            }
        }
        .buttonStyle(.pressable)
        .onChange(of: item.wrappedValue) { chosen in
            guard let chosen else { return }
            Task { await loadPreviews([chosen]) }
        }
    }

    // MARK: - Work

    private func remove(_ photo: PendingPhoto) {
        withNeonAnimation(NeonMotion.snappy) {
            switch photo {
            case .library(let item): pickerItems.removeAll { $0 == item }
            case .camera(let id): shots.removeAll { $0.id == id }
            }
            previews[photo] = nil
            states[photo] = nil
        }
    }

    private func loadPreviews(_ items: [PhotosPickerItem]) async {
        for item in items where previews[.library(item)] == nil {
            guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else { continue }
            let thumb = await image.byPreparingThumbnail(ofSize: CGSize(width: 360, height: 360)) ?? image
            withNeonAnimation(NeonMotion.gentle) { previews[.library(item)] = thumb }
        }
    }

    private func makeUpload(_ photo: PendingPhoto) async -> UploadFile? {
        switch photo {
        case .library(let item): return await UploadMaker.photo(item)
        case .camera(let id):
            guard let shot = shots.first(where: { $0.id == id }) else { return nil }
            return UploadMaker.photo(shot.image)
        }
    }

    private func upload() async {
        errorMessage = nil
        isUploading = true
        defer { isUploading = false }

        if isBeforeAfter {
            guard let afterItem, let after = await UploadMaker.photo(afterItem) else {
                errorMessage = L("The “after” photo couldn't be read. Choose it again.")
                Haptic.error()
                return
            }
            var beforeUpload: UploadFile?
            if let beforeItem { beforeUpload = await UploadMaker.photo(beforeItem) }
            do {
                try await api.addGalleryImage(
                    projectId: projectId, spaceId: space.id, image: after,
                    caption: caption, isBeforeAfter: true, beforeImage: beforeUpload
                )
                finish()
            } catch {
                Haptic.error()
                errorMessage = error.localizedDescription
            }
            return
        }

        // Only what hasn't gone up yet — a retry never sends a photo twice.
        var unreadable = 0
        for photo in photos where states[photo] != .done {
            withNeonAnimation(NeonMotion.snappy) { states[photo] = .uploading }
            guard let made = await makeUpload(photo) else {
                unreadable += 1
                withNeonAnimation(NeonMotion.snappy) { states[photo] = .failed }
                continue
            }
            do {
                try await api.addGalleryImage(projectId: projectId, spaceId: space.id, image: made, caption: caption)
                withNeonAnimation(NeonMotion.snappy) { states[photo] = .done }
            } catch {
                // Stop at the server's first refusal: the next photo would meet the same one.
                withNeonAnimation(NeonMotion.snappy) { states[photo] = .failed }
                Haptic.error()
                errorMessage = error.localizedDescription
                if doneCount > 0 { onDone() }
                return
            }
        }

        if unreadable > 0 {
            Haptic.warning()
            errorMessage = projectPlural(
                unreadable,
                one: "%d photo couldn't be read on this phone. Remove it or try again.",
                other: "%d photos couldn't be read on this phone. Remove them or try again."
            )
            if doneCount > 0 { onDone() }
            return
        }
        finish()
    }

    private func finish() {
        Haptic.success()
        Toast.success(L("Photos added"))
        dismiss()
        onDone()
    }
}
