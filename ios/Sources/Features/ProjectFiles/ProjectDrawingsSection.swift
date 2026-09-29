import SwiftUI

// Drawings by category and sub-category, with revision history — the web's
// drawings tab (src/app/admin/(dashboard)/projects/[id]/drawings/page.tsx +
// components/admin/drawing-row.tsx), both sides.

struct ProjectDrawingsSection: View {
    let projectId: String

    @EnvironmentObject private var api: APIClient
    @State private var drawings: [PFDrawing]?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var showAdd = false
    @State private var expanded: Set<String> = []
    @State private var revisionFor: PFDrawing?
    @State private var toDelete: PFDrawing?
    @State private var revisionToDelete: PFRevisionTarget?

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.lg) {
            SectionHeader(L("Drawings"), count: drawings?.count) {
                IconButton("plus", label: L("Add drawing")) { showAdd = true }
            }

            LoadStateView(value: drawings, error: errorMessage, cachedAt: cachedAt, retry: load) { items in
                if items.isEmpty {
                    EmptyState(
                        symbol: "square.on.square.dashed",
                        title: L("No drawings yet"),
                        detail: L("Upload the first technical drawing."),
                        actionTitle: L("Add drawing"),
                        action: { showAdd = true },
                        hue: .cyan,
                        card: true
                    )
                } else {
                    VStack(spacing: 10) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { index, drawing in
                            drawingCard(drawing)
                                .staggered(index)
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

    // MARK: Rows

    private func drawingCard(_ drawing: PFDrawing) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ListRow(
                drawing.name,
                subtitle: [drawing.subCategory, drawing.revision, drawing.fileType.uppercased()].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · "),
                meta: drawing.drawingNumber,
                leading: .icon("square.on.square", tint: .neonCyanStrong),
                badge: drawing.category,
                badgeTone: .cyan
            ) {
                HStack(spacing: 14) {
                    if let url = resolvedMediaURL(drawing.fileUrl) {
                        Link(destination: url) { Image(systemName: "arrow.up.forward.square") }
                    }
                    Button {
                        Haptic.tap()
                        withNeonAnimation(.snappy) { toggle(drawing.id) }
                    } label: {
                        HStack(spacing: 3) {
                            if !drawing.revisions.isEmpty { Text("\(drawing.revisions.count)").font(.system(size: 12, weight: .semibold)) }
                            Image(systemName: "clock.arrow.circlepath")
                        }
                    }
                    Button(role: .destructive) { toDelete = drawing } label: { Image(systemName: "trash").foregroundStyle(.red) }
                }
                .font(.system(size: 15))
                .foregroundStyle(Color.neonTextSecondary)
            }
            .padding(.horizontal, 4)

            if expanded.contains(drawing.id) {
                VStack(alignment: .leading, spacing: 8) {
                    if drawing.revisions.isEmpty {
                        Text(L("No earlier revisions."))
                            .font(.system(size: 12))
                            .foregroundStyle(Color.neonTextTertiary)
                    } else {
                        ForEach(drawing.revisions) { revision in
                            HStack(spacing: 10) {
                                BadgeView(text: revision.revision, tone: .neutral)
                                DirText(revision.note ?? "—", font: .system(size: 12.5), color: .neonTextSecondary, fill: false, lineLimit: 2)
                                Spacer(minLength: 4)
                                Text(formattedISODate(revision.createdAt) ?? "")
                                    .font(.system(size: 11)).foregroundStyle(Color.neonTextFaint)
                                if let url = resolvedMediaURL(revision.fileUrl) {
                                    Link(destination: url) { Image(systemName: "eye") }.font(.system(size: 12))
                                }
                                Button(role: .destructive) {
                                    revisionToDelete = PFRevisionTarget(id: revision.id, label: revision.revision)
                                } label: {
                                    Image(systemName: "xmark.circle").font(.system(size: 12)).foregroundStyle(.red)
                                }
                            }
                        }
                    }
                    NeonButton(L("Upload new revision"), symbol: "arrow.up.doc", kind: .tinted(.neonCyanStrong), size: .small) {
                        revisionFor = drawing
                    }
                }
                .padding(12)
                .neonSurface(.sunken, radius: 14)
                .padding(.top, 8)
                .transition(.neonSlideUp)
            }
        }
        .padding(10)
        .neonSurface(.glass, radius: NeonRadius.lg)
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
        SheetScaffold(L("Add drawing"), symbol: "square.on.square", primaryTitle: L("Add Drawing"), isPrimaryEnabled: isValid) {
            await save()
        } content: {
            FormSection {
                MenuField(L("Category"), selection: $category, options: PFCategories.drawing, title: { $0 })
                NeonTextField(L("Sub-category"), text: $subCategory, prompt: "Floor Plans")
                NeonTextField(L("Drawing name"), text: $name, prompt: "Ground Floor Plan", isRequired: true)
                NeonTextField(L("Drawing number"), text: $drawingNumber, prompt: "A-101")
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

    @State private var revision = ""
    @State private var note = ""
    @State private var file: UploadFile?
    @State private var error: String?

    private var isValid: Bool { !revision.trimmingCharacters(in: .whitespaces).isEmpty && file != nil }

    var body: some View {
        SheetScaffold(
            L("New revision"), subtitle: drawing.name, symbol: "arrow.up.doc",
            primaryTitle: L("Upload Revision"), isPrimaryEnabled: isValid
        ) {
            await save()
        } content: {
            FormSection(footer: L("The current file moves into revision history.")) {
                NeonTextField(L("New revision label"), text: $revision, prompt: "R03", isRequired: true)
                NeonTextField(L("What changed"), text: $note)
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
