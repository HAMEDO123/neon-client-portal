import SwiftUI

/// The Overview tab: every field of the project, read as the manager's own
/// form shows them. Editing happens in EditProjectSheet, from the toolbar.
struct ProjectOverviewContent: View {
    let detail: ProjectDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if detail.completionPercent > 0 {
                NeonCard {
                    HStack {
                        Text(L("Completion"))
                            .font(.neonSubheadline)
                            .foregroundStyle(Color.neonTextSecondary)
                        Spacer()
                        Text(NeonFormat.percent(Double(detail.completionPercent)))
                            .font(.neonHeadline)
                    }
                    ProgressBar(progress: Double(detail.completionPercent) / 100, height: 8)
                }
            }

            NeonCard {
                SectionLabel(L("Client"))
                KeyValueRow(L("Client Name"), value: detail.clientName, userText: true, selectable: true)
                if let email = detail.clientEmail, !email.isEmpty {
                    KeyValueRow(L("Client Email"), value: email, symbol: "envelope", selectable: true)
                }
                if let phone = detail.clientPhone, !phone.isEmpty {
                    KeyValueRow(L("Client Phone"), value: phone, symbol: "phone", selectable: true)
                }
                if let date = detail.deliveryDate, let parsed = parseISODate(date) {
                    KeyValueRow(L("Delivery Date"), value: NeonFormat.date(parsed), symbol: "calendar")
                }
            }

            NeonCard {
                SectionLabel(L("Details"))
                if let location = detail.location, !location.isEmpty {
                    KeyValueRow(L("Location"), value: location, symbol: "mappin.and.ellipse", userText: true)
                }
                if let area = detail.area, !area.isEmpty {
                    KeyValueRow(L("Area"), value: area, symbol: "ruler")
                }
                if let type = detail.projectType, !type.isEmpty {
                    KeyValueRow(L("Project Type"), value: type, symbol: "tag", userText: true)
                }
                KeyValueRow(L("Stage"), value: localizedEnum("stage", detail.currentStage), symbol: "flag")
                if let description = detail.description, !description.isEmpty {
                    DetailCard(title: L("Description"), symbol: "text.alignleft") {
                        DirText(description)
                    }
                }
            }

            NeonCard {
                SectionLabel(L("Client Visibility"))
                visibilityRow(L("Execution Pricing"), on: detail.showPricing)
                visibilityRow(L("Detailed Pricing Breakdown"), on: detail.showDetailedPricing)
                visibilityRow(L("BOQ Quantities"), on: detail.showBoqQuantities)
                visibilityRow(L("BOQ Unit Prices"), on: detail.showBoqPrices)
                visibilityRow(L("File Downloads"), on: detail.allowDownloads)
                visibilityRow(L("Watermark"), on: detail.watermarkEnabled)
            }

            if detail.count.approvals > 0 || detail.count.comments > 0 {
                StatGrid {
                    StatTile(L("Approvals"), value: Double(detail.count.approvals), symbol: "checkmark.seal")
                    StatTile(L("Comments"), value: Double(detail.count.comments), symbol: "bubble.left")
                }
            }
        }
    }

    @ViewBuilder
    private func visibilityRow(_ title: String, on: Bool) -> some View {
        HStack {
            Text(title).font(.neonCallout).foregroundStyle(Color.neonText)
            Spacer()
            Image(systemName: on ? "checkmark.circle.fill" : "circle.slash")
                .foregroundStyle(on ? Color.neonSuccessStrong : Color.neonTextTertiary)
        }
    }
}
