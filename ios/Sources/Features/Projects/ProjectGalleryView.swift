import SwiftUI

/// Rooms and their renders — the Gallery tab. Spaces, multi-photo upload
/// (one request per photo, like the website), captions, before/after pairs,
/// cover, hotspots and the full-screen viewer.
struct ProjectGalleryView: View {
    let projectId: String
    let spaces: [GallerySpace]
    var coverImageUrl: String? = nil
    let onChanged: () -> Void

    @EnvironmentObject var api: APIClient
    @State private var showAddSpace = false
    @State private var uploadTarget: GallerySpace?
    @State private var viewer: ImageViewerPayload?
    @State private var hotspotTarget: HotspotTarget?
    @State private var imageToDelete: GalleryImage?
    @State private var deletingSpace: GallerySpace?
    /// What was asked for from inside the viewer, done once it has closed —
    /// a sheet or a dialog cannot be presented while the viewer is dismissing.
    @State private var afterViewer: ViewerIntent?

    struct HotspotTarget: Identifiable {
        let image: GalleryImage
        var id: String { image.id }
    }

    private enum ViewerIntent {
        case hotspots(GalleryImage)
        case cover(GalleryImage)
        case delete(GalleryImage)
    }

    private var photoCount: Int { spaces.reduce(0) { $0 + $1.images.count } }

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.stack) {
            summaryCard
                .id("gallery")

            if spaces.isEmpty {
                EmptyState(
                    symbol: "photo.on.rectangle.angled",
                    title: L("No spaces yet"),
                    detail: L("Add a space like “Living Room” or “Kitchen” to start uploading renders."),
                    actionTitle: L("Add a space"),
                    action: { showAddSpace = true },
                    hue: .purple,
                    card: true
                )
            } else {
                ForEach(Array(spaces.enumerated()), id: \.element.id) { index, space in
                    spaceCard(space)
                        .id("space-\(index)")
                        .staggered(index)
                }
            }
        }
        .sheet(isPresented: $showAddSpace) {
            ProjectAddSpaceSheet(projectId: projectId) { onChanged() }
        }
        .sheet(item: $uploadTarget) { space in
            AddPhotosSheet(projectId: projectId, space: space) { onChanged() }
        }
        .sheet(item: $hotspotTarget) { target in
            HotspotEditorView(projectId: projectId, image: target.image) { onChanged() }
        }
        .fullScreenCover(item: $viewer, onDismiss: runViewerIntent) { payload in
            ImageViewerView(payload: payload)
                .neonLanguage()
        }
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

    // MARK: - Summary

    private var summaryCard: some View {
        SectionCard(
            L("Gallery"),
            subtitle: spaces.isEmpty ? L("Renders and site photos, by space") : L("%d spaces · %d photos", spaces.count, photoCount),
            symbol: "photo.on.rectangle.angled",
            hue: .purple
        ) {
            EmptyView()
        } trailing: {
            ViewAllButton(L("Add a space"), hue: .purple, chevron: false) { showAddSpace = true }
        }
    }

    // MARK: - A space

    @ViewBuilder
    private func spaceCard(_ space: GallerySpace) -> some View {
        VStack(alignment: .leading, spacing: NeonSpace.md) {
            HStack(spacing: NeonSpace.sm) {
                IconTile("door.left.hand.open", hue: .purple, size: 32)
                DirText(space.name, font: .neonCardTitle, fill: false, lineLimit: 2)
                CountBadge(space.images.count, tone: .neutral)
                Spacer(minLength: 6)
                IconButton("camera.fill", label: L("Add Photos"), look: .tinted, tint: .neonPurpleStrong, size: 34) {
                    uploadTarget = space
                }
                Menu {
                    Button { uploadTarget = space } label: { Label(L("Add Photos"), systemImage: "photo.badge.plus") }
                    Button(role: .destructive) { deletingSpace = space } label: { Label(L("Remove Space"), systemImage: "trash") }
                } label: {
                    IconButtonLabel("ellipsis", look: .tinted, tint: .neonTextSecondary, size: 34)
                }
                .accessibilityLabel(Text(L("More")))
            }

            if space.images.isEmpty {
                addFirstPhotos(space)
            } else {
                mosaic(space)
            }
        }
        .padding(NeonSpace.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.glass, radius: NeonRadius.lg)
    }

    /// The first photo large, the rest three to a row, and a tile to add more.
    @ViewBuilder
    private func mosaic(_ space: GallerySpace) -> some View {
        let images = space.images
        VStack(spacing: 6) {
            if let first = images.first {
                tile(first, space: space, index: 0, large: true)
                    .aspectRatio(16 / 10, contentMode: .fit)
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                ForEach(Array(images.enumerated().dropFirst()), id: \.element.id) { index, image in
                    tile(image, space: space, index: index, large: false)
                        .aspectRatio(1, contentMode: .fit)
                }
                addTile(space)
                    .aspectRatio(1, contentMode: .fit)
            }
        }
    }

    @ViewBuilder
    private func tile(_ image: GalleryImage, space: GallerySpace, index: Int, large: Bool) -> some View {
        let radius = large ? NeonRadius.md : NeonRadius.sm
        Button {
            Haptic.tap()
            openViewer(space: space, at: index)
        } label: {
            Color.clear
                .overlay(RemoteImage(url: image.resolvedURL, contentMode: .fill))
                .overlay {
                    if large, let caption = image.caption, !caption.isEmpty {
                        LinearGradient(colors: [.clear, .clear, .black.opacity(0.55)], startPoint: .top, endPoint: .bottom)
                    }
                }
                .overlay(alignment: .bottomLeading) {
                    if large, let caption = image.caption, !caption.isEmpty {
                        DirText(caption, font: .system(.footnote, weight: .semibold), color: .white, lineLimit: 2)
                            .padding(.horizontal, 12)
                            .padding(.bottom, 10)
                            .padding(.trailing, 44)
                    }
                }
                .overlay(alignment: .topLeading) {
                    HStack(spacing: 4) {
                        if image.imageUrl == coverImageUrl {
                            ProjectPhotoBadge(text: large ? L("Cover") : "", symbol: "star.fill")
                                .accessibilityLabel(Text(L("Cover")))
                        }
                        if image.isBeforeAfter {
                            ProjectPhotoBadge(text: large ? L("Before/After") : "", symbol: "square.split.2x1.fill")
                                .accessibilityLabel(Text(L("Before/After")))
                        }
                    }
                    .padding(large ? 10 : 5)
                }
                .overlay(alignment: .bottomTrailing) {
                    if !image.hotspots.isEmpty {
                        ProjectPhotoBadge(text: NeonFormat.integer(image.hotspots.count), symbol: "mappin")
                            .padding(large ? 10 : 5)
                            .accessibilityLabel(Text(L("Hotspots: %d", image.hotspots.count)))
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        }
        .buttonStyle(PressableStyle(scale: large ? 0.985 : 0.95))
        .neonContextShape(radius: radius)
        .contextMenu {
            Button { hotspotTarget = HotspotTarget(image: image) } label: {
                Label(image.hotspots.isEmpty ? L("Add Hotspots") : L("Edit Hotspots (%d)", image.hotspots.count), systemImage: "mappin.and.ellipse")
            }
            if image.imageUrl != coverImageUrl {
                Button { Task { await setCover(image) } } label: {
                    Label(L("Set as Cover"), systemImage: "star")
                }
            }
            Button(role: .destructive) { imageToDelete = image } label: {
                Label(L("Delete"), systemImage: "trash")
            }
        }
        .accessibilityLabel(Text(image.caption?.isEmpty == false ? image.caption! : L("Photo %d of %d", index + 1, space.images.count)))
    }

    private func addTile(_ space: GallerySpace) -> some View {
        Button {
            Haptic.tap()
            uploadTarget = space
        } label: {
            let shape = RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous)
            VStack(spacing: 6) {
                Image(systemName: "plus")
                    .font(.system(.title3, weight: .semibold))
                Text(L("Add"))
                    .font(.system(.caption, weight: .semibold))
            }
            .foregroundStyle(NeonHue.purple.deep)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(shape.fill(NeonHue.purple.wash))
            .overlay(shape.strokeBorder(NeonHue.purple.color.opacity(0.35), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
            .contentShape(shape)
        }
        .buttonStyle(PressableStyle(scale: 0.95))
        .accessibilityLabel(Text(L("Add Photos")))
    }

    private func addFirstPhotos(_ space: GallerySpace) -> some View {
        Button {
            Haptic.tap()
            uploadTarget = space
        } label: {
            let shape = RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
            VStack(spacing: 10) {
                IconTile("camera.fill", hue: .purple, size: 48, style: .filled)
                    .neonFloat()
                Text(L("No photos in this space yet"))
                    .font(.neonCardTitle)
                    .foregroundStyle(Color.neonInk)
                Text(L("Take them on site or pick renders from the library."))
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.vertical, 24)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity)
            .background(shape.fill(NeonHue.purple.wash.opacity(0.7)))
            .overlay(shape.strokeBorder(NeonHue.purple.color.opacity(0.3), style: StrokeStyle(lineWidth: 1.5, dash: [6, 5])))
            .contentShape(shape)
        }
        .buttonStyle(.pressableCard)
    }

    // MARK: - The viewer

    private func openViewer(space: GallerySpace, at index: Int) {
        let byId = Dictionary(uniqueKeysWithValues: space.images.map { ($0.id, $0) })
        viewer = ImageViewerPayload(
            items: space.images.map { image in
                ImageViewerItem(
                    id: image.id,
                    url: image.resolvedURL,
                    caption: image.caption,
                    beforeURL: image.isBeforeAfter ? image.resolvedBeforeURL : nil,
                    hotspots: image.hotspots.map { ImageViewerHotspot(id: $0.id, x: $0.xPercent / 100, y: $0.yPercent / 100, label: $0.label, category: $0.category) }
                )
            },
            startIndex: index,
            title: space.name,
            actions: [
                ImageViewerAction(id: "hotspots", title: L("Hotspots"), symbol: "mappin.and.ellipse") { item in
                    if let image = byId[item.id] { afterViewer = .hotspots(image) }
                },
                ImageViewerAction(id: "cover", title: L("Set as Cover"), symbol: "star") { item in
                    if let image = byId[item.id] { afterViewer = .cover(image) }
                },
                ImageViewerAction(id: "delete", title: L("Delete"), symbol: "trash", isDestructive: true) { item in
                    if let image = byId[item.id] { afterViewer = .delete(image) }
                },
            ]
        )
    }

    private func runViewerIntent() {
        guard let intent = afterViewer else { return }
        afterViewer = nil
        switch intent {
        case .hotspots(let image): hotspotTarget = HotspotTarget(image: image)
        case .cover(let image): Task { await setCover(image) }
        case .delete(let image): imageToDelete = image
        }
    }

    // MARK: - Actions

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

/// Naming a new space (room) of the gallery, with the rooms a studio names
/// most often a tap away.
struct ProjectAddSpaceSheet: View {
    let projectId: String
    let onCreated: () -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var attempts = 0

    private var suggestions: [String] {
        [L("Living Room"), L("Kitchen"), L("Master Bedroom"), L("Bedroom"), L("Bathroom"), L("Dining Room"), L("Entrance"), L("Exterior")]
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        SheetScaffold(
            L("Add a space"),
            subtitle: L("A room or area the renders belong to"),
            symbol: "plus.rectangle.on.folder",
            primaryTitle: L("Add Space"),
            isPrimaryEnabled: !trimmed.isEmpty
        ) {
            do {
                try await api.createGallerySpace(projectId: projectId, name: trimmed)
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
            VStack(alignment: .leading, spacing: NeonSpace.sm) {
                SectionLabel(L("Suggestions"))
                    .padding(.horizontal, 4)
                FlowRow(spacing: NeonSpace.sm) {
                    ForEach(suggestions, id: \.self) { suggestion in
                        Chip(suggestion, isSelected: trimmed == suggestion) {
                            withNeonAnimation(NeonMotion.snappy) { name = suggestion }
                        }
                    }
                }
            }
        }
        .neonSheet([.medium, .large])
        .shake(attempts)
    }
}
