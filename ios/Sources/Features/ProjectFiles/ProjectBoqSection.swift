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
            pfSectionHeader(
                L("BOQ"), subtitle: headerSubtitle, section: .boq,
                addTitle: L("Add Item"), showAdd: !(items?.isEmpty ?? true)
            ) { showAdd = true }

            LoadStateView(value: items, error: errorMessage, cachedAt: cachedAt, retry: load) { rows in
                if rows.isEmpty {
                    EmptyState(
                        symbol: PFSection.boq.symbol,
                        title: L("No BOQ items yet"),
                        detail: L("Add quantities and specifications."),
                        actionTitle: L("Add Item"),
                        action: { showAdd = true },
                        hue: PFSection.boq.hue,
                        card: true
                    )
                } else {
                    CardList(rows) { item in
                        ListRow(
                            item.name,
                            subtitle: [item.specification, item.relatedSpace].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · "),
                            meta: L("%@ %@", NeonFormat.number(item.quantity, decimals: item.quantity.truncatingRemainder(dividingBy: 1) == 0 ? 0 : 2), item.unit),
                            leading: item.imageUrl != nil ? .thumbnail(url: resolvedMediaURL(item.imageUrl)) : .icon(PFSection.boq.symbol, tint: PFSection.boq.hue.deep),
                            value: item.unitPrice.map { NeonFormat.money($0) },
                            badge: L(item.category),
                            badgeTone: .orange
                        ) {
                            IconButton("trash", label: L("Delete"), look: .plain, tint: .neonDangerStrong, size: NeonSize.touch) {
                                toDelete = item
                            }
                        }
                    }
                    .neonAppear()

                    // Not the web admin's own total (it has none — only the
                    // client page sums BOQ, gated by showBoqPrices/Quantities).
                    // A real, honestly-scoped derived figure: only the lines
                    // that actually carry a unit price are counted, and the
                    // caption says so rather than implying a full estimate.
                    // Drawn in money green, like Pricing's total — the kit
                    // reserves that hue for a money figure, whatever section
                    // it's totting up.
                    if !pricedLines(rows).isEmpty {
                        HStack(spacing: 14) {
                            IconTile("banknote", hue: .green, size: NeonSize.iconTileLarge)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("Priced Items Subtotal"))
                                    .font(.neonRowTitle)
                                    .foregroundStyle(Color.neonTextSecondary)
                                Text(L("Only items with a unit price are counted."))
                                    .font(.neonMeta)
                                    .foregroundStyle(Color.neonTextTertiary)
                            }
                            Spacer(minLength: 8)
                            Text(NeonFormat.money(pricedLines(rows).reduce(0, +)))
                                .font(.neonNumber)
                                .foregroundStyle(Color.neonSuccessStrong)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                        }
                        .padding(16)
                        .neonSurface(.tinted(.neonSuccess), radius: NeonRadius.lg)
                        .neonAppear(delay: 0.05)
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

    private func pricedLines(_ rows: [PFBoqItem]) -> [Double] {
        rows.compactMap { item in item.unitPrice.map { $0 * item.quantity } }
    }

    private var headerSubtitle: String {
        guard let items, !items.isEmpty else { return L("Quantities and specifications") }
        let priced = pricedLines(items)
        guard !priced.isEmpty else { return L("%d lines", items.count) }
        return L("%d lines · %@", items.count, NeonFormat.money(priced.reduce(0, +)))
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

struct AddBoqSheet: View {
    let projectId: String
    let onSaved: () -> Void

    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var category = PFCategories.boq.first!
    @State private var name = ""
    @State private var unit = ""
    @State private var quantity: Double?
    @State private var unitPrice: Double?
    @State private var relatedDrawing: String?
    @State private var relatedSpace: String?
    @State private var specification = ""
    @State private var imageFile: UploadFile?
    @State private var imagePreview: Data?
    @State private var error: String?
    @State private var drawingOptions: [String] = []
    @State private var spaceOptions: [String] = []

    private var isValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && !unit.trimmingCharacters(in: .whitespaces).isEmpty && (quantity ?? 0) > 0
    }

    var body: some View {
        SheetScaffold(L("Add BOQ Item"), symbol: PFSection.boq.symbol, primaryTitle: L("Add Item"), isPrimaryEnabled: isValid) {
            await save()
        } content: {
            FormSection(L("Item")) {
                MenuField(L("Category"), selection: $category, options: PFCategories.boq, title: { L($0) })
                NeonTextField(L("Item name"), text: $name, prompt: L("Porcelain Flooring"), isRequired: true)
            }
            FormSection(L("Quantity & Price")) {
                HStack(spacing: 12) {
                    NumberField(L("Quantity"), value: $quantity, decimals: 2, isRequired: true)
                    NeonTextField(L("Unit"), text: $unit, prompt: L("m²"), isRequired: true)
                }
                MoneyField(L("Unit price"), amount: $unitPrice)
            }
            FormSection(L("Where It Goes")) {
                MenuField(L("Related drawing"), selection: $relatedDrawing, options: drawingOptions, title: { $0 }, noneTitle: L("None"))
                MenuField(L("Related space"), selection: $relatedSpace, options: spaceOptions, title: { $0 }, noneTitle: L("None"))
            }
            FormSection(L("Details")) {
                NeonTextEditor(L("Specification"), text: $specification, minLines: 2, maxLines: 5)
                ImagePickerField(label: L("Reference image"), file: $imageFile, previewData: $imagePreview)
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.large])
        .task { await loadOptions() }
    }

    // A typo in a free-text "A-102" quietly breaks the link to a drawing
    // that's already on file; offering the project's own drawings and
    // spaces to pick from can't misspell one.
    private func loadOptions() async {
        if let drawings = try? await api.fetchDrawings(projectId: projectId).value.drawings {
            drawingOptions = drawings.map { $0.drawingNumber?.isEmpty == false ? $0.drawingNumber! : $0.name }
        }
        if let detail = try? await api.fetchProjectDetail(id: projectId).value {
            spaceOptions = detail.spaces.map(\.name)
        }
    }

    private func save() async {
        do {
            try await api.createBoqItem(
                projectId: projectId, category: category, name: name, description: "",
                specification: specification, unit: unit, quantity: quantity ?? 0, unitPrice: unitPrice,
                relatedDrawing: relatedDrawing ?? "", relatedSpace: relatedSpace ?? "", notes: "", image: imageFile
            )
            dismiss()
            onSaved()
        } catch {
            self.error = error.localizedDescription
            Toast.error(error)
        }
    }
}
