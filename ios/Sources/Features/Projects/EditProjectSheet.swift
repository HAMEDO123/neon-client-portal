import SwiftUI
import PhotosUI

/// The full overview edit — every field the website's Project Details and
/// Client Visibility Settings forms carry, in one sheet. Two saves under one
/// primary button, matching the two server actions behind them.
struct EditProjectSheet: View {
    let detail: ProjectDetail
    let onSaved: () -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var clientName: String
    @State private var clientEmail: String
    @State private var clientPhone: String
    @State private var location: String
    @State private var area: String
    @State private var projectType: String
    @State private var description: String
    @State private var deliveryDate: Date?
    @State private var pipelineStatus: String?
    @State private var currentStage: String?
    @State private var completionPercent: Double?
    @State private var soldById: String?
    @State private var soldOn: Date?

    @State private var showPricing: Bool
    @State private var showDetailedPricing: Bool
    @State private var showBoqQuantities: Bool
    @State private var showBoqPrices: Bool
    @State private var allowDownloads: Bool
    @State private var watermarkEnabled: Bool

    @State private var coverSelection: PhotosPickerItem?
    @State private var coverPreview: Image?
    @State private var coverUpload: UploadFile?
    @State private var removeCover = false
    @State private var sellers: [ProjectSeller] = []
    @State private var attempts = 0

    init(detail: ProjectDetail, onSaved: @escaping () -> Void) {
        self.detail = detail
        self.onSaved = onSaved
        _name = State(initialValue: detail.name)
        _clientName = State(initialValue: detail.clientName)
        _clientEmail = State(initialValue: detail.clientEmail ?? "")
        _clientPhone = State(initialValue: detail.clientPhone ?? "")
        _location = State(initialValue: detail.location ?? "")
        _area = State(initialValue: detail.area ?? "")
        _projectType = State(initialValue: detail.projectType ?? "")
        _description = State(initialValue: detail.description ?? "")
        _deliveryDate = State(initialValue: parseISODate(detail.deliveryDate))
        _pipelineStatus = State(initialValue: detail.pipelineStatus)
        _currentStage = State(initialValue: detail.currentStage)
        _completionPercent = State(initialValue: Double(detail.completionPercent))
        _soldById = State(initialValue: detail.soldById)
        _soldOn = State(initialValue: parseISODate(detail.soldOn))
        _showPricing = State(initialValue: detail.showPricing)
        _showDetailedPricing = State(initialValue: detail.showDetailedPricing)
        _showBoqQuantities = State(initialValue: detail.showBoqQuantities)
        _showBoqPrices = State(initialValue: detail.showBoqPrices)
        _allowDownloads = State(initialValue: detail.allowDownloads)
        _watermarkEnabled = State(initialValue: detail.watermarkEnabled)
    }

