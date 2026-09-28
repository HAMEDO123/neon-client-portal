import SwiftUI

// Documents by category and version — the web's documents tab
// (src/app/admin/(dashboard)/projects/[id]/documents/page.tsx).

struct ProjectDocumentsSection: View {
    let projectId: String

    @EnvironmentObject private var api: APIClient
    @State private var documents: [PFDocument]?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var showAdd = false
    @State private var toDelete: PFDocument?

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.lg) {
            SectionHeader(L("Documents"), count: documents?.count) {
                IconButton("plus", label: L("Add document")) { showAdd = true }
            }

            LoadStateView(value: documents, error: errorMessage, cachedAt: cachedAt, retry: load) { items in
                if items.isEmpty {
                    EmptyState(
                        symbol: "folder",
                        title: L("No documents yet"),
                        detail: L("Upload contracts, reports, or specifications."),
                        actionTitle: L("Add document")
                    ) { showAdd = true }
                } else {
                    CardList(items) { doc in
                        ListRow(
                            doc.title,
                            subtitle: [doc.version, doc.fileType.uppercased()].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · "),
                            meta: doc.fileSize.map { byteCount($0) },
                            leading: .icon("doc.richtext", tint: .neonPurpleStrong),
                            badge: doc.category,
                            badgeTone: .purple
                        ) {
                            HStack(spacing: 14) {
                                if let url = resolvedMediaURL(doc.fileUrl) {
                                    Link(destination: url) { Image(systemName: "arrow.up.forward.square") }
                                }
                                Button(role: .destructive) { toDelete = doc } label: {
                                    Image(systemName: "trash").foregroundStyle(.red)
                                }
                            }
                            .font(.system(size: 15))
                        }
                    }
                }
            }
        }
        .task { await load() }
        .sheet(isPresented: $showAdd) {
            AddDocumentSheet(projectId: projectId) { Haptic.success(); Toast.success(L("Document added")); Task { await load() } }
        }
        .confirmDestructive(item: $toDelete, title: { L("Delete “%@”?", $0.title) }, actionTitle: L("Delete")) { doc in
            Task { await delete(doc) }
        }
    }

    private func load() async {
        do {
            let loaded = try await api.fetchDocuments(projectId: projectId)
            documents = loaded.value.documents
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func delete(_ doc: PFDocument) async {
        do {
            try await api.deleteDocument(projectId: projectId, id: doc.id)
            Haptic.success()
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

private struct AddDocumentSheet: View {
    let projectId: String
    let onSaved: () -> Void

    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var category = PFCategories.document.first { $0 == "Specifications" } ?? PFCategories.document.first!
    @State private var title = ""
    @State private var version = ""
    @State private var file: UploadFile?
    @State private var error: String?

    private var isValid: Bool { !title.trimmingCharacters(in: .whitespaces).isEmpty && file != nil }

    var body: some View {
        SheetScaffold(L("Add document"), symbol: "folder.badge.plus", primaryTitle: L("Add Document"), isPrimaryEnabled: isValid) {
            await save()
        } content: {
            FormSection {
                MenuField(L("Category"), selection: $category, options: PFCategories.document, title: { $0 })
                NeonTextField(L("Title"), text: $title, prompt: "Design Contract", isRequired: true)
                NeonTextField(L("Version"), text: $version, prompt: "v1")
                FilePickerField(label: L("File"), file: $file)
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.medium, .large])
    }

    private func save() async {
        guard let file else { return }
        do {
            try await api.createDocument(projectId: projectId, category: category, title: title, version: version, file: file)
            dismiss()
            onSaved()
        } catch {
            self.error = error.localizedDescription
            Toast.error(error)
        }
    }
}
