import SwiftUI

/// A project's page — overview, gallery and analytics are this area's own;
/// the other tabs embed the projectfiles area's sections unchanged. Pushed
/// from the list (both sides work a project the same way).
struct ProjectDetailView: View {
    let projectId: String
    var seed: ProjectSummary?

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var detail: ProjectDetail?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var section: DetailSection = .overview
    @State private var showEdit = false
    @State private var showDeleteConfirm = false

    enum DetailSection: String, CaseIterable {
        case overview, gallery, drawings, boq, pricing, materials, furniture, documents, approvals, comments, analytics

        var label: String {
            switch self {
            case .overview: return L("Overview")
            case .gallery: return L("Gallery")
            case .drawings: return L("Drawings")
            case .boq: return L("BOQ")
            case .pricing: return L("Pricing")
            case .materials: return L("Materials")
            case .furniture: return L("Furniture")
            case .documents: return L("Documents")
            case .approvals: return L("Approvals")
            case .comments: return L("Comments")
            case .analytics: return L("Analytics")
            }
        }

        var symbol: String {
            switch self {
            case .overview: return "info.circle"
            case .gallery: return "photo.on.rectangle"
            case .drawings: return "pencil.and.ruler"
            case .boq: return "list.number"
            case .pricing: return "banknote"
            case .materials: return "square.stack.3d.up"
            case .furniture: return "sofa"
            case .documents: return "doc.text"
            case .approvals: return "checkmark.seal"
            case .comments: return "bubble.left.and.bubble.right"
            case .analytics: return "chart.bar"
            }
        }
    }

