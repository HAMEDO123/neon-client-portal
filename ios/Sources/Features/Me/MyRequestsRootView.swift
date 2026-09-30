import PhotosUI
import SwiftUI

/// `/employee/requests`: what an employee asks the office for, and the day in
/// their own words — one screen with three tabs, read together in one call
/// since the whole thing is small.
struct MyRequestsRootView: View {
    @EnvironmentObject var api: APIClient
    @State private var tab: RequestsTab = .supplies
    @State private var data: RequestsResponse?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var showNewSupply = false
    @State private var cancelling: SupplyRequestRow?
    @State private var deletingReceipt: ReceiptRow?
    @State private var working = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NeonSpace.stack) {
                // Hidden until data has loaded: shown early, every tab kept
                // answering with the same error underneath it, as though the
                // filters themselves still worked.
                if data != nil {
                    PillFilterBar(selection: $tab, options: RequestsTab.allCases, title: { $0.label })
                }

                if let cachedAt { OfflineBanner(savedAt: cachedAt) }

                if let data {
                    switch tab {
                    case .supplies: suppliesSection(data)
                    case .receipts: receiptsSection(data)
                    case .report: ReportCard(report: data.report) { text in await saveReport(text) }
                    }
                } else if let errorMessage {
                    ErrorState(message: errorMessage) { await load() }
                } else {
                    SkeletonRows(count: 4)
                }
            }
            .padding(16)
        }
        .refreshable {
            Haptic.tap()
            await load()
        }
        .navigationTitle(L("Requests"))
        .neonAmbientBackground()
        .task { await load() }
        .sheet(isPresented: $showNewSupply) {
            NewSupplyRequestSheet {
                Haptic.success()
                Toast.success(L("Sent"))
                await load()
            }
        }
        .confirmDestructive(item: $cancelling, title: { L("Cancel the request for %@?", $0.item) }, actionTitle: L("Cancel request")) { row in
            Task { await cancel(row) }
        }
        .confirmDestructive(item: $deletingReceipt, title: { _ in L("Remove this receipt?") }, actionTitle: L("Remove")) { row in
            Task { await deleteReceiptRow(row) }
        }
    }

    // MARK: Supplies

    @ViewBuilder
    private func suppliesSection(_ data: RequestsResponse) -> some View {
        NeonButton(L("Request something for the office"), symbol: "shippingbox", kind: .brand) {
            showNewSupply = true
        }

        if data.supplyRequests.isEmpty {
            EmptyState(symbol: "shippingbox", title: L("Nothing requested yet"), hue: .orange, card: true)
        } else {
            CardList(data.supplyRequests) { request in
                supplyRow(request)
            }
        }
    }

    private func supplyRow(_ request: SupplyRequestRow) -> some View {
        HStack(alignment: .top, spacing: 12) {
            IconTile("shippingbox.fill", hue: request.urgent ? .pink : .orange, size: 36)
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 4) {
                            DirText(request.item, font: .system(.callout, weight: .semibold))
                            if let quantity = request.quantity, !quantity.isEmpty {
                                DirText(quantity, font: .neonSubtitle, color: .neonTextSecondary)
                            }
                        }
                        if let note = request.note, !note.isEmpty {
                            DirText(note, font: .neonSubtitle, color: .neonTextSecondary)
                        }
                        if let decision = request.decisionNote, !decision.isEmpty {
                            Text(L("Manager: %@", decision))
                                .font(.neonCaption)
                                .foregroundStyle(Color.neonTextTertiary)
                        }
                    }
                    Spacer()
                    if request.urgent { BadgeView(text: L("Urgent"), tone: .pink) }
                }
                HStack(spacing: 8) {
                    BadgeView(text: supplyStatusLabel(request.status), tone: supplyStatusTone(request.status))
                    if let cost = request.estimatedCost {
                        Text(L("≈ %@", NeonFormat.money(cost)))
                            .font(.neonCaption)
                            .foregroundStyle(Color.neonTextTertiary)
                    }
                    Spacer()
                    if request.status == "PENDING" {
                        NeonButton(L("Cancel"), kind: .ghost, size: .small) { cancelling = request }
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func supplyStatusLabel(_ status: String) -> String {
        switch status {
        case "APPROVED": return L("Approved")
        case "REJECTED": return L("Not approved")
        case "PURCHASED": return L("Bought")
        default: return L("Waiting for approval")
        }
    }

    private func supplyStatusTone(_ status: String) -> BadgeTone {
        switch status {
        case "APPROVED": return .success
        case "REJECTED": return .neutral
        case "PURCHASED": return .cyan
        default: return .warning
        }
    }

    // MARK: Receipts

    @ViewBuilder
    private func receiptsSection(_ data: RequestsResponse) -> some View {
        let counted = data.receipts.reduce(0) { $0 + ($1.countedAmount ?? 0) }

        NeonCard {
            Text(data.periodLabel.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.neonInk.opacity(0.4))
            Text(NeonFormat.money(counted, decimals: 2))
                .font(.neonTitle2)
            Text(L("%d receipt(s) · each counts up to %@, added to this month's pay", data.receipts.count, NeonFormat.money(data.receiptCap)))
                .font(.system(size: 12))
                .foregroundStyle(Color.neonInk.opacity(0.5))
        }

        ReceiptUploadButton(working: $working) { file in
            await submitReceiptFile(file)
        }

        if data.receipts.isEmpty {
            EmptyState(symbol: "receipt", title: L("No receipts this month yet"), hue: .orange, card: true)
        } else {
            VStack(spacing: 10) {
                ForEach(data.receipts) { receipt in
                    receiptRow(receipt)
                }
            }
        }
    }

    private func receiptRow(_ receipt: ReceiptRow) -> some View {
        HStack(alignment: .top, spacing: 12) {
            RemoteImage(url: resolvedMediaURL(receipt.imageUrl), contentMode: .fill)
                .frame(width: 56, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .top) {
                    DirText(receipt.vendor ?? (receipt.status == "FAILED" ? L("Could not read") : L("Receipt")), font: .system(size: 14, weight: .semibold))
                    Spacer()
                    Text(receipt.countedAmount.map { NeonFormat.money($0, decimals: 2) } ?? "—")
                        .font(.system(size: 14, weight: .semibold))
                }
                if let summary = receipt.summary, !summary.isEmpty {
                    DirText(summary, font: .neonCaption, color: .neonTextTertiary)
                }
                HStack(spacing: 8) {
                    if receipt.status == "FAILED" {
                        BadgeView(text: L("Needs a manual amount"), tone: .warning)
                    } else if receipt.status == "PENDING" {
                        BadgeView(text: L("Not read yet"), tone: .neutral)
                    }
                    Spacer()
                    NeonButton(L("Remove"), kind: .ghost, size: .small) { deletingReceipt = receipt }
                }
            }
        }
        .padding(12)
        .glassCard(radius: 16)
    }

    // MARK: Loading and writing

    private func load() async {
        do {
            let loaded = try await api.fetchRequests()
            data = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            if data == nil { errorMessage = error.localizedDescription }
        }
    }

    private func cancel(_ row: SupplyRequestRow) async {
        do {
            try await api.cancelSupplyRequest(id: row.id)
            Haptic.success()
            await load()
        } catch {
            Toast.error(error.localizedDescription)
        }
    }

    private func submitReceiptFile(_ file: UploadFile) async {
        working = true
        defer { working = false }
        do {
            try await api.submitReceipt(file)
            Haptic.success()
            await load()
        } catch {
            Haptic.error()
            Toast.error(error.localizedDescription)
        }
    }

    private func deleteReceiptRow(_ row: ReceiptRow) async {
        do {
            try await api.deleteReceipt(id: row.id)
            Haptic.success()
            await load()
        } catch {
            Toast.error(error.localizedDescription)
        }
    }

    private func saveReport(_ text: String) async {
        do {
            try await api.saveDailyReport(text: text)
            Haptic.success()
            Toast.success(L("Sent"))
            await load()
        } catch {
            Toast.error(error.localizedDescription)
        }
    }
}

