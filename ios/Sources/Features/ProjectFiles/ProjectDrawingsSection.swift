import SwiftUI

// Drawings by category and sub-category, with revision history — the web's
// drawings tab (src/app/admin/(dashboard)/projects/[id]/drawings/page.tsx +
// components/admin/drawing-row.tsx), both sides.

struct ProjectDrawingsSection: View {
    let projectId: String

    @EnvironmentObject private var api: APIClient
    @Environment(\.openURL) private var openURL
    @State private var drawings: [PFDrawing]?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var showAdd = false
    @State private var categoryFilter = ""
    @State private var expanded: Set<String> = []
    @State private var revisionFor: PFDrawing?
    @State private var toDelete: PFDrawing?
    @State private var revisionToDelete: PFRevisionTarget?

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.lg) {
            pfSectionHeader(
                L("Drawings"), subtitle: headerSubtitle, section: .drawings,
                addTitle: L("Add Drawing"), showAdd: !(drawings?.isEmpty ?? true)
            ) { showAdd = true }

            LoadStateView(value: drawings, error: errorMessage, cachedAt: cachedAt, retry: load) { items in
                if items.isEmpty {
                    EmptyState(
                        symbol: PFSection.drawings.symbol,
                        title: L("No drawings yet"),
                        detail: L("Upload the first technical drawing."),
                        actionTitle: L("Add Drawing"),
                        action: { showAdd = true },
                        hue: PFSection.drawings.hue,
                        card: true
                    )
                } else {
                    let categories = presentCategories(items)
                    if categories.count > 1 {
                        FilterChips(
                            selection: $categoryFilter,
                            options: [""] + categories,
                            title: { $0.isEmpty ? L("All") : L($0) },
                            count: { cat in cat.isEmpty ? nil : items.filter { $0.category == cat }.count }
                        )
                    }

                    let shown = categoryFilter.isEmpty ? items : items.filter { $0.category == categoryFilter }
                    let shownCategories = categoryFilter.isEmpty ? categories : [categoryFilter]
                    ForEach(shownCategories, id: \.self) { category in
                        let rows = shown.filter { $0.category == category }
                        VStack(alignment: .leading, spacing: NeonSpace.sm) {
                            SectionLabel(L(category))
                            VStack(spacing: NeonSpace.stack) {
                                ForEach(rows) { drawing in
                                    drawingCard(drawing)
                                        .staggered(shown.firstIndex(where: { $0.id == drawing.id }) ?? 0)
                                }
                            }
                        }
                    }
                }
            }
        }
        .task { await load() }
        .sheet(isPresented: $showAdd) {
            AddDrawingSheet(projectId: projectId) { Haptic.success(); Toast.success(L("Drawing added")); Task { await load() } }
        }
        .sheet(item: $revisionFor) { drawing in
            AddRevisionSheet(projectId: projectId, drawing: drawing) {
                Haptic.success(); Toast.success(L("Revision uploaded")); Task { await load() }
            }
        }
        .confirmDestructive(
            item: $toDelete,
            title: { L("Delete “%@”?", $0.name) },
            message: { _ in L("This removes every revision on file too.") },
            actionTitle: L("Delete")
        ) { drawing in Task { await delete(drawing) } }
        .confirmDestructive(
            item: $revisionToDelete,
            title: { L("Remove revision %@?", $0.label) },
            actionTitle: L("Remove")
        ) { target in Task { await deleteRevision(target) } }
    }

    private var headerSubtitle: String {
        guard let drawings, !drawings.isEmpty else { return L("Technical drawings and revisions") }
        let revised = drawings.filter { !$0.revisions.isEmpty }.count
        return L("%d drawings · %d revised", drawings.count, revised)
    }

    /// Categories in the order they first appear, deduplicated — used both
    /// to group the list and to build the (optional) filter row.
    private func presentCategories(_ items: [PFDrawing]) -> [String] {
        var seen: [String] = []
        for item in items where !seen.contains(item.category) { seen.append(item.category) }
        return seen
    }

    // MARK: Rows

    private var imageFileTypes: Set<String> { ["jpg", "jpeg", "png", "heic"] }

    private func drawingCard(_ drawing: PFDrawing) -> some View {
        let subtitle = [drawing.subCategory, drawing.revision, drawing.fileType.uppercased()]
            .compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · ")
        let leading: RowLeading = imageFileTypes.contains(drawing.fileType.lowercased())
            ? .thumbnail(url: resolvedMediaURL(drawing.fileUrl))
            : .icon(PFSection.drawings.symbol, tint: PFSection.drawings.hue.deep)

        return VStack(alignment: .leading, spacing: 0) {
            ListRow(drawing.name, subtitle: subtitle, meta: drawing.drawingNumber, leading: leading) {
                Menu {
                    if let url = resolvedMediaURL(drawing.fileUrl) {
                        Button { openURL(url) } label: { Label(L("Open file"), systemImage: "arrow.up.forward.square") }
                    }
                    Button {
                        Haptic.tap()
                        withNeonAnimation(.snappy) { toggle(drawing.id) }
                    } label: {
                        Label(
                            drawing.revisions.isEmpty ? L("Revision history") : L("Revision history (%d)", drawing.revisions.count),
                            systemImage: "clock.arrow.circlepath"
                        )
                    }
                    Button { revisionFor = drawing } label: { Label(L("Upload new revision"), systemImage: "arrow.up.doc") }
                    Button(role: .destructive) { toDelete = drawing } label: { Label(L("Delete"), systemImage: "trash") }
                } label: {
                    IconButtonLabel("ellipsis")
                }
                .accessibilityLabel(Text(L("More")))
            }
            .rowCard()
            .dynamicTypeSize(...(.xxLarge))

            if expanded.contains(drawing.id) {
                DetailCard(title: L("Revision history"), symbol: "clock.arrow.circlepath", tint: PFSection.drawings.hue.deep) {
                    if drawing.revisions.isEmpty {
                        Text(L("No earlier revisions."))
                            .font(.neonSubtitle)
                            .foregroundStyle(Color.neonTextTertiary)
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(drawing.revisions) { revision in
                                HStack(spacing: 10) {
                                    BadgeView(text: revision.revision, tone: .neutral)
                                    DirText(revision.note ?? "—", font: .neonSubtitle, color: .neonTextSecondary, fill: false, lineLimit: 2)
                                    Spacer(minLength: 4)
                                    Text(formattedISODate(revision.createdAt) ?? "")
                                        .font(.neonMeta).foregroundStyle(Color.neonTextFaint)
                                    if let url = resolvedMediaURL(revision.fileUrl) {
                                        Button { openURL(url) } label: { Image(systemName: "eye") }
                                            .font(.system(size: 12))
                                            .accessibilityLabel(Text(L("View")))
                                    }
                                    Button {
                                        revisionToDelete = PFRevisionTarget(id: revision.id, label: revision.revision)
                                    } label: {
                                        Image(systemName: "xmark.circle").font(.system(size: 12)).foregroundStyle(Color.neonDangerStrong)
                                    }
                                    .accessibilityLabel(Text(L("Remove")))
                                }
                            }
                        }
                    }
                    NeonButton(L("Upload New Revision"), symbol: "arrow.up.doc", kind: .tinted(PFSection.drawings.hue.deep), size: .small) {
                        revisionFor = drawing
                    }
                    .padding(.top, 4)
                }
                .padding(.top, NeonSpace.sm)
                .transition(.neonSlideUp)
            }
        }
    }

    private func toggle(_ id: String) {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
    }

    // MARK: Networking

    private func load() async {
        do {
            let loaded = try await api.fetchDrawings(projectId: projectId)
            drawings = loaded.value.drawings
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func delete(_ drawing: PFDrawing) async {
        do {
            try await api.deleteDrawing(projectId: projectId, id: drawing.id)
            Haptic.success()
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func deleteRevision(_ target: PFRevisionTarget) async {
        do {
            try await api.deleteRevision(projectId: projectId, id: target.id)
            Haptic.success()
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

struct PFRevisionTarget: Identifiable {
    let id: String
    let label: String
}

// MARK: - Add drawing

struct AddDrawingSheet: View {
    let projectId: String
    let onSaved: () -> Void

    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var category = PFCategories.drawing.first!
    @State private var subCategory = ""
    @State private var name = ""
    @State private var drawingNumber = ""
    @State private var revision = "R00"
    @State private var file: UploadFile?
    @State private var error: String?

    private var isValid: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty && file != nil }

    var body: some View {
        SheetScaffold(L("Add Drawing"), symbol: PFSection.drawings.symbol, primaryTitle: L("Add Drawing"), isPrimaryEnabled: isValid) {
            await save()
        } content: {
            FormSection {
                MenuField(L("Category"), selection: $category, options: PFCategories.drawing, title: { L($0) })
                NeonTextField(L("Sub-category"), text: $subCategory, prompt: L("Floor Plans"))
                NeonTextField(L("Drawing name"), text: $name, prompt: L("Ground Floor Plan"), isRequired: true)
                NeonTextField(L("Drawing number"), text: $drawingNumber, prompt: L("A-101"))
                NeonTextField(L("Revision"), text: $revision, isRequired: true)
                FilePickerField(label: L("File (PDF, DWG, image…)"), file: $file)
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.large])
    }

    private func save() async {
        guard let file else { return }
        do {
            try await api.createDrawing(
                projectId: projectId, category: category, subCategory: subCategory, name: name,
                drawingNumber: drawingNumber, revision: revision, file: file
            )
            dismiss()
            onSaved()
        } catch {
            self.error = error.localizedDescription
            Toast.error(error)
        }
    }
}

struct AddRevisionSheet: View {
    let projectId: String
    let drawing: PFDrawing
    let onSaved: () -> Void

    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var revision: String
    @State private var note = ""
    @State private var file: UploadFile?
    @State private var error: String?

    // Prefilled from the drawing on file ("R00" → "R01") rather than a
    // hard-coded "R03" that would invent a jump ahead of what the drawing is
    // actually on.
    init(projectId: String, drawing: PFDrawing, onSaved: @escaping () -> Void) {
        self.projectId = projectId
        self.drawing = drawing
        self.onSaved = onSaved
        _revision = State(initialValue: nextRevisionLabel(after: drawing.revision))
    }

    private var isValid: Bool { !revision.trimmingCharacters(in: .whitespaces).isEmpty && file != nil }

    var body: some View {
        SheetScaffold(
            L("New Revision"), subtitle: drawing.name, symbol: "arrow.up.doc",
            primaryTitle: L("Upload Revision"), isPrimaryEnabled: isValid
        ) {
            await save()
        } content: {
            FormSection(footer: L("The current file moves into revision history.")) {
                NeonTextField(L("New revision label"), text: $revision, isRequired: true, hint: L("Now on %@", drawing.revision))
                NeonTextField(L("What changed"), text: $note, prompt: L("e.g. Kitchen island moved 40 cm"))
                FilePickerField(label: L("New file"), file: $file)
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.medium, .large])
    }

    private func save() async {
        guard let file else { return }
        do {
            try await api.addDrawingRevision(projectId: projectId, drawingId: drawing.id, revision: revision, note: note, file: file)
            dismiss()
            onSaved()
        } catch {
            self.error = error.localizedDescription
            Toast.error(error)
        }
    }
}
