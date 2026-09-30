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
            pfSectionHeader(
                L("Pricing"), subtitle: headerSubtitle, section: .pricing,
                addTitle: L("Add Line Item"), showAdd: !(response?.items.isEmpty ?? true)
            ) { showAdd = true }

            LoadStateView(value: response, error: errorMessage, cachedAt: cachedAt, retry: load) { data in
                // Only worth a note once there's something to hide: a warning
                // above an empty list read as two stacked cards about having
                // nothing at all.
                if !data.showPricing && !data.items.isEmpty {
                    hiddenNote
                }

                if data.items.isEmpty {
                    EmptyState(
                        symbol: PFSection.pricing.symbol,
                        title: L("No pricing yet"),
                        detail: L("Add cost breakdown line items."),
                        actionTitle: L("Add Line Item"),
                        action: { showAdd = true },
                        hue: PFSection.pricing.hue,
                        card: true
                    )
                } else {
                    CardList(data.items) { item in
                        ListRow(
                            item.label,
                            subtitle: item.description,
                            leading: .icon(PFSection.pricing.symbol, tint: PFSection.pricing.hue.deep),
                            value: NeonFormat.money(item.amount),
                            badge: item.isOptional ? L("Optional") : L(item.category),
                            badgeTone: item.isOptional ? .neutral : .cyan
                        ) {
                            IconButton("trash", label: L("Delete"), look: .plain, tint: .neonDangerStrong, size: NeonSize.touch) {
                                toDelete = item
                            }
                        }
                    }
                    .neonAppear()

                    // The same sum the web computes: every non-optional line.
                    // Made a clear, hero-weight total — the one figure this
                    // whole tab exists to answer.
                    let includedCount = data.items.filter { !$0.isOptional }.count
                    HStack(spacing: 14) {
                        IconTile(PFSection.pricing.symbol, hue: .green, size: NeonSize.iconTileLarge)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("Total Project Cost"))
                                .font(.neonRowTitle)
                                .foregroundStyle(Color.neonTextSecondary)
                            Text(L("%d line items", includedCount))
                                .font(.neonMeta)
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

    // The note used to send people to "the project's Overview", which only
    // has a read-only visibility row — the switch is in Edit. It now acts
    // instead of just describing where to look.
    private var hiddenNote: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                IconTile("eye.slash", hue: .orange, size: 34, style: .glass)
                VStack(alignment: .leading, spacing: 3) {
                    Text(L("Hidden from the client"))
                        .font(.system(.subheadline, weight: .semibold))
                        .foregroundStyle(Color.neonInk)
                    Text(L("Only your team can see it until you show it to the client."))
                        .font(.neonSubtitle)
                        .foregroundStyle(Color.neonTextSecondary)
                }
                Spacer(minLength: 0)
            }
            NeonButton(L("Show to Client"), kind: .tinted(.neonOrangeStrong), size: .small) {
                await showToClient()
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: NeonRadius.md + 2, style: .continuous).fill(NeonHue.orange.wash))
        .overlay(RoundedRectangle(cornerRadius: NeonRadius.md + 2, style: .continuous).strokeBorder(NeonHue.orange.color.opacity(0.18), lineWidth: 1))
    }

    private var headerSubtitle: String {
        guard let response, !response.items.isEmpty else { return L("Cost breakdown line items") }
        return L("%d line items · %@", response.items.count, NeonFormat.money(response.total))
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

    private func showToClient() async {
        do {
            // The settings write is whole-record (every visibility flag,
            // same as `EditProjectSheet`'s own save): read the other five
            // first so flipping this one doesn't silently clear them.
            let detail = try await api.fetchProjectDetail(id: projectId).value
            try await api.updateProjectSettings(id: projectId, fields: [
                "showPricing": true,
                "showDetailedPricing": detail.showDetailedPricing,
                "showBoqQuantities": detail.showBoqQuantities,
                "showBoqPrices": detail.showBoqPrices,
                "allowDownloads": detail.allowDownloads,
                "watermarkEnabled": detail.watermarkEnabled,
            ])
            Haptic.success()
            Toast.success(L("Now visible to the client"))
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
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
        SheetScaffold(L("Add Line Item"), symbol: PFSection.pricing.symbol, primaryTitle: L("Add Line Item"), isPrimaryEnabled: isValid) {
            await save()
        } content: {
            FormSection {
                MenuField(L("Category"), selection: $category, options: PFCategories.pricing, title: { L($0) })
                NeonTextField(L("Label"), text: $label, prompt: L("e.g. Kitchen joinery"), isRequired: true)
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
