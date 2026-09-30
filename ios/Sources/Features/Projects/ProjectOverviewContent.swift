import SwiftUI

/// The Overview tab: where the project stands, what it holds, the client,
/// the details and what the client is allowed to see — read as the manager's
/// own form shows them. What the client sees switches right here; the rest
/// is edited in EditProjectSheet.
struct ProjectOverviewContent: View {
    let detail: ProjectDetail
    var onEdit: () -> Void = {}
    var onOpenSection: (ProjectDetailView.DetailSection) -> Void = { _ in }
    /// After a switch is saved, so the page reloads what the server keeps.
    var onChanged: () -> Void = {}

    @EnvironmentObject var api: APIClient
    @Environment(\.openURL) private var openURL
    /// The switches as shown: the server's until one is flipped here.
    @State private var visibility: ProjectVisibility?
    @State private var savingVisibility = false

    // Five cards, not one stack of them: they become rows of the page's own
    // lazy stack, so each can be scrolled to (`-neonScroll client`).
    var body: some View {
        progressCard
            .id("progress")
        figures
            .id("figures")
        clientCard
            .id("client")
        detailsCard
            .id("details")
        visibilityCard
            .id("visibility")
    }

    // MARK: - Where it stands

    private var stageIndex: Int? {
        projectStages.firstIndex(of: detail.currentStage)
    }

