import SwiftUI

/// The Overview tab: where the project stands, what it holds, the client,
/// the details and what the client is allowed to see — read as the manager's
/// own form shows them. Editing happens in EditProjectSheet.
struct ProjectOverviewContent: View {
    let detail: ProjectDetail
    var onEdit: () -> Void = {}
    var onOpenSection: (ProjectDetailView.DetailSection) -> Void = { _ in }

    @Environment(\.openURL) private var openURL

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

    private var stageIndex: Int {
        projectStages.firstIndex(of: detail.currentStage) ?? 0
    }

    private var progressCard: some View {
        SectionCard(
            L("Progress"),
            subtitle: L("Stage: %@", projectStageLabel(detail.currentStage)),
            symbol: "chart.pie.fill",
            hue: .blue
        ) {
            HStack(alignment: .center, spacing: NeonSpace.lg) {
                ProgressRing(progress: Double(detail.completionPercent) / 100, size: 76, lineWidth: 9)
                VStack(alignment: .leading, spacing: 8) {
                    Text(L("Completion"))
                        .font(.neonLabel)
                        .foregroundStyle(Color.neonTextSecondary)
                    ProjectStatusPill(status: detail.pipelineStatus, live: true)
                    if let date = formattedDay(detail.deliveryDate) {
                        MetaLabel(L("Delivery %@", date), symbol: "calendar")
                    }
                }
                Spacer(minLength: 0)
            }
            StageTrack(stages: projectStages.map { projectStageLabel($0) }, current: stageIndex, tint: .neonBlue)
                .padding(.horizontal, -NeonSpace.xs)
        }
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

    private var clientCard: some View {
        SectionCard(L("Client"), symbol: "person.crop.circle.fill", hue: .cyan) {
            HStack(spacing: NeonSpace.md) {
                AvatarView(url: nil, name: detail.clientName.isEmpty ? "?" : detail.clientName, size: 46, style: .solid)
                VStack(alignment: .leading, spacing: 2) {
                    DirText(detail.clientName.isEmpty ? L("No client name yet") : detail.clientName, font: .neonRowTitle, fill: false, lineLimit: 2)
                    if let type = nonEmpty(detail.projectType) {
                        DirText(type, font: .neonSubtitle, color: .neonTextSecondary, fill: false, lineLimit: 1)
                    }
                }
                Spacer(minLength: 4)
                if let phone = nonEmpty(detail.clientPhone), let url = URL(string: "tel:\(phone.filter { $0.isNumber || $0 == "+" })") {
                    IconButton("phone.fill", label: L("Call"), look: .tinted, tint: .neonSuccessStrong, size: 38) { openURL(url) }
                }
                if let email = nonEmpty(detail.clientEmail), let url = URL(string: "mailto:\(email)") {
                    IconButton("envelope.fill", label: L("Email"), look: .tinted, tint: .neonBlueStrong, size: 38) { openURL(url) }
                }
            }

            if nonEmpty(detail.clientEmail) != nil || nonEmpty(detail.clientPhone) != nil {
                VStack(spacing: 0) {
                    if let email = nonEmpty(detail.clientEmail) {
                        KeyValueRow(L("Client Email"), value: email, symbol: "envelope", selectable: true)
                    }
                    if let phone = nonEmpty(detail.clientPhone) {
                        if nonEmpty(detail.clientEmail) != nil { NeonDivider() }
                        KeyValueRow(L("Client Phone"), value: phone, symbol: "phone", selectable: true)
                    }
                }
            } else {
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
        if let area = nonEmpty(detail.area) { rows.append(DetailRow(label: L("Area"), value: area, symbol: "ruler")) }
        if let type = nonEmpty(detail.projectType) { rows.append(DetailRow(label: L("Project Type"), value: type, symbol: "tag", userText: true)) }
        if let date = formattedDay(detail.deliveryDate) { rows.append(DetailRow(label: L("Delivery Date"), value: date, symbol: "calendar")) }
        if let soldOn = formattedDay(detail.soldOn) { rows.append(DetailRow(label: L("Sold on"), value: soldOn, symbol: "banknote")) }
        return rows
    }

    // MARK: - What the client sees

    private var visibilityCard: some View {
        SectionCard(
            L("Client Visibility"),
            subtitle: L("What the client's page shows"),
            symbol: "eye.fill",
            hue: .purple,
            actionTitle: L("Edit"),
            actionChevron: false,
            action: onEdit
        ) {
            VStack(spacing: 0) {
                visibilityRow(L("Execution Pricing"), symbol: "banknote.fill", on: detail.showPricing)
                NeonDivider()
                visibilityRow(L("Detailed Pricing Breakdown"), symbol: "list.bullet.rectangle.fill", on: detail.showDetailedPricing)
                NeonDivider()
                visibilityRow(L("BOQ Quantities"), symbol: "number.square.fill", on: detail.showBoqQuantities)
                NeonDivider()
                visibilityRow(L("BOQ Unit Prices"), symbol: "tag.fill", on: detail.showBoqPrices)
                NeonDivider()
                visibilityRow(L("File Downloads"), symbol: "arrow.down.circle.fill", on: detail.allowDownloads)
                NeonDivider()
                visibilityRow(L("Watermark"), symbol: "drop.fill", on: detail.watermarkEnabled)
            }
        }
    }

    @ViewBuilder
    private func visibilityRow(_ title: String, symbol: String, on: Bool) -> some View {
        HStack(spacing: NeonSpace.md) {
            IconTile(symbol, hue: on ? .purple : .grey, size: 30)
            Text(title)
                .font(.system(.subheadline, weight: .medium))
                .foregroundStyle(on ? Color.neonInk : Color.neonTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            HStack(spacing: 4) {
                Image(systemName: on ? "checkmark" : "minus")
                    .font(.system(.caption2, weight: .heavy))
                Text(on ? L("On") : L("Off"))
            }
            .font(.system(.caption, weight: .semibold))
            .foregroundStyle(on ? Color.neonSuccessStrong : Color.neonTextTertiary)
            .padding(.horizontal, 9)
            .padding(.vertical, 4.5)
            .background(Capsule().fill(on ? NeonHue.green.wash : NeonHue.grey.wash))
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
    }

    private func nonEmpty(_ text: String?) -> String? {
        guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }
}
