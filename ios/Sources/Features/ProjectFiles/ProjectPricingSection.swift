import SwiftUI

// Execution pricing — the web's pricing tab
// (src/app/admin/(dashboard)/projects/[id]/pricing/page.tsx). The total is
// the same sum the web computes: every non-optional line item.

struct ProjectPricingSection: View {
    let projectId: String

    @EnvironmentObject private var api: APIClient
    @State private var response: PFPricingResponse?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var showAdd = false
    @State private var toDelete: PFPricingItem?

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.lg) {
            SectionHeader(L("Pricing"), count: response?.items.count) {
                IconButton("plus", label: L("Add line item")) { showAdd = true }
            }

            LoadStateView(value: response, error: errorMessage, cachedAt: cachedAt, retry: load) { data in
                if !data.showPricing {
                    StatusNote(
                        symbol: "eye.slash",
                        tone: .warning,
                        title: L("Pricing is currently hidden from the client"),
                        detail: L("Enable “Show Execution Pricing” in the project's Overview when ready.")
                    )
                }

                if data.items.isEmpty {
                    EmptyState(
                        symbol: "wallet.pass",
                        title: L("No pricing yet"),
                        detail: L("Add cost breakdown line items."),
                        actionTitle: L("Add line item"),
                        action: { showAdd = true },
                        hue: .green,
                        card: true
                    )
                } else {
                    CardList(data.items) { item in
                        ListRow(
                            item.label,
                            subtitle: item.description,
                            leading: .icon("wallet.pass", tint: .neonSuccessStrong),
                            value: NeonFormat.money(item.amount),
                            badge: item.isOptional ? L("Optional") : item.category,
                            badgeTone: item.isOptional ? .neutral : .cyan
                        ) {
                            Button(role: .destructive) { toDelete = item } label: { Image(systemName: "trash").foregroundStyle(.red) }
                        }
                    }
                    .neonAppear()

                    // The same sum the web computes: every non-optional line.
                    // Made a clear, hero-weight total — the one figure this
                    // whole tab exists to answer.
                    let includedCount = data.items.filter { !$0.isOptional }.count
                    HStack(spacing: 14) {
                        IconTile("banknote.fill", hue: .green, size: NeonSize.iconTileLarge)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("Total Project Cost"))
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Color.neonTextSecondary)
                            Text(L("%d line items", includedCount))
                                .font(.system(size: 11.5))
                                .foregroundStyle(Color.neonTextTertiary)
                        }
                        Spacer(minLength: 8)
                        Text(NeonFormat.money(data.total))
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
        .task { await load() }
        .sheet(isPresented: $showAdd) {
            AddPricingSheet(projectId: projectId) { Haptic.success(); Toast.success(L("Line item added")); Task { await load() } }
        }
        .confirmDestructive(item: $toDelete, title: { L("Delete “%@”?", $0.label) }, actionTitle: L("Delete")) { item in
            Task { await delete(item) }
        }
    }

    private func load() async {
        do {
            let loaded = try await api.fetchPricing(projectId: projectId)
            response = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func delete(_ item: PFPricingItem) async {
        do {
            try await api.deletePricingItem(projectId: projectId, id: item.id)
            Haptic.success()
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

struct AddPricingSheet: View {
    let projectId: String
    let onSaved: () -> Void

    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var category = PFCategories.pricing.first!
    @State private var label = ""
    @State private var amount: Double?
    @State private var itemDescription = ""
    @State private var isOptional = false
    @State private var error: String?

    private var isValid: Bool { !label.trimmingCharacters(in: .whitespaces).isEmpty && (amount ?? 0) > 0 }

    var body: some View {
        SheetScaffold(L("Add line item"), symbol: "wallet.pass", primaryTitle: L("Add Line Item"), isPrimaryEnabled: isValid) {
            await save()
        } content: {
            FormSection {
                MenuField(L("Category"), selection: $category, options: PFCategories.pricing, title: { $0 })
                NeonTextField(L("Label"), text: $label, prompt: "Interior Works", isRequired: true)
                MoneyField(L("Amount"), amount: $amount, isRequired: true)
                NeonTextEditor(L("Description"), text: $itemDescription, minLines: 2, maxLines: 5)
                ToggleRow(L("Optional item"), detail: L("Shown separately, not in the total."), symbol: "circle.dashed", isOn: $isOptional)
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.medium, .large])
    }

    private func save() async {
        do {
            try await api.createPricingItem(
                projectId: projectId, category: category, label: label, description: itemDescription,
                amount: amount ?? 0, isOptional: isOptional
            )
            dismiss()
            onSaved()
        } catch {
            self.error = error.localizedDescription
            Toast.error(error)
        }
    }
}
