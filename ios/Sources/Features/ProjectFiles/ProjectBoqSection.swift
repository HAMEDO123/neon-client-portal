import SwiftUI

// The Bill of Quantities — the web's boq tab
// (src/app/admin/(dashboard)/projects/[id]/boq/page.tsx). No total row here:
// the web admin doesn't show one either (only the client page does, gated by
// showBoqQuantities/showBoqPrices).

struct ProjectBoqSection: View {
    let projectId: String

    @EnvironmentObject private var api: APIClient
    @State private var items: [PFBoqItem]?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var showAdd = false
    @State private var toDelete: PFBoqItem?

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.lg) {
            SectionHeader(L("BOQ"), count: items?.count) {
                IconButton("plus", label: L("Add item")) { showAdd = true }
            }

            LoadStateView(value: items, error: errorMessage, cachedAt: cachedAt, retry: load) { rows in
                if rows.isEmpty {
                    EmptyState(
                        symbol: "list.bullet.rectangle",
                        title: L("No BOQ items yet"),
                        detail: L("Add quantities and specifications."),
                        actionTitle: L("Add item")
                    ) { showAdd = true }
                } else {
                    CardList(rows) { item in
                        ListRow(
                            item.name,
                            subtitle: [item.specification, item.relatedSpace].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · "),
                            meta: L("%@ %@", NeonFormat.number(item.quantity, decimals: item.quantity.truncatingRemainder(dividingBy: 1) == 0 ? 0 : 2), item.unit),
                            leading: item.imageUrl != nil ? .thumbnail(url: resolvedMediaURL(item.imageUrl)) : .icon("list.bullet.rectangle", tint: .neonOrangeStrong),
                            value: item.unitPrice.map { NeonFormat.money($0) },
                            badge: item.category,
                            badgeTone: .orange
                        ) {
                            Button(role: .destructive) { toDelete = item } label: { Image(systemName: "trash").foregroundStyle(.red) }
                        }
                    }
                }
            }
        }
        .task { await load() }
        .sheet(isPresented: $showAdd) {
            AddBoqSheet(projectId: projectId) { Haptic.success(); Toast.success(L("Item added")); Task { await load() } }
        }
        .confirmDestructive(item: $toDelete, title: { L("Delete “%@”?", $0.name) }, actionTitle: L("Delete")) { item in
            Task { await delete(item) }
        }
    }

    private func load() async {
        do {
            let loaded = try await api.fetchBoq(projectId: projectId)
            items = loaded.value.items
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func delete(_ item: PFBoqItem) async {
        do {
            try await api.deleteBoqItem(projectId: projectId, id: item.id)
            Haptic.success()
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

private struct AddBoqSheet: View {
    let projectId: String
    let onSaved: () -> Void

    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var category = PFCategories.boq.first!
    @State private var name = ""
    @State private var unit = ""
    @State private var quantity: Double?
    @State private var unitPrice: Double?
    @State private var relatedDrawing = ""
    @State private var relatedSpace = ""
    @State private var specification = ""
    @State private var imageFile: UploadFile?
    @State private var imagePreview: Data?
    @State private var error: String?

    private var isValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && !unit.trimmingCharacters(in: .whitespaces).isEmpty && (quantity ?? 0) > 0
    }

    var body: some View {
        SheetScaffold(L("Add BOQ item"), symbol: "list.bullet.rectangle", primaryTitle: L("Add Item"), isPrimaryEnabled: isValid) {
            await save()
        } content: {
            FormSection {
                MenuField(L("Category"), selection: $category, options: PFCategories.boq, title: { $0 })
                NeonTextField(L("Item name"), text: $name, prompt: "Porcelain Flooring", isRequired: true)
                HStack(spacing: 12) {
                    NumberField(L("Quantity"), value: $quantity, decimals: 2, isRequired: true)
                    NeonTextField(L("Unit"), text: $unit, prompt: "m²", isRequired: true)
                }
                MoneyField(L("Unit price (optional)"), amount: $unitPrice)
                NeonTextField(L("Related drawing"), text: $relatedDrawing, prompt: "A-102")
                NeonTextField(L("Related space"), text: $relatedSpace, prompt: "Living Room")
                NeonTextEditor(L("Specification"), text: $specification, minLines: 2, maxLines: 5)
                ImagePickerField(label: L("Reference image (optional)"), file: $imageFile, previewData: $imagePreview)
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.large])
    }

    private func save() async {
        do {
            try await api.createBoqItem(
                projectId: projectId, category: category, name: name, description: "",
                specification: specification, unit: unit, quantity: quantity ?? 0, unitPrice: unitPrice,
                relatedDrawing: relatedDrawing, relatedSpace: relatedSpace, notes: "", image: imageFile
            )
            dismiss()
            onSaved()
        } catch {
            self.error = error.localizedDescription
            Toast.error(error)
        }
    }
}