    private var isValid: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        SheetScaffold(
            L("Edit Project"),
            subtitle: detail.name,
            symbol: "pencil",
            primaryTitle: L("Save"),
            isPrimaryEnabled: isValid
        ) {
            await save()
        } content: {
            FormSection(L("Cover")) {
                coverField
            }
            FormSection(L("Project")) {
                NeonTextField(L("Project Name"), text: $name, symbol: "textformat", isRequired: true)
                NeonTextField(L("Client Name"), text: $clientName, symbol: "person")
                NeonTextField(L("Client Email"), text: $clientEmail, keyboard: .emailAddress, capitalization: .never, leftToRight: true)
                NeonTextField(L("Client Phone"), text: $clientPhone, keyboard: .phonePad, leftToRight: true)
                OptionalDateField(L("Delivery Date"), date: $deliveryDate)
            }
            FormSection(L("Details")) {
                NeonTextField(L("Location"), text: $location, symbol: "mappin.and.ellipse")
                NeonTextField(L("Area"), text: $area, symbol: "ruler")
                NeonTextField(L("Project Type"), text: $projectType, symbol: "tag")
                NeonTextEditor(L("Description"), text: $description, minLines: 3, maxLines: 8, limit: 600)
            }
            FormSection(L("Pipeline")) {
                MenuField(
                    L("Pipeline Status"), selection: $pipelineStatus, options: ProjectConstants.pipelineStatuses,
                    title: { localizedEnum("pipeline", $0) }
                )
                MenuField(
                    L("Journey Stage"), selection: $currentStage, options: ProjectConstants.projectStages,
                    title: { localizedEnum("stage", $0) }
                )
                NumberField(L("Completion %"), value: $completionPercent, decimals: 0)
            }
            FormSection(L("Sale"), footer: L("This project counts as a sale for whoever is picked here, in the month of the date beside it. Leave the date empty and today is used.")) {
                MenuField(
                    L("Sold by"), selection: $soldById, options: sellers.map(\.id),
                    title: { id in sellers.first { $0.id == id }?.name ?? id },
                    noneTitle: L("Not recorded")
                )
                OptionalDateField(L("Sold on"), date: $soldOn)
            }
            FormSection(L("Client Visibility")) {
                ToggleRow(L("Show Execution Pricing"), detail: L("Hide entirely until the proposal is ready."), isOn: $showPricing)
                ToggleRow(L("Show Detailed Pricing Breakdown"), detail: L("Otherwise only the total is shown."), isOn: $showDetailedPricing)
                ToggleRow(L("Show BOQ Quantities"), isOn: $showBoqQuantities)
                ToggleRow(L("Show BOQ Unit Prices"), isOn: $showBoqPrices)
                ToggleRow(L("Allow File Downloads"), detail: L("Drawings, documents and the handover package."), isOn: $allowDownloads)
                ToggleRow(L("Enable Watermark"), detail: L("Overlays “NEON DESIGN — CONFIDENTIAL” on renders."), isOn: $watermarkEnabled)
            }
        }
        .neonSheet([.large])
        .shake(attempts)
        .task { await loadSellers() }
    }

    @ViewBuilder
    private var coverField: some View {
        HStack(spacing: 12) {
            ZStack {
                if let coverPreview {
                    coverPreview.resizable().aspectRatio(contentMode: .fill)
                } else {
                    RemoteImage(url: detail.resolvedCoverURL, contentMode: .fill)
                }
            }
            .frame(width: 84, height: 60)
            .clipShape(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous))

            VStack(alignment: .leading, spacing: 8) {
                PhotosPicker(selection: $coverSelection, matching: .images) {
                    Label(detail.coverImageUrl == nil ? L("Upload cover image") : L("Replace cover image"), systemImage: "photo")
                }
                .buttonStyle(.neon(.secondary, size: .small))
                if detail.coverImageUrl != nil && coverUpload == nil {
                    Toggle(L("Remove current cover image"), isOn: $removeCover)
                        .font(.neonFootnote)
                }
            }
        }
        .onChange(of: coverSelection) { item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let uiImage = UIImage(data: data) {
                    let scaled = uiImage.scaledDown(maxDimension: 2400)
                    if let jpeg = scaled.jpegData(compressionQuality: 0.85) {
                        coverUpload = UploadFile(field: "coverImage", filename: "cover.jpg", mimeType: "image/jpeg", data: jpeg)
                        coverPreview = Image(uiImage: scaled)
                        removeCover = false
                    }
                }
            }
        }
    }

    private func loadSellers() async {
        if let loaded = try? await api.fetchSellers() { sellers = loaded.value }
    }

    private func save() async {
        var fields: [String: String] = [
            "name": name.trimmingCharacters(in: .whitespaces),
            "clientName": clientName,
            "clientEmail": clientEmail,
            "clientPhone": clientPhone,
            "location": location,
            "area": area,
            "projectType": projectType,
            "description": description,
            "pipelineStatus": pipelineStatus ?? detail.pipelineStatus,
            "currentStage": currentStage ?? detail.currentStage,
            "completionPercent": String(Int(completionPercent ?? 0)),
            "soldById": soldById ?? "",
        ]
        if let deliveryDate { fields["deliveryDate"] = NeonFormat.dayKey(deliveryDate) }
        if let soldOn { fields["soldOn"] = NeonFormat.dayKey(soldOn) }

        do {
            try await api.updateProject(id: detail.id, fields: fields, coverImage: coverUpload, removeCover: removeCover)
            try await api.updateProjectSettings(id: detail.id, fields: [
                "showPricing": showPricing,
                "showDetailedPricing": showDetailedPricing,
                "showBoqQuantities": showBoqQuantities,
                "showBoqPrices": showBoqPrices,
                "allowDownloads": allowDownloads,
                "watermarkEnabled": watermarkEnabled,
            ])
            Haptic.success()
            Toast.success(L("Saved"))
            dismiss()
            onSaved()
        } catch {
            attempts += 1
            Haptic.error()
            Toast.error(error)
        }
    }
}
