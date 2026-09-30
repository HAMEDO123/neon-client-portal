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
            pfSectionHeader(
                L("Materials"), subtitle: headerSubtitle, section: .materials,
                addTitle: L("Add Material"), showAdd: !(materials?.isEmpty ?? true)
            ) { showAdd = true }

            LoadStateView(value: materials, error: errorMessage, cachedAt: cachedAt, retry: load) { rows in
                if rows.isEmpty {
                    EmptyState(
                        symbol: PFSection.materials.symbol,
                        title: L("No materials yet"),
                        detail: L("Build the material and finish board."),
                        actionTitle: L("Add Material"),
                        action: { showAdd = true },
                        hue: PFSection.materials.hue,
                        card: true
                    )
                } else {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { index, material in
                            materialCard(material)
                                .neonContextShape(radius: NeonRadius.lg)
                                .contextMenu {
                                    Button(role: .destructive) { toDelete = material } label: {
                                        Label(L("Delete"), systemImage: "trash")
                                    }
                                }
                                .staggered(index)
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

    private var headerSubtitle: String {
        guard let materials, !materials.isEmpty else { return L("The material and finish board") }
        return L("%d materials", materials.count)
    }

    private func materialCard(_ material: PFMaterial) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            RemoteImage(url: resolvedMediaURL(material.imageUrl), placeholderSymbol: PFSection.materials.symbol)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                BadgeView(text: L(material.category), tone: .pink)
                DirText(material.name, font: .neonRowTitle, color: .neonInk, fill: false, lineLimit: 1)
                if let brand = material.brand, !brand.isEmpty {
                    DirText(brand, font: .neonSubtitle, color: .neonTextTertiary, fill: false, lineLimit: 1)
                }
                if let price = material.price {
                    Text(NeonFormat.money(price)).font(.neonNumberSmall).foregroundStyle(Color.neonSuccessStrong)
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

struct AddMaterialSheet: View {
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
        SheetScaffold(L("Add Material"), symbol: PFSection.materials.symbol, primaryTitle: L("Add Material"), isPrimaryEnabled: isValid) {
            await save()
        } content: {
            FormSection(L("Item")) {
                MenuField(L("Category"), selection: $category, options: PFCategories.material, title: { L($0) })
                NeonTextField(L("Name"), text: $name, prompt: L("Calacatta Gold Marble"), isRequired: true)
            }
            FormSection(L("Details")) {
                HStack(spacing: 12) {
                    NeonTextField(L("Brand"), text: $brand, prompt: "")
                    NeonTextField(L("Model"), text: $model, prompt: "")
                }
                HStack(spacing: 12) {
                    NeonTextField(L("Color"), text: $color, prompt: "")
                    NeonTextField(L("Finish"), text: $finish, prompt: "")
                }
                NeonTextField(L("Supplier"), text: $supplier, prompt: "")
                NeonTextField(L("Estimated quantity"), text: $estimatedQty, prompt: L("42 m²"))
            }
            FormSection(L("Price & Photo")) {
                MoneyField(L("Price"), amount: $price)
                NeonTextField(L("Used in (spaces)"), text: $relatedSpaces, prompt: L("Living Room, Kitchen"))
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