enum RequestsTab: String, CaseIterable, Identifiable {
    case supplies, receipts, report
    var id: String { rawValue }
    // Short enough not to run into the pill's trailing edge at 390 pt, in
    // Arabic, or at larger text sizes — "Today's report" stays the full
    // words wherever else it's said (the card's own heading, for one).
    var label: String {
        switch self {
        case .supplies: return L("Supplies")
        case .receipts: return L("Receipts")
        case .report: return L("Report")
        }
    }
}

// MARK: - New supply request

private struct NewSupplyRequestSheet: View {
    let onSent: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var item = ""
    @State private var quantity = ""
    @State private var cost: Double?
    @State private var note = ""
    @State private var urgent = false
    @State private var sending = false
    @State private var errorMessage: String?

    var body: some View {
        SheetScaffold(
            L("Request something"),
            subtitle: L("For the office"),
            symbol: "shippingbox",
            primaryTitle: L("Send request"),
            isPrimaryEnabled: !item.trimmingCharacters(in: .whitespaces).isEmpty
        ) {
            await send()
        } content: {
            FormSection(L("What do you need?")) {
                NeonTextField(L("Item"), text: $item, prompt: L("Coffee, A4 paper…"), symbol: "cart", isRequired: true)
                NeonTextField(L("How much"), text: $quantity, prompt: L("2 boxes"), symbol: "number")
                MoneyField(L("Approx. cost"), amount: $cost)
                NeonTextEditor(L("Anything else the manager should know"), text: $note, minLines: 2, maxLines: 5)
                ToggleRow(L("We need this urgently"), symbol: "bolt.fill", isOn: $urgent)
            }
            if let errorMessage {
                Text(errorMessage).font(.footnote).foregroundStyle(.red)
            }
        }
        .neonSheet([.medium, .large])
    }