    /// Eight fixed stages: a bar of eight steps (done, current, still to
    /// come) and one line saying where it is and what comes next — nothing
    /// to scroll, no stage cut in half at the card's edge.
    private var progressCard: some View {
        SectionCard(L("Progress"), symbol: "chart.pie.fill", hue: .blue) {
            HStack(alignment: .center, spacing: NeonSpace.lg) {
                ProgressRing(progress: Double(detail.completionPercent) / 100, size: 76, lineWidth: 9)
                VStack(alignment: .leading, spacing: 8) {
                    Text(L("Completion"))
                        .font(.neonLabel)
                        .foregroundStyle(Color.neonTextSecondary)
                    ProjectStatusPill(status: detail.pipelineStatus)
                    if let date = formattedDay(detail.deliveryDate) {
                        MetaLabel(L("Delivery %@", date), symbol: "calendar")
                    }
                }
                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: NeonSpace.sm) {
                if let current = stageIndex {
                    SegmentedProgressBar(
                        projectStages.enumerated().map { index, stage in
                            ProgressSegment(
                                projectStageLabel(stage), value: 1,
                                hue: index < current ? .blue : (index == current ? .indigo : .grey),
                                id: stage
                            )
                        },
                        height: 8
                    )
                    .accessibilityHidden(true)
                }
                Text(stageLine)
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// "Stage 5 of 8 · BOQ — next: Pricing".
    private var stageLine: String {
        let label = projectStageLabel(detail.currentStage)
        guard let current = stageIndex else { return L("Stage: %@", label) }
        let position = L("Stage %d of %d", current + 1, projectStages.count)
        if let next = projectStages[safe: current + 1] {
            return L("%@ · %@ — next: %@", position, label, projectStageLabel(next))
        }
        return L("%@ · %@", position, label)
    }

    // MARK: - What it holds

    private var figures: some View {
        let photos = detail.allImages.count
        return StatGrid(columns: 4) {
            figure(L("Spaces"), value: detail.spaces.count, symbol: "square.split.2x2.fill", hue: .blue, opens: .gallery)
            figure(L("Photos"), value: photos, symbol: "photo.stack.fill", hue: .purple, opens: .gallery)
            figure(L("Approvals"), value: detail.count.approvals, symbol: "checkmark.seal.fill", hue: .orange, opens: .approvals)
            figure(L("Comments"), value: detail.count.comments, symbol: "bubble.left.fill", hue: .pink, opens: .comments)
        }
    }

    private func figure(_ title: String, value: Int, symbol: String, hue: NeonHue, opens target: ProjectDetailView.DetailSection) -> some View {
        Button {
            Haptic.tap()
            onOpenSection(target)
        } label: {
            KPICard(title, value: Double(value), symbol: symbol, hue: hue, density: .compact)
        }
        .buttonStyle(.pressableCard)
        .accessibilityHint(Text(L("Opens %@", target.label)))
    }

    // MARK: - The client

    /// The client's name, their number under it (it is also the call
    /// button), and their email. The project's type lives in Details.
    private var clientCard: some View {
        let phone = nonEmpty(detail.clientPhone)
        let email = nonEmpty(detail.clientEmail)
        return SectionCard(L("Client"), symbol: "person.crop.circle.fill", hue: .cyan) {
            HStack(spacing: NeonSpace.md) {
                AvatarView(url: nil, name: detail.clientName.isEmpty ? "?" : detail.clientName, size: 46, style: .solid)
                VStack(alignment: .leading, spacing: 2) {
                    DirText(detail.clientName.isEmpty ? L("No client name yet") : detail.clientName, font: .neonRowTitle, fill: false, lineLimit: 2)
                    if let phone {
                        // A number reads left to right in either language.
                        Text(verbatim: phone)
                            .font(.neonSubtitle)
                            .monospacedDigit()
                            .foregroundStyle(Color.neonTextSecondary)
                            .environment(\.layoutDirection, .leftToRight)
                            .textSelection(.enabled)
                            .accessibilityLabel(Text(L("Client Phone")))
                            .accessibilityValue(Text(verbatim: phone))
                    }
                }
                Spacer(minLength: 4)
                if let phone, let url = URL(string: "tel:\(phone.filter { $0.isNumber || $0 == "+" })") {
                    IconButton("phone.fill", label: L("Call"), look: .tinted, tint: .neonSuccessStrong, size: NeonSize.touch) { openURL(url) }
                }
                if let email, let url = URL(string: "mailto:\(email)") {
                    IconButton("envelope.fill", label: L("Email"), look: .tinted, tint: .neonBlueStrong, size: NeonSize.touch) { openURL(url) }
                }
            }

            if let email {
                KeyValueRow(L("Client Email"), value: email, symbol: "envelope", selectable: true)
            } else if phone == nil {
                Text(L("No email or phone number on file for this client."))
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextTertiary)
            }
        }
    }

    // MARK: - Details

    private var detailsCard: some View {
        SectionCard(
            L("Details"),
            symbol: "doc.text.fill",
            hue: .indigo,
            actionTitle: L("Edit"),
            actionChevron: false,
            action: onEdit
        ) {
            let rows = detailRows
            if rows.isEmpty && nonEmpty(detail.description) == nil {
                Text(L("No location, area, type or delivery date recorded yet."))
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextTertiary)
            } else if !rows.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                        if index > 0 { NeonDivider() }
                        KeyValueRow(row.label, value: row.value, symbol: row.symbol, userText: row.userText)
                    }
                }
            }

