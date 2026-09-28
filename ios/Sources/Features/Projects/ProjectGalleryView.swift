import SwiftUI

/// Rooms and their renders — the Gallery tab. Spaces, multi-photo upload
/// (one request per photo, like the website), captions, before/after pairs,
/// cover, hotspots and the full-screen viewer.
struct ProjectGalleryView: View {
    let projectId: String
    let spaces: [GallerySpace]
    let onChanged: () -> Void

    @EnvironmentObject var api: APIClient
    @State private var showAddSpace = false
    @State private var uploadTarget: GallerySpace?
    @State private var viewer: ImageViewerPayload?
    @State private var hotspotTarget: HotspotTarget?
    @State private var imageToDelete: GalleryImage?
    @State private var deletingSpace: GallerySpace?

    struct HotspotTarget: Identifiable {
        let image: GalleryImage
        var id: String { image.id }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            NeonButton(L("Add a space"), symbol: "plus.rectangle.on.folder", kind: .secondary, size: .small) {
                showAddSpace = true
            }

            if spaces.isEmpty {
                EmptyState(
                    symbol: "photo.on.rectangle.angled",
                    title: L("No spaces yet"),
                    detail: L("Add a space like “Living Room” or “Kitchen” to start uploading renders.")
                )
            } else {
                ForEach(spaces) { space in
                    spaceCard(space)
                }
            }
        }
        .sheet(isPresented: $showAddSpace) {
            AddSpaceSheet(projectId: projectId) { onChanged() }
        }
        .sheet(item: $uploadTarget) { space in
            AddPhotosSheet(projectId: projectId, space: space) { onChanged() }
        }
        .sheet(item: $hotspotTarget) { target in
            HotspotEditorView(projectId: projectId, image: target.image) { onChanged() }
        }
        .fullScreenCover(item: $viewer) { ImageViewerView(payload: $0) }
        .confirmDestructive(
            item: $imageToDelete,
            title: { _ in L("Delete this photo?") },
            message: { _ in L("It comes off the client's page too.") },
            actionTitle: L("Delete")
        ) { image in Task { await deleteImage(image) } }
        .confirmDestructive(
            item: $deletingSpace,
            title: { L("Remove “%@”?", $0.name) },
            message: { _ in L("Every photo in it is removed too.") },
            actionTitle: L("Remove")
        ) { space in Task { await deleteSpace(space) } }
    }

    @ViewBuilder
    private func spaceCard(_ space: GallerySpace) -> some View {
        NeonCard {
            HStack {
                DirText(space.name, font: .neonHeadline)
                Spacer()
                Text("\(space.images.count)")
                    .font(.neonFootnote)
                    .foregroundStyle(Color.neonTextTertiary)
                Menu {
                    Button { uploadTarget = space } label: { Label(L("Add Photos"), systemImage: "photo.badge.plus") }
                    Button(role: .destructive) { deletingSpace = space } label: { Label(L("Remove Space"), systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis.circle").foregroundStyle(Color.neonTextSecondary)
                }
            }

            if !space.images.isEmpty {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
                    ForEach(Array(space.images.enumerated()), id: \.element.id) { index, image in
                        imageTile(image, space: space, index: index)
                    }
                }
            }

            NeonButton(L("Add Photos"), symbol: "camera", kind: .ghost, size: .small) {
                uploadTarget = space
            }
        }
    }

    @ViewBuilder
    private func imageTile(_ image: GalleryImage, space: GallerySpace, index: Int) -> some View {
        Button {
            Haptic.tap()
            viewer = ImageViewerPayload(
                items: space.images.map { ImageViewerItem(id: $0.id, url: $0.resolvedURL, caption: $0.caption) },
                startIndex: index
            )
        } label: {
            ZStack(alignment: .topLeading) {
                RemoteImage(url: image.resolvedURL, contentMode: .fill)
                    .aspectRatio(4 / 3, contentMode: .fill)
                    .clipShape(RoundedRectangle(cornerRadius: NeonRadius.xs, style: .continuous))
                if image.isBeforeAfter {
                    BadgeView(text: L("Before/After"), tone: .neutral)
                        .padding(4)
                }
                if !image.hotspots.isEmpty {
                    HStack(spacing: 2) {
                        Image(systemName: "mappin.circle.fill").font(.system(size: 10))
                        Text("\(image.hotspots.count)").font(.system(size: 10, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 5).padding(.vertical, 2)
                    .background(Color.neonInk.opacity(0.7), in: Capsule())
                    .padding(4)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                }
            }
        }
        .buttonStyle(.pressable)
        .contextMenu {
            Button { hotspotTarget = HotspotTarget(image: image) } label: {
                Label(image.hotspots.isEmpty ? L("Add Hotspots") : L("Edit Hotspots (%d)", image.hotspots.count), systemImage: "mappin.and.ellipse")
            }
            Button { Task { await setCover(image) } } label: {
                Label(L("Set as Cover"), systemImage: "photo")
            }
            Button(role: .destructive) { imageToDelete = image } label: {
                Label(L("Delete"), systemImage: "trash")
            }
        }
    }

    private func deleteImage(_ image: GalleryImage) async {
        do {
            try await api.deleteGalleryImage(projectId: projectId, imageId: image.id)
            Haptic.success()
            onChanged()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func deleteSpace(_ space: GallerySpace) async {
        do {
            try await api.deleteGallerySpace(projectId: projectId, spaceId: space.id)
            Haptic.success()
            onChanged()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func setCover(_ image: GalleryImage) async {
        do {
            try await api.setProjectCover(projectId: projectId, imageUrl: image.imageUrl)
            Haptic.success()
            Toast.success(L("Cover updated"))
            onChanged()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

private struct AddSpaceSheet: View {
    let projectId: String
    let onCreated: () -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var attempts = 0

    var body: some View {
        SheetScaffold(L("Add a space"), symbol: "plus.rectangle.on.folder", primaryTitle: L("Add Space"), isPrimaryEnabled: !name.trimmingCharacters(in: .whitespaces).isEmpty) {
            do {
                try await api.createGallerySpace(projectId: projectId, name: name.trimmingCharacters(in: .whitespaces))
                Haptic.success()
                dismiss()
                onCreated()
            } catch {
                attempts += 1
                Haptic.error()
                Toast.error(error)
            }
        } content: {
            FormSection {
                NeonTextField(L("Name"), text: $name, prompt: L("Living Room"), symbol: "door.left.hand.open", isRequired: true)
            }
        }
        .neonSheet([.medium])
        .shake(attempts)
    }
}
