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
    @State private var photo: UIImage?
    @State private var photoFailed = false
    @State private var pending: CGPoint?
    @State private var label = ""
    @State private var category = ProjectConstants.hotspotCategories[4]
    @State private var linkLabel = ""
    @State private var description = ""
    @State private var toDelete: ProjectHotspot?
    @State private var highlighted: String?
    @State private var revealPhoto = 0

    init(projectId: String, image: GalleryImage, onChanged: @escaping () -> Void) {
        self.projectId = projectId
        self.image = image
        self.onChanged = onChanged
        _hotspots = State(initialValue: image.hotspots)
    }

    /// The photo's own shape. Placing on a cropped picture would put every
    /// point somewhere other than where the client sees it, so the photo is
    /// shown whole, at its real proportions, once they are known.
    private var aspect: CGFloat {
        guard let photo, photo.size.height > 0 else { return 4 / 3 }
        return photo.size.width / photo.size.height
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(
                L("Hotspots"),
                subtitle: pending == nil ? L("Tap the photo to place one") : L("Name the new point below"),
                symbol: "mappin.and.ellipse"
            ) { dismiss() }

            GeometryReader { outer in
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: NeonSpace.lg) {
                            canvas(available: outer.size.width - NeonSpace.gutter * 2)
                                .id("photo")

                            if let pending {
                                addForm(at: pending)
                                    .id("form")
                                    .transition(.neonRise)
                            }

                            placedList
                                .id("list")
                        }
                        .padding(.horizontal, NeonSpace.gutter)
                        .padding(.bottom, NeonSpace.xxl)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onChange(of: pending) { point in
                        guard point != nil else { return }
                        withNeonAnimation(NeonMotion.smooth) { proxy.scrollTo("form", anchor: .top) }
                    }
                    .onChange(of: revealPhoto) { _ in
                        // A row picked in the list: bring its pin into view.
                        withNeonAnimation(NeonMotion.smooth) { proxy.scrollTo("photo", anchor: .top) }
                    }
                    .debugScroll(proxy)
                }
            }
        }
        .background(NeonAmbient().ignoresSafeArea())
        .neonSheet([.large])
        .confirmDestructive(
            item: $toDelete,
            title: { L("Remove “%@”?", $0.label) },
            message: { _ in L("It comes off the client's page too.") },
            actionTitle: L("Remove")
        ) { spot in Task { await delete(spot) } }
        .task(id: image.id) { await loadPhoto() }
    }

    // MARK: - The photo

    /// The photo at its own proportions: as wide as the sheet allows, no
    /// taller than 460 points (a tall photo narrows rather than being cropped).
    private func canvas(available: CGFloat) -> some View {
        let height = min(max(available, 1) / aspect, 460)
        let size = CGSize(width: height * aspect, height: height)
        return ZStack(alignment: .topLeading) {
            Group {
                if let photo {
                    Image(uiImage: photo)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else {
                    RemoteImage(url: image.resolvedURL, contentMode: .fill)
                }
            }
            .frame(width: size.width, height: size.height)
            .clipShape(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))
            .contentShape(Rectangle())
            .gesture(
                SpatialTapGesture().onEnded { event in
                    guard photo != nil else { return }
                    Haptic.selection()
                    withNeonAnimation(NeonMotion.bouncy) {
                        pending = CGPoint(
                            x: min(max(event.location.x / size.width, 0), 1),
                            y: min(max(event.location.y / size.height, 0), 1)
                        )
                    }
                }
            )

            ForEach(Array(hotspots.enumerated()), id: \.element.id) { index, spot in
                // Drawn at 26, touched at 44: two pins close together can
                // still each be picked.
                ProjectHotspotPin(number: index + 1, category: spot.category, size: 26, highlighted: highlighted == spot.id)
                    .frame(width: NeonSize.touch, height: NeonSize.touch)
                    .contentShape(Circle())
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(spot.label))
                    .accessibilityAddTraits(.isButton)
                    .position(
                        x: size.width * CGFloat(spot.xPercent / 100),
                        y: size.height * CGFloat(spot.yPercent / 100)
                    )
                    .onTapGesture {
                        Haptic.selection()
                        withNeonAnimation(NeonMotion.snappy) { highlighted = highlighted == spot.id ? nil : spot.id }
                    }
                    .transition(.neonPop)
            }

            if let pending {
                PendingHotspotMarker(category: category)
                    .position(x: size.width * pending.x, y: size.height * pending.y)
                    .transition(.neonPop)
                    .allowsHitTesting(false)
            }
        }
        .frame(width: size.width, height: size.height)
        // Percentages run from the photo's left edge, as on the website,
        // whichever way the app reads.
        .environment(\.layoutDirection, .leftToRight)
        .frame(maxWidth: .infinity)
        .overlay {
            if photo == nil && !photoFailed {
                ProgressView()
                    .tint(NeonHue.purple.deep)
            }
        }
        .overlay(alignment: .bottom) {
            if photoFailed {
                StatusNote(
                    symbol: "exclamationmark.triangle.fill",
                    tone: .warning,
                    title: L("This photo couldn't be loaded, so points can't be placed on it right now.")
                )
                .padding(10)
            }
        }
        .neonShadow(.card)
        .animation(NeonMotion.resolved(NeonMotion.smooth), value: aspect)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(L("The photo — tap to place a hotspot")))
    }

    // MARK: - A new point

    @ViewBuilder
    private func addForm(at point: CGPoint) -> some View {
        let isValid = !label.trimmingCharacters(in: .whitespaces).isEmpty
        VStack(alignment: .leading, spacing: NeonSpace.md) {
            HStack(spacing: NeonSpace.sm) {
                IconTile("plus", hue: ProjectHotspotStyle.hue(category), size: 32, style: .filled)
                Text(L("New Hotspot"))
                    .font(.neonCardTitle)
                    .foregroundStyle(Color.neonInk)
                Spacer(minLength: 0)
            }

            NeonTextField(L("Label"), text: $label, prompt: L("Sofa"), symbol: "textformat", isRequired: true)

            VStack(alignment: .leading, spacing: NeonSpace.sm) {
                Text(L("Category"))
                    .font(.system(.subheadline, weight: .medium))
                    .foregroundStyle(Color.neonTextSecondary)
                FlowRow(spacing: NeonSpace.sm) {
                    ForEach(ProjectConstants.hotspotCategories, id: \.self) { option in
                        HotspotCategoryChip(category: option, isSelected: category == option) {
                            withNeonAnimation(NeonMotion.snappy) { category = option }
                        }
                    }
                }
            }

            NeonTextField(L("Reference (material or furniture name)"), text: $linkLabel, prompt: L("e.g. Oak veneer, Minotti sofa"), symbol: "link", hint: L("Optional"))
            NeonTextEditor(L("Description"), text: $description, minLines: 2, maxLines: 5)

            HStack(spacing: NeonSpace.sm) {
                NeonButton(L("Add Hotspot"), symbol: "mappin.and.ellipse", kind: .primary, size: .medium, fullWidth: true) {
                    await add(at: point)
                }
                .disabled(!isValid)
                NeonButton(L("Cancel"), kind: .secondary, size: .medium) {
                    withNeonAnimation(NeonMotion.smooth) { clearForm() }
                }
            }
        }
        .padding(NeonSpace.card)
        .neonSurface(.glass, radius: NeonRadius.lg)
    }

    // MARK: - The points already placed

    @ViewBuilder
    private var placedList: some View {
        SectionCard(
            L("On this photo"),
            subtitle: hotspots.isEmpty
                ? L("No hotspots on this photo yet.")
                : projectPlural(hotspots.count, one: "%d point the client can tap", other: "%d points the client can tap"),
            symbol: "mappin.circle.fill",
            hue: .cyan
        ) {
            if !hotspots.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(hotspots.enumerated()), id: \.element.id) { index, spot in
                        if index > 0 { NeonDivider().padding(.leading, 40) }
                        hotspotRow(spot, number: index + 1)
                    }
                }
            }
        }
    }

    /// A placed point: tap the row and it and its pin pulse together.
    private func hotspotRow(_ spot: ProjectHotspot, number: Int) -> some View {
        HStack(alignment: .top, spacing: NeonSpace.sm) {
            Button {
                Haptic.selection()
                let picking = highlighted != spot.id
                withNeonAnimation(NeonMotion.snappy) { highlighted = picking ? spot.id : nil }
                if picking { revealPhoto += 1 }
            } label: {
                HStack(alignment: .top, spacing: NeonSpace.md) {
                    ProjectHotspotPin(number: number, category: spot.category, size: 28, highlighted: highlighted == spot.id)
                    VStack(alignment: .leading, spacing: 4) {
                        DirText(spot.label, font: .neonRowTitle, fill: false, lineLimit: 2)
                        if let category = spot.category, !category.isEmpty {
                            HStack(spacing: 4) {
                                Image(systemName: ProjectHotspotStyle.symbol(category))
                                    .font(.system(.caption2, weight: .bold))
                                Text(ProjectHotspotStyle.label(category))
                            }
                            .font(.system(.caption, weight: .semibold))
                            .foregroundStyle(ProjectHotspotStyle.hue(category).deep)
                        }
                        if let reference = spot.linkLabel, !reference.isEmpty {
                            DirText(reference, font: .neonSubtitle, color: .neonTextSecondary, fill: false, lineLimit: 2)
                        }
                        if let detail = spot.description, !detail.isEmpty {
                            DirText(detail, font: .neonSubtitle, color: .neonTextTertiary, fill: false, lineLimit: 3)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .frame(minHeight: NeonSize.touch)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle(scale: 0.98))
            .accessibilityAddTraits(highlighted == spot.id ? .isSelected : [])
            .accessibilityHint(Text(L("Shows its pin on the photo")))

            IconButton("trash", label: L("Remove"), look: .tinted, tint: .neonDangerStrong, size: NeonSize.touch) {
                toDelete = spot
            }
        }
        .padding(.vertical, 8)
    }

    // MARK: - Work

    private func loadPhoto() async {
        guard let url = image.resolvedURL else {
            photoFailed = true
            return
        }
        let loaded = await ImagePipeline.shared.image(url, pixels: 1600)
        guard !Task.isCancelled else { return }
        withNeonAnimation(NeonMotion.gentle) {
            photo = loaded
            photoFailed = loaded == nil
        }
    }

    private func clearForm() {
        pending = nil
        label = ""
        linkLabel = ""
        description = ""
    }

    private func add(at point: CGPoint) async {
        let trimmed = label.trimmingCharacters(in: .whitespaces)
        do {
            try await api.createHotspot(
                projectId: projectId, imageId: image.id,
                xPercent: point.x * 100, yPercent: point.y * 100,
                label: trimmed,
                category: category, linkLabel: linkLabel.isEmpty ? nil : linkLabel,
                description: description.isEmpty ? nil : description
            )
            Haptic.success()
            // Shown at once; the page's reload after onChanged brings the server's own id.
            withNeonAnimation(NeonMotion.bouncy) {
                hotspots.append(ProjectHotspot(
                    id: UUID().uuidString, xPercent: point.x * 100, yPercent: point.y * 100, label: trimmed,
                    description: description.isEmpty ? nil : description, category: category,
                    linkLabel: linkLabel.isEmpty ? nil : linkLabel, order: hotspots.count
                ))
                clearForm()
            }
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
            withNeonAnimation(NeonMotion.smooth) { hotspots.removeAll { $0.id == spot.id } }
            onChanged()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

/// Where the new point will go: a pulsing ring in the chosen category's colour.
private struct PendingHotspotMarker: View {
    let category: String

    var body: some View {
        let hue = ProjectHotspotStyle.hue(category)
        ZStack {
            Circle()
                .fill(hue.color.opacity(0.3))
                .frame(width: 34, height: 34)
                .neonPulse()
            Circle()
                .strokeBorder(Color.white, style: StrokeStyle(lineWidth: 2.5, dash: [4, 3]))
                .background(Circle().fill(hue.color.opacity(0.85)))
                .frame(width: 24, height: 24)
            Image(systemName: "plus")
                .font(.system(size: 11, weight: .heavy))
                .foregroundStyle(.white)
        }
        .shadow(color: .black.opacity(0.3), radius: 4, x: 0, y: 2)
    }
}

/// One of the five categories, as a chip in its own colour.
private struct HotspotCategoryChip: View {
    let category: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        let hue = ProjectHotspotStyle.hue(category)
        Button {
            Haptic.selection()
            action()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: ProjectHotspotStyle.symbol(category))
                    .font(.system(.caption, weight: .bold))
                Text(ProjectHotspotStyle.label(category))
                    .lineLimit(1)
            }
            .font(.system(.subheadline, weight: isSelected ? .semibold : .medium))
            .foregroundStyle(isSelected ? Color.white : hue.deep)
            .padding(.horizontal, 13)
            .frame(minHeight: 36)
            .background {
                if isSelected {
                    Capsule().fill(hue.fill)
                        .shadow(color: hue.color.opacity(0.3), radius: 4, x: 0, y: 2)
                } else {
                    Capsule().fill(hue.wash)
                        .overlay(Capsule().strokeBorder(hue.color.opacity(0.2), lineWidth: 1))
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(PressableStyle(scale: 0.95))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
