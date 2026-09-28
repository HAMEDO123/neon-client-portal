import SwiftUI

/// What the team sends in: their account of the day, and things they have
/// asked to buy. Mirrors admin/(dashboard)/requests. Pushed from More, so no
/// `NavigationStack` of its own.
struct RequestsRootView: View {
    @EnvironmentObject var api: APIClient
    @State private var requests: OpsRequests?
    @State private var errorMessage: String?
    @State private var cachedAt: Date?
    @State private var deciding: (request: SupplyRequest, status: String)?

    var body: some View {
        NeonScroll {
            LoadStateView(value: requests, error: errorMessage, cachedAt: cachedAt, retry: load) { data in
                SectionHeader(L("Today's reports"), count: data.reports.count)
                if data.team.isEmpty {
                    EmptyState(symbol: "note.text", title: L("No team yet"))
                } else {
                    ForEach(data.team) { member in
                        ReportCard(member: member, report: reportBy(data)[member.id])
                    }
                }

                SectionHeader(L("Waiting for you"), count: data.pending.count)
                if data.pending.isEmpty {
                    EmptyState(symbol: "shippingbox", title: L("Nothing waiting"), detail: L("New requests appear here."))
                } else {
                    ForEach(data.pending) { request in
                        SupplyRequestCard(request: request) { status in deciding = (request, status) }
                    }
                }

                if !data.decided.isEmpty {
                    SectionHeader(L("Decided"), count: data.decided.count)
                    CardList(data.decided) { request in
                        ListRow(
                            request.item,
                            subtitle: request.employee.name,
                            meta: request.decidedAt.flatMap(formattedISODate),
                            badge: supplyStatusLabel(request.status),
                            badgeTone: supplyStatusTone(request.status)
                        )
                        .contextMenu {
                            if request.status == "APPROVED" {
                                Button { deciding = (request, "PURCHASED") } label: { Label(L("Mark bought"), systemImage: "checkmark.circle") }
                            }
                        }
                    }
                }
            }
        }
        .refreshable { await load() }
        .navigationTitle(L("Requests"))
        .neonAmbientBackground()
        .sheet(item: Binding(
            get: { deciding.map { DecisionSheetItem(request: $0.request, status: $0.status) } },
            set: { if $0 == nil { deciding = nil } }
        )) { item in
            DecideSupplyRequestSheet(request: item.request, status: item.status) { await load() }
        }
        .task { await load() }
    }

    private func reportBy(_ data: OpsRequests) -> [String: OpsRequests.DailyReportEntry] {
        Dictionary(data.reports.map { ($0.employeeId, $0) }, uniquingKeysWith: { a, _ in a })
    }

    private func load() async {
        do {
            let loaded = try await api.opsRequests()
            requests = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct DecisionSheetItem: Identifiable {
    let request: SupplyRequest
    let status: String
    var id: String { request.id + status }
}

// MARK: - Today's reports

private struct ReportCard: View {
    let member: OpsRequests.TeamMember
    let report: OpsRequests.DailyReportEntry?

    var body: some View {
        NeonCard {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(member.name).font(.neonHeadline)
                    if let role = member.role { Text(role).font(.neonFootnote).foregroundStyle(Color.neonTextTertiary) }
                }
                Spacer()
                if let report { Text(shortTime(report.updatedAt) ?? "").font(.neonCaption).foregroundStyle(Color.neonTextFaint) }
            }
            if let report {
                DirText(report.text, font: .neonSubheadline, color: .neonTextSecondary)
            } else {
                Text(L("Hasn't written today's report yet."))
                    .font(.neonSubheadline)
                    .foregroundStyle(Color.neonTextFaint)
            }
        }
    }
}

// MARK: - Supply requests

private struct SupplyRequestCard: View {
    let request: SupplyRequest
    let onDecide: (String) -> Void

    var body: some View {
        NeonCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        DirText(request.item, font: .neonHeadline)
                        if let quantity = request.quantity { Text(quantity).font(.neonFootnote).foregroundStyle(Color.neonTextTertiary) }
                        if request.urgent { BadgeView(text: L("Urgent"), tone: .pink) }
                    }
                    Text("\(request.employee.name)\(request.employee.role.map { " · \($0)" } ?? "") · \(formattedISODate(request.createdAt) ?? "")")
                        .font(.neonFootnote)
                        .foregroundStyle(Color.neonTextTertiary)
                    if let note = request.note { DirText(note, font: .neonSubheadline, color: .neonTextSecondary) }
                }
                Spacer()
                if let cost = request.estimatedCost {
                    Text("≈ \(NeonFormat.money(cost, decimals: 2))").font(.neonSubheadline).foregroundStyle(Color.neonTextSecondary)
                }
            }

            HStack(spacing: 10) {
                NeonButton(L("Approve"), symbol: "checkmark", kind: .tinted(.neonSuccessStrong), size: .medium) { onDecide("APPROVED") }
                NeonButton(L("Decline"), symbol: "xmark", kind: .secondary, size: .medium) { onDecide("REJECTED") }
            }
        }
    }
}

private struct DecideSupplyRequestSheet: View {
    let request: SupplyRequest
    let status: String
    let onDecided: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var error: String?

    var body: some View {
        SheetScaffold(
            title,
            subtitle: request.item,
            symbol: status == "APPROVED" ? "checkmark.circle" : "xmark.circle",
            primaryTitle: title,
            primaryKind: status == "REJECTED" ? .destructive : .primary
        ) {
            do {
                try await api.opsDecideSupplyRequest(id: request.id, status: status, decisionNote: note)
                Toast.success(L("Saved"))
                dismiss()
                await onDecided()
            } catch {
                self.error = error.localizedDescription
            }
        } content: {
            FormSection {
                NeonTextEditor(L("Note for the employee (optional)"), text: $note, minLines: 2, maxLines: 5)
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.medium])
    }

    private var title: String { status == "APPROVED" ? L("Approve") : status == "REJECTED" ? L("Decline") : L("Mark bought") }
}