            if let description = nonEmpty(detail.description) {
                VStack(alignment: .leading, spacing: 6) {
                    SectionLabel(L("Description"))
                    DirText(description, font: .neonBody, color: .neonInk.opacity(0.86))
                }
                .padding(NeonSpace.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .neonSurface(.sunken, radius: NeonRadius.md)
            }
        }
    }

    private struct DetailRow {
        let label: String
        let value: String
        let symbol: String
        var userText = false
    }

    private var detailRows: [DetailRow] {
        var rows: [DetailRow] = []
        if let location = nonEmpty(detail.location) { rows.append(DetailRow(label: L("Location"), value: location, symbol: "mappin.and.ellipse", userText: true)) }
        if let area = nonEmpty(detail.area) { rows.append(DetailRow(label: L("Area"), value: projectAreaText(area), symbol: "ruler")) }
        if let type = nonEmpty(detail.projectType) { rows.append(DetailRow(label: L("Project Type"), value: type, symbol: "tag", userText: true)) }
        if let date = formattedDay(detail.deliveryDate) { rows.append(DetailRow(label: L("Delivery Date"), value: date, symbol: "calendar")) }
        if let soldOn = formattedDay(detail.soldOn) { rows.append(DetailRow(label: L("Sold on"), value: soldOn, symbol: "banknote")) }
        return rows
    }

    // MARK: - What the client sees

    /// Six real switches. Each flip is saved at once — all six go together,
    /// as the server's form takes them — and put back if the server refuses.
    private var visibilityCard: some View {
        let shown = visibility ?? ProjectVisibility(detail)
        return SectionCard(
            L("Client Visibility"),
            subtitle: L("What the client's page shows"),
            symbol: "eye.fill",
            hue: .purple
        ) {
            VStack(spacing: 0) {
                ForEach(Array(ProjectVisibility.Setting.allCases.enumerated()), id: \.element) { index, setting in
                    if index > 0 { NeonDivider() }
                    ToggleRow(
                        setting.title,
                        symbol: setting.symbol,
                        isOn: Binding(
                            get: { shown[setting] },
                            set: { on in flip(setting, to: on) }
                        )
                    )
                    .padding(.vertical, 2)
                }
            }
        }
        .onChange(of: ProjectVisibility(detail)) { _ in
            // A reload brings the server's word; take it unless a save is out.
            if !savingVisibility { visibility = nil }
        }
    }

    private func flip(_ setting: ProjectVisibility.Setting, to on: Bool) {
        var next = visibility ?? ProjectVisibility(detail)
        guard next[setting] != on else { return }
        next[setting] = on
        withNeonAnimation(NeonMotion.snappy) { visibility = next }
        // A save already out picks this up when it returns.
        if !savingVisibility { Task { await saveVisibility() } }
    }

    /// One save at a time; a flip made while one is out goes in the next,
    /// so the last thing the server hears is what the screen shows.
    private func saveVisibility() async {
        savingVisibility = true
        defer { savingVisibility = false }
        var confirmed = ProjectVisibility(detail)
        while let wanted = visibility, wanted != confirmed {
            do {
                try await api.updateProjectSettings(id: detail.id, fields: wanted.fields)
                confirmed = wanted
            } catch {
                Haptic.error()
                Toast.error(error)
                withNeonAnimation(NeonMotion.snappy) { visibility = confirmed }
                return
            }
        }
        onChanged()
    }

    private func nonEmpty(_ text: String?) -> String? {
        guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }
}

/// The six switches of what a client's page shows, as the server keeps them.
struct ProjectVisibility: Equatable {
    enum Setting: String, CaseIterable {
        case showPricing, showDetailedPricing, showBoqQuantities, showBoqPrices, allowDownloads, watermarkEnabled

        var title: String {
            switch self {
            case .showPricing: return L("Execution Pricing")
            case .showDetailedPricing: return L("Detailed Pricing Breakdown")
            case .showBoqQuantities: return L("BOQ Quantities")
            case .showBoqPrices: return L("BOQ Unit Prices")
            case .allowDownloads: return L("File Downloads")
            case .watermarkEnabled: return L("Watermark")
            }
        }

        var symbol: String {
            switch self {
            case .showPricing: return "banknote.fill"
            case .showDetailedPricing: return "list.bullet.rectangle.fill"
            case .showBoqQuantities: return "number.square.fill"
            case .showBoqPrices: return "tag.fill"
            case .allowDownloads: return "arrow.down.circle.fill"
            case .watermarkEnabled: return "drop.fill"
            }
        }
    }

    private var values: [Setting: Bool]

    init(_ detail: ProjectDetail) {
        values = [
            .showPricing: detail.showPricing,
            .showDetailedPricing: detail.showDetailedPricing,
            .showBoqQuantities: detail.showBoqQuantities,
            .showBoqPrices: detail.showBoqPrices,
            .allowDownloads: detail.allowDownloads,
            .watermarkEnabled: detail.watermarkEnabled,
        ]
    }

    subscript(setting: Setting) -> Bool {
        get { values[setting] ?? false }
        set { values[setting] = newValue }
    }

    /// Every switch, as `updateProjectSettings` sends them.
    var fields: [String: Bool] {
        Dictionary(uniqueKeysWithValues: Setting.allCases.map { ($0.rawValue, self[$0]) })
    }
}
