import SwiftUI

// Milestones the client approves or asks changes on — the web's approvals
// tab (src/app/admin/(dashboard)/projects/[id]/approvals/page.tsx). The
// studio only creates and removes milestones here; the response is the
// client's, on their own page.

struct ProjectApprovalsSection: View {
    let projectId: String

    @EnvironmentObject private var api: APIClient
    @State private var approvals: [PFApproval]?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var showAdd = false
    @State private var toDelete: PFApproval?

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.lg) {
            pfSectionHeader(
                L("Approvals"), subtitle: headerSubtitle, section: .approvals,
                addTitle: L("Add Milestone"), showAdd: !(approvals?.isEmpty ?? true)
            ) { showAdd = true }

            LoadStateView(value: approvals, error: errorMessage, cachedAt: cachedAt, retry: load) { rows in
                if rows.isEmpty {
                    EmptyState(
                        symbol: PFSection.approvals.symbol,
                        title: L("No approval milestones yet"),
                        detail: L("Add design milestones for the client to review."),
                        actionTitle: L("Add Milestone"),
                        action: { showAdd = true },
                        hue: PFSection.approvals.hue,
                        card: true
                    )
                } else {
                    CardList(rows) { approval in
                        ListRow(
                            approval.itemLabel,
                            subtitle: approval.note.map { "\u{201c}\($0)\u{201d}" },
                            meta: [approval.clientName, formattedISODate(approval.respondedAt)].compactMap { $0 }.joined(separator: " · "),
                            leading: .icon(PFSection.approvals.symbol, tint: approvalStatusTone(approval.status).color),
                            badge: approvalStatusLabel(approval.status),
                            badgeTone: approvalStatusTone(approval.status)
                        ) {
                            IconButton("trash", label: L("Delete"), look: .plain, tint: .neonDangerStrong, size: NeonSize.touch) {
                                toDelete = approval
                            }
                        }
                    }
                    .neonAppear()
                }
            }
        }
        .task { await load() }
        .sheet(isPresented: $showAdd) {
            AddApprovalSheet(projectId: projectId) { Haptic.success(); Toast.success(L("Milestone added")); Task { await load() } }
        }
        .confirmDestructive(item: $toDelete, title: { L("Delete “%@”?", $0.itemLabel) }, actionTitle: L("Delete")) { approval in
            Task { await delete(approval) }
        }
    }

    private var headerSubtitle: String {
        guard let approvals, !approvals.isEmpty else { return L("Design milestones for the client to review") }
        let waiting = approvals.filter { $0.status != "APPROVED" && $0.status != "CHANGES_REQUESTED" }.count
        return waiting > 0 ? L("%d waiting on the client", waiting) : L("%d milestones", approvals.count)
    }

    private func load() async {
        do {
            let loaded = try await api.fetchApprovals(projectId: projectId)
            approvals = loaded.value.approvals
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func delete(_ approval: PFApproval) async {
        do {
            try await api.deleteApproval(projectId: projectId, id: approval.id)
            Haptic.success()
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

struct AddApprovalSheet: View {
    let projectId: String
    let onSaved: () -> Void

    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var itemLabel = ""
    @State private var error: String?

    private var isValid: Bool { !itemLabel.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        SheetScaffold(L("Add Milestone"), symbol: PFSection.approvals.symbol, primaryTitle: L("Add Milestone"), isPrimaryEnabled: isValid) {
            await save()
        } content: {
            FormSection(footer: L("The client sees this on their page and can approve it or ask for changes.")) {
                NeonTextField(L("Milestone for client approval"), text: $itemLabel, prompt: L("Living Room Design"), isRequired: true)
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.medium])
    }

    private func save() async {
        do {
            try await api.createApproval(projectId: projectId, itemLabel: itemLabel)
            dismiss()
            onSaved()
        } catch {
            self.error = error.localizedDescription
            Toast.error(error)
        }
    }
}
