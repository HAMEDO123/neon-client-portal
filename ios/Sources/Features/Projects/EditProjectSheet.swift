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
    /// Free text the app didn't write ("300–350") stays a text field; a
    /// number, or nothing yet, is a number field in m².
    @State private var area: String
    @State private var areaNumber: Double?
    private let areaIsText: Bool
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
        let parsedArea = projectAreaNumber(detail.area)
        _areaNumber = State(initialValue: parsedArea)
        areaIsText = parsedArea == nil && !(detail.area ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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
                NeonTextField(L("Client Name"), text: $clientName, prompt: L("e.g. Lina Haddad"), symbol: "person")
                NeonTextField(L("Client Email"), text: $clientEmail, prompt: "name@example.com", symbol: "envelope", keyboard: .emailAddress, contentType: .emailAddress, capitalization: .never, autocorrect: false, leftToRight: true)
                NeonTextField(L("Client Phone"), text: $clientPhone, prompt: "07X XXX XXXX", symbol: "phone", keyboard: .phonePad, contentType: .telephoneNumber, leftToRight: true)
                OptionalDateField(L("Delivery Date"), date: $deliveryDate)
            }
            FormSection(L("Details")) {
                NeonTextField(L("Location"), text: $location, prompt: L("e.g. Amman, Abdoun"), symbol: "mappin.and.ellipse")
                if areaIsText {
                    NeonTextField(L("Area"), text: $area, prompt: "320 m²", symbol: "ruler")
                } else {
                    NumberField(L("Area"), value: $areaNumber, unit: L("m²"), decimals: 2, prompt: "320", symbol: "ruler")
                }
                NeonTextField(L("Project Type"), text: $projectType, prompt: L("e.g. Interior design"), symbol: "tag")
                NeonTextEditor(L("Description"), text: $description, minLines: 3, maxLines: 8, limit: 600)
            }
            FormSection(L("Pipeline")) {
                MenuField(
                    L("Pipeline Status"), selection: $pipelineStatus, options: ProjectConstants.pipelineStatuses,
                    title: { ProjectPipelineStyle.label($0) }
                )
                MenuField(
                    L("Journey Stage"), selection: $currentStage, options: ProjectConstants.projectStages,
                    title: { projectStageLabel($0) }
                )
                NumberField(L("Completion %"), value: $completionPercent, unit: "%", decimals: 0)
                ProgressBar(progress: min(max(completionPercent ?? 0, 0), 100) / 100, height: 8)
                    .animation(NeonMotion.resolved(NeonMotion.fill), value: completionPercent)
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
                ToggleRow(L("Show Execution Pricing"), detail: L("Hide entirely until the proposal is ready."), symbol: "banknote.fill", isOn: $showPricing)
                ToggleRow(L("Show Detailed Pricing Breakdown"), detail: L("Otherwise only the total is shown."), symbol: "list.bullet.rectangle.fill", isOn: $showDetailedPricing)
                ToggleRow(L("Show BOQ Quantities"), symbol: "number.square.fill", isOn: $showBoqQuantities)
                ToggleRow(L("Show BOQ Unit Prices"), symbol: "tag.fill", isOn: $showBoqPrices)
                ToggleRow(L("Allow File Downloads"), detail: L("Drawings, documents and the handover package."), symbol: "arrow.down.circle.fill", isOn: $allowDownloads)
                ToggleRow(L("Enable Watermark"), detail: L("Overlays “NEON DESIGN — CONFIDENTIAL” on renders."), symbol: "drop.fill", isOn: $watermarkEnabled)
            }
        }
        .neonSheet([.large])
        .shake(attempts)
        .task { await loadSellers() }
    }

    /// The cover as the client's page leads with it: the photo wide, with
    /// Replace and Remove on the photo itself. Remove shows the page without
    /// a cover at once, with Undo; nothing is removed until Save.
    @ViewBuilder
    private var coverField: some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
        let showsNone = removeCover && coverUpload == nil
        let hasCover = coverUpload != nil || (detail.coverImageUrl != nil && !removeCover)
        VStack(alignment: .leading, spacing: NeonSpace.md) {
            ZStack {
                if showsNone || !hasCover {
                    VStack(spacing: 8) {
                        IconTile("photo.on.rectangle.angled", hue: .grey, size: 44)
                        Text(L("No cover — the page opens on the brand colours"))
                            .font(.neonSubtitle)
                            .foregroundStyle(Color.neonTextSecondary)
                            .multilineTextAlignment(.center)
                        if showsNone {
                            NeonButton(L("Undo"), symbol: "arrow.uturn.backward", kind: .ghost, size: .small) {
                                withNeonAnimation(NeonMotion.gentle) { removeCover = false }
                            }
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(NeonHue.grey.wash)
                } else if let coverPreview {
                    coverPreview.resizable().aspectRatio(contentMode: .fill)
                } else {
                    RemoteImage(url: detail.resolvedCoverURL, contentMode: .fill, placeholderSymbol: "photo.on.rectangle.angled")
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 170)
            .clipShape(shape)
            .overlay(alignment: .bottomTrailing) {
                HStack(spacing: NeonSpace.sm) {
                    if hasCover {
                        Button {
                            Haptic.tap()
                            withNeonAnimation(NeonMotion.gentle) {
                                if coverUpload != nil {
                                    // The photo just picked goes; the saved one comes back.
                                    coverUpload = nil
                                    coverPreview = nil
                                    coverSelection = nil
                                } else {
                                    removeCover = true
                                }
                            }
                        } label: {
                            ProjectCoverCapsule(title: L("Remove"), symbol: "trash")
                        }
                        .buttonStyle(.pressable)
                    }
                    PhotosPicker(selection: $coverSelection, matching: .images) {
                        ProjectCoverCapsule(
                            title: hasCover ? L("Replace") : L("Upload cover image"),
                            symbol: "photo.badge.plus"
                        )
                    }
                    .buttonStyle(.pressable)
                }
                .padding(10)
            }
            .overlay(alignment: .topLeading) {
                if coverUpload != nil {
                    ProjectPhotoBadge(text: L("New"), symbol: "sparkles")
                        .padding(10)
                        .transition(.neonPop)
                }
            }
            .animation(NeonMotion.resolved(NeonMotion.gentle), value: showsNone)
        }
        .onChange(of: coverSelection) { item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let uiImage = UIImage(data: data) {
                    let scaled = uiImage.scaledDown(maxDimension: 2400)
                    if let jpeg = scaled.jpegData(compressionQuality: 0.85) {
                        withNeonAnimation(NeonMotion.gentle) {
                            coverUpload = UploadFile(field: "coverImage", filename: "cover.jpg", mimeType: "image/jpeg", data: jpeg)
                            coverPreview = Image(uiImage: scaled)
                            removeCover = false
                        }
                    }
                }
            }
        }
    }

    /// The area as typed; a number untouched keeps the words it was saved in.
    private var areaToSave: String {
        if areaIsText { return area }
        if areaNumber == projectAreaNumber(detail.area) { return detail.area ?? "" }
        return projectAreaValue(areaNumber)
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
            "area": areaToSave,
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

/// A frosted capsule laid on the cover photo.
private struct ProjectCoverCapsule: View {
    let title: String
    let symbol: String

    var body: some View {
        Label(title, systemImage: symbol)
            .font(.system(.footnote, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .frame(minHeight: 34)
            .background(.ultraThinMaterial, in: Capsule())
            .background(Color.black.opacity(0.3), in: Capsule())
            .environment(\.colorScheme, .dark)
            .contentShape(Capsule())
    }
}
