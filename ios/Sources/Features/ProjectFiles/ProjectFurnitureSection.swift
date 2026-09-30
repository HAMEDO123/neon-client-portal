import SwiftUI

// The furniture and product schedule — the web's furniture tab
// (src/app/admin/(dashboard)/projects/[id]/furniture/page.tsx).

struct ProjectFurnitureSection: View {
    let projectId: String

    @EnvironmentObject private var api: APIClient
    @State private var furniture: [PFFurnitureItem]?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var showAdd = false
    @State private var toDelete: PFFurnitureItem?

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.lg) {
            pfSectionHeader(
                L("Furniture"), subtitle: headerSubtitle, section: .furniture,
                addTitle: L("Add Item"), showAdd: !(furniture?.isEmpty ?? true)
            ) { showAdd = true }

            LoadStateView(value: furniture, error: errorMessage, cachedAt: cachedAt, retry: load) { rows in
                if rows.isEmpty {
                    EmptyState(
                        symbol: PFSection.furniture.symbol,
                        title: L("No furniture yet"),
                        detail: L("Build the furniture and product schedule."),
                        actionTitle: L("Add Item"),
                        action: { showAdd = true },
                        hue: PFSection.furniture.hue,
                        card: true
                    )
                } else {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { index, item in
                            furnitureCard(item)
                                .neonContextShape(radius: NeonRadius.lg)
                                .contextMenu {
                                    Button(role: .destructive) { toDelete = item } label: {
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
            AddFurnitureSheet(projectId: projectId) { Haptic.success(); Toast.success(L("Item added")); Task { await load() } }
        }
        .confirmDestructive(item: $toDelete, title: { L("Delete “%@”?", $0.name) }, actionTitle: L("Delete")) { item in
            Task { await delete(item) }
        }
    }

    private var headerSubtitle: String {
        guard let furniture, !furniture.isEmpty else { return L("The furniture and product schedule") }
        return L("%d items", furniture.count)
    }

    private func furnitureCard(_ item: PFFurnitureItem) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            RemoteImage(url: resolvedMediaURL(item.imageUrl), placeholderSymbol: PFSection.furniture.symbol)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                DirText(item.name, font: .neonRowTitle, color: .neonInk, fill: false, lineLimit: 1)
                Text([item.space ?? "—", L("Qty %d", item.quantity)].joined(separator: " · "))
                    .font(.neonSubtitle).foregroundStyle(Color.neonTextTertiary).lineLimit(1)
                if let price = item.price {
                    Text(NeonFormat.money(price)).font(.neonNumberSmall).foregroundStyle(Color.neonSuccessStrong)
                }
            }
            .padding(10)
        }
        .neonSurface(.glass, radius: NeonRadius.lg)
    }

    private func load() async {
        do {
            let loaded = try await api.fetchFurniture(projectId: projectId)
            furniture = loaded.value.furniture
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func delete(_ item: PFFurnitureItem) async {
        do {
            try await api.deleteFurnitureItem(projectId: projectId, id: item.id)
            Haptic.success()
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

struct AddFurnitureSheet: View {
    let projectId: String
    let onSaved: () -> Void

    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var space = ""
    @State private var quantity = 1
    @State private var brand = ""
    @State private var model = ""
    @State private var dimensions = ""
    @State private var finish = ""
    @State private var supplier = ""
    @State private var price: Double?
    @State private var imageFile: UploadFile?
    @State private var imagePreview: Data?
    @State private var error: String?

    private var isValid: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        SheetScaffold(L("Add Furniture Item"), symbol: PFSection.furniture.symbol, primaryTitle: L("Add Item"), isPrimaryEnabled: isValid) {
            await save()
        } content: {
            FormSection(L("Item")) {
                NeonTextField(L("Name"), text: $name, prompt: L("Sofa"), isRequired: true)
                HStack(spacing: 12) {
                    NeonTextField(L("Space"), text: $space, prompt: L("Living Room"))
                    NumberField(L("Quantity"), value: $quantity)
                }
            }
            FormSection(L("Details")) {
                HStack(spacing: 12) {
                    NeonTextField(L("Brand"), text: $brand, prompt: "")
                    NeonTextField(L("Model"), text: $model, prompt: "")
                }
                NeonTextField(L("Dimensions"), text: $dimensions, prompt: L("320 × 100 cm"))
                NeonTextField(L("Finish"), text: $finish, prompt: "")
                NeonTextField(L("Supplier"), text: $supplier, prompt: "")
            }
            FormSection(L("Price & Photo")) {
                MoneyField(L("Price"), amount: $price)
                ImagePickerField(label: L("Image"), file: $imageFile, previewData: $imagePreview)
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.large])
    }

    private func save() async {
        do {
            try await api.createFurnitureItem(
                projectId: projectId, name: name, space: space, quantity: quantity, brand: brand, model: model,
                dimensions: dimensions, finish: finish, supplier: supplier, price: price, image: imageFile
            )
            dismiss()
            onSaved()
        } catch {
            self.error = error.localizedDescription
            Toast.error(error)
        }
    }
}
