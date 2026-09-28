import SwiftUI

// The material and finish board — the web's materials tab
// (src/app/admin/(dashboard)/projects/[id]/materials/page.tsx).

struct ProjectMaterialsSection: View {
    let projectId: String

    @EnvironmentObject private var api: APIClient
    @State private var materials: [PFMaterial]?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var showAdd = false
    @State private var toDelete: PFMaterial?

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.lg) {
            SectionHeader(L("Materials"), count: materials?.count) {
                IconButton("plus", label: L("Add material")) { showAdd = true }
            }

            LoadStateView(value: materials, error: errorMessage, cachedAt: cachedAt, retry: load) { rows in
                if rows.isEmpty {
                    EmptyState(
                        symbol: "paintpalette",
                        title: L("No materials yet"),
                        detail: L("Build the material and finish board."),
                        actionTitle: L("Add material")
                    ) { showAdd = true }
                } else {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(rows) { material in
                            materialCard(material)
                                .contextMenu {
                                    Button(role: .destructive) { toDelete = material } label: {
                                        Label(L("Delete"), systemImage: "trash")
                                    }
                                }
                        }
                    }
                }
            }
        }
        .task { await load() }
        .sheet(isPresented: $showAdd) {
            AddMaterialSheet(projectId: projectId) { Haptic.success(); Toast.success(L("Material added")); Task { await load() } }
        }
        .confirmDestructive(item: $toDelete, title: { L("Delete “%@”?", $0.name) }, actionTitle: L("Delete")) { material in
            Task { await delete(material) }
        }
    }

    private func materialCard(_ material: PFMaterial) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            RemoteImage(url: resolvedMediaURL(material.imageUrl), placeholderSymbol: "paintpalette")
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                BadgeView(text: material.category, tone: .pink)
                DirText(material.name, font: .system(size: 14, weight: .semibold), color: .neonInk, fill: false, lineLimit: 1)
                if let brand = material.brand, !brand.isEmpty {
                    DirText(brand, font: .system(size: 12), color: .neonTextTertiary, fill: false, lineLimit: 1)
                }
                if let price = material.price {
                    Text(NeonFormat.money(price)).font(.system(size: 12.5, weight: .semibold, design: .rounded)).foregroundStyle(Color.neonSuccessStrong)
                }
            }
            .padding(10)
        }
        .neonSurface(.glass, radius: NeonRadius.lg)
    }

    private func load() async {
        do {
            let loaded = try await api.fetchMaterials(projectId: projectId)
            materials = loaded.value.materials
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func delete(_ material: PFMaterial) async {
        do {
            try await api.deleteMaterial(projectId: projectId, id: material.id)
            Haptic.success()
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

private struct AddMaterialSheet: View {
    let projectId: String
    let onSaved: () -> Void

    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var category = PFCategories.material.first!
    @State private var name = ""
    @State private var brand = ""
    @State private var model = ""
    @State private var color = ""
    @State private var finish = ""
    @State private var supplier = ""
    @State private var estimatedQty = ""
    @State private var price: Double?
    @State private var relatedSpaces = ""
    @State private var imageFile: UploadFile?
    @State private var imagePreview: Data?
    @State private var error: String?

    private var isValid: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        SheetScaffold(L("Add material"), symbol: "paintpalette", primaryTitle: L("Add Material"), isPrimaryEnabled: isValid) {
            await save()
        } content: {
            FormSection {
                MenuField(L("Category"), selection: $category, options: PFCategories.material, title: { $0 })
                NeonTextField(L("Name"), text: $name, prompt: "Calacatta Gold Marble", isRequired: true)
                HStack(spacing: 12) {
                    NeonTextField(L("Brand"), text: $brand)
                    NeonTextField(L("Model"), text: $model)
                }
                HStack(spacing: 12) {
                    NeonTextField(L("Color"), text: $color)
                    NeonTextField(L("Finish"), text: $finish)
                }
                NeonTextField(L("Supplier"), text: $supplier)
                NeonTextField(L("Estimated quantity"), text: $estimatedQty, prompt: "42 m²")
                MoneyField(L("Price (optional)"), amount: $price)
                NeonTextField(L("Used in (spaces)"), text: $relatedSpaces, prompt: "Living Room, Kitchen")
                ImagePickerField(label: L("Image"), file: $imageFile, previewData: $imagePreview)
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.large])
    }

    private func save() async {
        do {
            try await api.createMaterial(
                projectId: projectId, category: category, name: name, brand: brand, model: model, color: color,
                finish: finish, supplier: supplier, estimatedQty: estimatedQty, price: price,
                relatedSpaces: relatedSpaces, image: imageFile
            )
            dismiss()
            onSaved()
        } catch {
            self.error = error.localizedDescription
            Toast.error(error)
        }
    }
}