    var body: some View {
        Group {
            if let detail {
                page(detail)
            } else if let errorMessage {
                ErrorState(message: errorMessage) { await load() }
            } else {
                NeonScroll { SkeletonRows(count: 5) }
            }
        }
        .neonAmbientBackground()
        .navigationTitle(detail?.name ?? seed?.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if detail != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { showEdit = true } label: { Label(L("Edit"), systemImage: "pencil") }
                        if api.side == .admin {
                            Button(role: .destructive) { showDeleteConfirm = true } label: {
                                Label(L("Delete Project"), systemImage: "trash")
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .foregroundStyle(Color.neonInk)
                }
            }
        }
        .sheet(isPresented: $showEdit) {
            if let detail {
                EditProjectSheet(detail: detail) { Task { await load() } }
            }
        }
        .confirmDestructive(
            L("Delete this project?"),
            message: L("“%@” and every file it holds — cover, renders, drawings, documents, materials, furniture — is deleted for good. This cannot be undone.", detail?.name ?? ""),
            actionTitle: L("Delete"),
            isPresented: $showDeleteConfirm
        ) { Task { await deleteProject() } }
        .task { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .neonDataChanged)) { note in
            if let name = note.object as? String, name.hasPrefix("projects/") { Task { await load(silently: true) } }
        }
    }

    @ViewBuilder
    private func page(_ detail: ProjectDetail) -> some View {
        NeonScroll(spacing: 14) {
            HeroHeader(
                detail.name,
                subtitle: detail.clientName,
                eyebrow: L("Project"),
                imageURL: detail.resolvedCoverURL
            ) {
                HStack(spacing: 6) {
                    StateBadge(localizedEnum("pipeline", detail.pipelineStatus), tone: .purple)
                    BadgeView(text: localizedEnum("publish", detail.publishState), tone: publishTone(detail.publishState))
                }
            }

            if let cachedAt { OfflineBanner(savedAt: cachedAt) }

            publishRow(detail)
            linkRow(detail)

            FilterChips(selection: $section, options: DetailSection.allCases, inset: 16, title: { $0.label }, symbol: { $0.symbol })
                .padding(.horizontal, -16)

            sectionContent(detail)
                .id(section)
                .transition(.neonRise)
        }
        .refreshable { await load() }
        .animation(.easeOut(duration: 0.22), value: section)
    }

    @ViewBuilder
    private func sectionContent(_ detail: ProjectDetail) -> some View {
        switch section {
        case .overview: ProjectOverviewContent(detail: detail)
        case .gallery: ProjectGalleryView(projectId: detail.id, spaces: detail.spaces, onChanged: { Task { await load(silently: true) } })
        case .drawings: ProjectDrawingsSection(projectId: detail.id)
        case .boq: ProjectBoqSection(projectId: detail.id)
        case .pricing: ProjectPricingSection(projectId: detail.id)
        case .materials: ProjectMaterialsSection(projectId: detail.id)
        case .furniture: ProjectFurnitureSection(projectId: detail.id)
        case .documents: ProjectDocumentsSection(projectId: detail.id)
        case .approvals: ProjectApprovalsSection(projectId: detail.id)
        case .comments: ProjectCommentsSection(projectId: detail.id)
        case .analytics: ProjectAnalyticsView(projectId: detail.id)
        }
    }

    @ViewBuilder
    private func publishRow(_ detail: ProjectDetail) -> some View {
        HStack(spacing: 8) {
            if detail.publishState != "PUBLISHED" {
                NeonButton(L("Publish Project"), symbol: "checkmark.seal.fill", size: .small) {
                    await setPublish("PUBLISHED")
                }
            } else {
                NeonButton(L("Unpublish"), kind: .secondary, size: .small) {
                    await setPublish("DRAFT")
                }
            }
            if detail.publishState != "ARCHIVED" {
                NeonButton(
                    L("Archive"), kind: .ghost, size: .small,
                    confirm: L("Archive this project?"), confirmMessage: L("It will be hidden from the client link.")
                ) {
                    await setPublish("ARCHIVED")
                }
            }
            Spacer()
        }
    }

    @ViewBuilder
    private func linkRow(_ detail: ProjectDetail) -> some View {
        if let link = detail.clientLink {
            NeonCard(padding: 10) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        Text(link.absoluteString)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(Color.neonTextSecondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer()
                    }
                    FlowRow {
                        NeonButton(L("Copy Link"), symbol: "doc.on.doc", kind: .secondary, size: .small) {
                            UIPasteboard.general.string = link.absoluteString
                            Haptic.soft()
                            Toast.info(L("Copied"), detail: link.absoluteString)
                        }
                        ShareLink(item: link) {
                            Label(L("Preview"), systemImage: "arrow.up.right.square")
                        }
                        .buttonStyle(.neon(.secondary, size: .small))
                        NeonButton(L("Send to Client"), symbol: "paperplane.fill", kind: .tinted(.neonSuccessStrong), size: .small) {
                            await send(kind: "sent_to_client")
                        }
                        NeonButton(L("Send Update"), symbol: "bell.badge.fill", kind: .tinted(.neonInfoStrong), size: .small) {
                            await send(kind: "sent_update")
                        }
                        NeonButton(
                            L("Regenerate"), symbol: "arrow.clockwise", kind: .ghost, size: .small,
                            confirm: L("Regenerate this project's link?"),
                            confirmMessage: L("The old link stops working immediately.")
                        ) {
                            await regenerateLink()
                        }
                    }
                }
            }
        }
    }

    private func load(silently: Bool = false) async {
        do {
            let loaded = try await api.fetchProjectDetail(id: projectId)
            withAnimation(.easeOut(duration: 0.3)) {
                detail = loaded.value
                cachedAt = loaded.cachedAt
            }
            errorMessage = nil
        } catch {
            if !silently && detail == nil { errorMessage = error.localizedDescription }
        }
    }

    private func setPublish(_ state: String) async {
        do {
            try await api.setPublishState(id: projectId, state: state)
            Haptic.success()
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func regenerateLink() async {
        do {
            try await api.regenerateProjectLink(id: projectId)
            Haptic.success()
            Toast.success(L("Link regenerated"))
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func send(kind: String) async {
        do {
            let outcome = try await api.sendProjectWhatsApp(id: projectId, kind: kind)
            if outcome?.ok == false { Toast.warning(outcome?.message ?? L("Nothing was sent")) }
            else {
                Haptic.success()
                Toast.success(outcome?.message ?? L("Sent"))
            }
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func deleteProject() async {
        do {
            try await api.deleteProject(id: projectId)
            Haptic.success()
            Toast.success(L("Project deleted"))
            dismiss()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}