    private func send() async {
        do {
            try await api.createSupplyRequest(
                item: item.trimmingCharacters(in: .whitespaces),
                quantity: quantity.trimmingCharacters(in: .whitespaces),
                estimatedCost: cost.map { String($0) } ?? "",
                note: note.trimmingCharacters(in: .whitespaces),
                urgent: urgent
            )
            await onSent()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Receipts: photograph and send in one step

private struct ReceiptUploadButton: View {
    @Binding var working: Bool
    let onPicked: (UploadFile) async -> Void

    @State private var photoItem: PhotosPickerItem?
    @State private var showCamera = false

    var body: some View {
        HStack(spacing: 10) {
            if CameraPicker.isAvailable {
                NeonButton(L("Photograph a receipt"), symbol: "camera.fill", kind: .brand) {
                    Haptic.tap()
                    showCamera = true
                }
                .disabled(working)
            }
            PhotosPicker(selection: $photoItem, matching: .images) {
                IconTile("photo.on.rectangle", hue: .blue, size: 50, style: .glass)
            }
            .buttonStyle(.pressable)
            .disabled(working)
        }
        .overlay {
            if working {
                ProgressView().padding(.trailing, 8)
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                if let made = UploadMaker.photo(image) { Task { await onPicked(made) } }
            }
            .ignoresSafeArea()
        }
        .onChange(of: photoItem) { item in
            guard let item else { return }
            Task {
                if let made = await UploadMaker.photo(item) { await onPicked(made) }
                photoItem = nil
            }
        }
    }
}

// MARK: - Today's report

private struct ReportCard: View {
    let report: DailyReportValue?
    let onSave: (String) async -> Void

    @State private var text = ""
    @State private var saving = false
    @State private var initialized = false

    var body: some View {
        NeonCard {
            SectionLabel(L("Today's report"))
            Text(L("What you did today, in your own words — including anything that went wrong or is still open. You can keep adding to it until the day ends."))
                .font(.system(size: 12))
                .foregroundStyle(Color.neonInk.opacity(0.5))

            NeonTextEditor(L("Today"), text: $text, prompt: L("Went to the site in the morning, took the measurements…"), minLines: 6, maxLines: 14)

            NeonButton(report == nil ? L("Send today's report") : L("Update today's report"), symbol: "paperplane.fill") {
                saving = true
                await onSave(text)
                saving = false
            }
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if let updatedAt = report?.updatedAt, let time = formattedISODate(updatedAt) {
                Text(L("Last saved %@", time))
                    .font(.system(size: 11))
                    .foregroundStyle(Color.neonInk.opacity(0.4))
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
        .onAppear {
            guard !initialized else { return }
            initialized = true
            text = report?.text ?? ""
        }
    }
}
