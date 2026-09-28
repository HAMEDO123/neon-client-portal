import SwiftUI

/// Placing and managing hotspots on one gallery image — tap the photo to
/// place one, same as the website's click-to-place editor.
struct HotspotEditorView: View {
    let projectId: String
    let image: GalleryImage
    let onChanged: () -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var hotspots: [ProjectHotspot]
    @State private var pending: CGPoint?
    @State private var label = ""
    @State private var category = ProjectConstants.hotspotCategories[4]
    @State private var linkLabel = ""
    @State private var description = ""
    @State private var isSaving = false
    @State private var toDelete: ProjectHotspot?

    init(projectId: String, image: GalleryImage, onChanged: @escaping () -> Void) {
        self.projectId = projectId
        self.image = image
        self.onChanged = onChanged
        _hotspots = State(initialValue: image.hotspots)
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(L("Hotspots"), subtitle: L("Tap the photo to place one"), symbol: "mappin.and.ellipse") { dismiss() }

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    GeometryReader { geo in
                        ZStack(alignment: .topLeading) {
                            RemoteImage(url: image.resolvedURL, contentMode: .fill)
                                .frame(width: geo.size.width, height: geo.size.width * 0.72)
                                .clipShape(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))
                                .contentShape(Rectangle())
                                .gesture(
                                    SpatialTapGesture().onEnded { event in
                                        Haptic.selection()
                                        let width = geo.size.width
                                        let height = width * 0.72
                                        pending = CGPoint(
                                            x: min(max(event.location.x / width, 0), 1),
                                            y: min(max(event.location.y / height, 0), 1)
                                        )
                                    }
                                )

                            ForEach(Array(hotspots.enumerated()), id: \.element.id) { index, spot in
                                pin(number: index + 1)
                                    .position(
                                        x: geo.size.width * CGFloat(spot.xPercent / 100),
                                        y: geo.size.width * 0.72 * CGFloat(spot.yPercent / 100)
                                    )
                            }

                            if let pending {
                                Circle()
                                    .strokeBorder(Color.neonPinkStrong, style: StrokeStyle(lineWidth: 2, dash: [4, 3]))
                                    .frame(width: 22, height: 22)
                                    .position(x: geo.size.width * pending.x, y: geo.size.width * 0.72 * pending.y)
                            }
                        }
                    }
                    .frame(height: UIScreen.main.bounds.width * 0.72 - 32)

                    if let pending {
                        addForm(at: pending)
                    }

                    if !hotspots.isEmpty {
                        VStack(spacing: 0) {
                            ForEach(Array(hotspots.enumerated()), id: \.element.id) { index, spot in
                                if index > 0 { NeonDivider() }
                                HStack(spacing: 10) {
                                    pin(number: index + 1)
                                    VStack(alignment: .leading, spacing: 2) {
                                        DirText(spot.label, font: .neonCallout)
                                        if let category = spot.category {
                                            Text(category).font(.neonCaption).foregroundStyle(Color.neonTextTertiary)
                                        }
                                    }
                                    Spacer()
                                    Button {
                                        toDelete = spot
                                    } label: {
                                        Image(systemName: "trash").foregroundStyle(Color.neonDangerStrong)
                                    }
                                }
                                .padding(.vertical, 8)
                            }
                        }
                        .padding(12)
                        .neonSurface(.glass, radius: NeonRadius.md)
                    }
                }
                .padding(16)
            }
        }
        .neonSheet([.large])
        .confirmDestructive(
            item: $toDelete,
            title: { L("Remove “%@”?", $0.label) },
            actionTitle: L("Remove")
        ) { spot in Task { await delete(spot) } }
    }

    @ViewBuilder
    private func pin(number: Int) -> some View {
        Text("\(number)")
            .font(.system(size: 11, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: 22, height: 22)
            .background(Color.neonCyanStrong, in: Circle())
            .shadow(color: .black.opacity(0.25), radius: 3, y: 1)
    }

    @ViewBuilder
    private func addForm(at point: CGPoint) -> some View {
        FormSection(L("New Hotspot")) {
            NeonTextField(L("Label"), text: $label, prompt: L("Sofa"), isRequired: true)
            MenuField(L("Category"), selection: $category, options: ProjectConstants.hotspotCategories, title: { $0 })
            NeonTextField(L("Reference (material or furniture name)"), text: $linkLabel)
            NeonTextField(L("Description"), text: $description)
            HStack(spacing: 10) {
                NeonButton(L("Add Hotspot"), kind: .primary, size: .small) {
                    await add(at: point)
                }
                .disabled(label.trimmingCharacters(in: .whitespaces).isEmpty)
                NeonButton(L("Cancel"), kind: .ghost, size: .small) {
                    self.pending = nil
                    label = ""; linkLabel = ""; description = ""
                }
            }
        }
        .neonSurface(.glass, radius: NeonRadius.md)
    }

    private func add(at point: CGPoint) async {
        do {
            try await api.createHotspot(
                projectId: projectId, imageId: image.id,
                xPercent: point.x * 100, yPercent: point.y * 100,
                label: label.trimmingCharacters(in: .whitespaces),
                category: category, linkLabel: linkLabel.isEmpty ? nil : linkLabel,
                description: description.isEmpty ? nil : description
            )
            Haptic.success()
            hotspots.append(ProjectHotspot(id: UUID().uuidString, xPercent: point.x * 100, yPercent: point.y * 100, label: label, description: description.isEmpty ? nil : description, category: category, linkLabel: linkLabel.isEmpty ? nil : linkLabel, order: hotspots.count))
            pending = nil
            label = ""; linkLabel = ""; description = ""
            onChanged()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func delete(_ spot: ProjectHotspot) async {
        do {
            try await api.deleteHotspot(projectId: projectId, hotspotId: spot.id)
            Haptic.success()
            hotspots.removeAll { $0.id == spot.id }
            onChanged()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}
