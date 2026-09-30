import SwiftUI

/// A project's page — overview, gallery and analytics are this area's own;
/// the other tabs embed the projectfiles area's sections unchanged. Pushed
/// from the list (both sides work a project the same way).
struct ProjectDetailView: View {
    let projectId: String
    var seed: ProjectSummary?

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var detail: ProjectDetail?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var section: DetailSection
    @State private var showEdit = false
    @State private var showDeleteConfirm = false
    @State private var confirmRegenerate = false
    @State private var sending: String?
    /// The send waiting on its confirmation: "sent_to_client" or "sent_update".
    @State private var confirmSend: String?
    /// The hero has gone under the bar and the tabs have pinned: the bar
    /// takes the name and a background.
    @State private var heroGone = false

    /// `initialSection` opens the page on a tab other than Overview — a deep
    /// link to a project's gallery or files.
    init(projectId: String, seed: ProjectSummary? = nil, initialSection: DetailSection = .overview) {
        self.projectId = projectId
        self.seed = seed
        _section = State(initialValue: initialSection)
    }

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
        ScrollViewReader { proxy in
            // NeonScroll's stack, with the tabs as a pinned section header —
            // they stay under the bar however far down a gallery goes.
            ScrollView {
                LazyVStack(alignment: .leading, spacing: NeonSpace.stack, pinnedViews: [.sectionHeaders]) {
                    hero
                        .id("hero")
                        .background(ProjectPageMark(name: "hero", edge: .bottom))

                    if let detail {
                        Section {
                            sectionContent(detail)
                        } header: {
                            sectionTabs(detail)
                                .id("sections")
                        }
                    } else if let errorMessage {
                        ErrorState(message: errorMessage) { await load() }
                    } else {
                        SkeletonCard(lines: 4)
                        SkeletonCard(lines: 3)
                    }
                }
                .padding(NeonSpace.gutter)
                .padding(.bottom, NeonSpace.xxl)
            }
            .scrollDismissesKeyboard(.interactively)
            .neonAmbientBackground()
            .onPreferenceChange(ProjectPageMarks.self) { marks in
                // Pinned once the hero's bottom has passed above the tabs;
                // a hero the lazy stack has let go of is far above.
                guard let tabs = marks["sections"] else { return }
                let gone = (marks["hero"].map { tabs - $0 > NeonSpace.stack + 2 }) ?? true
                if gone != heroGone { heroGone = gone }
            }
            .onChange(of: section) { _ in
                withNeonAnimation(NeonMotion.snappy) { proxy.scrollTo("sections", anchor: .top) }
            }
            .refreshable { await load() }
            .debugScroll(proxy)
        }
        // The name moves to the bar only once the hero's own has gone.
        .navigationTitle(heroGone ? (detail?.name ?? seed?.name ?? "") : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.neonSurfaceStrong, for: .navigationBar)
        .toolbarBackground(heroGone ? .visible : .automatic, for: .navigationBar)
        .toolbar {
            if let detail {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { showEdit = true } label: { Label(L("Edit"), systemImage: "pencil") }
                        if detail.clientLink != nil {
                            Button(role: .destructive) {
                                Haptic.warning()
                                confirmRegenerate = true
                            } label: {
                                Label(L("Regenerate Link"), systemImage: "arrow.triangle.2.circlepath")
                            }
                        }
                        if api.side == .admin {
                            Divider()
                            Button(role: .destructive) { showDeleteConfirm = true } label: {
                                Label(L("Delete Project"), systemImage: "trash")
                            }
                        }
                    } label: {
                        // The bar draws its own glass around a plain glyph.
                        Image(systemName: "ellipsis")
                            .font(.system(.body, weight: .semibold))
                    }
                    .accessibilityLabel(Text(L("More")))
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
        .confirmDestructive(
            L("Regenerate this project's link?"),
            message: L("The old link stops working immediately."),
            actionTitle: L("Regenerate"),
            isPresented: $confirmRegenerate
        ) { Task { await regenerateLink() } }
        .confirmationDialog(
            confirmSend.map(sendTitle) ?? "",
            isPresented: Binding(get: { confirmSend != nil }, set: { if !$0 { confirmSend = nil } }),
            titleVisibility: .visible,
            presenting: confirmSend
        ) { kind in
            Button(L("Send on WhatsApp")) { Task { await send(kind: kind) } }
            Button(L("Cancel"), role: .cancel) {}
        } message: { kind in
            Text(sendPreview(kind))
        }
        .task { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .neonDataChanged)) { note in
            if let name = note.object as? String, name.hasPrefix("projects/") { Task { await load(silently: true) } }
        }
    }

    // MARK: - Hero

    /// The cover and the name come from the list's row at once, so the page
    /// opens on its picture instead of a skeleton. The area's own hero (the
    /// kit's look), so an Arabic page keeps the eyebrow, the name, the
    /// client line and the pills on one edge.
    @ViewBuilder
    private var hero: some View {
        if let name = detail?.name ?? seed?.name {
            let cover = detail?.resolvedCoverURL ?? (detail == nil ? seed?.resolvedCoverURL : nil)
            let status = detail?.pipelineStatus ?? seed?.pipelineStatus ?? ""
            let publish = detail?.publishState ?? seed?.publishState ?? ""
            ProjectHero(
                name,
                subtitle: heroSubtitle,
                eyebrow: L("Project"),
                imageURL: cover,
                symbol: "folder.fill",
                tint: .neonBlueStrong,
                height: 270
            ) {
                HStack(spacing: 6) {
                    if !status.isEmpty { ProjectStatusPill(status: status, onPhoto: cover != nil, live: true) }
                    if !publish.isEmpty { ProjectPublishPill(state: publish, onPhoto: cover != nil) }
                }
            }
        } else {
            SkeletonBlock(height: 250, radius: NeonRadius.xxl)
                .shimmer()
        }
    }

    private var heroSubtitle: String? {
        let client = detail?.clientName ?? seed?.clientName ?? ""
        let place = (detail?.location ?? seed?.location ?? "").trimmingCharacters(in: .whitespaces)
        let parts = [client, place].filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    // MARK: - Page

    /// The eleven tabs, straight under the hero and pinned under the bar
    /// once it scrolls off, on a strip of the bar's own white.
    private func sectionTabs(_ detail: ProjectDetail) -> some View {
        FilterChips(
            selection: $section,
            options: DetailSection.allCases,
            inset: NeonSpace.gutter,
            title: { $0.label },
            symbol: { $0.symbol },
            count: { sectionCount($0, detail) }
        )
        .padding(.vertical, NeonSpace.sm)
        .background(ProjectPageMark(name: "sections", edge: .top))
        // Inside the bleed, so the strip runs from edge to edge.
        .background {
            Rectangle()
                .fill(Color.neonSurfaceStrong)
                .overlay(alignment: .bottom) { NeonDivider() }
                .shadow(color: Color.neonShadowTint.opacity(0.06), radius: 6, x: 0, y: 3)
                .opacity(heroGone ? 1 : 0)
                .animation(NeonMotion.resolved(NeonMotion.quick), value: heroGone)
        }
        .padding(.horizontal, -NeonSpace.gutter)
    }

    /// A count beside a tab only where the page already knows it.
    private func sectionCount(_ section: DetailSection, _ detail: ProjectDetail) -> Int? {
        let count: Int
        switch section {
        case .gallery: count = detail.allImages.count
        case .approvals: count = detail.count.approvals
        case .comments: count = detail.count.comments
        default: return nil
        }
        return count > 0 ? count : nil
    }

    @ViewBuilder
    private func sectionContent(_ detail: ProjectDetail) -> some View {
        if let cachedAt { OfflineBanner(savedAt: cachedAt) }

        if api.side == .employee { liveStatusBanner(detail) }

        switch section {
        case .overview:
            // The client's page — its link, sharing, publishing — is the
            // overview's first card.
            clientPageCard(detail)
                .id("link")
                .transition(.neonRise)
            ProjectOverviewContent(
                detail: detail,
                onEdit: { showEdit = true },
                onOpenSection: { target in withNeonAnimation(NeonMotion.snappy) { section = target } },
                onChanged: { Task { await load(silently: true) } }
            )
        case .gallery:
            ProjectGalleryView(
                projectId: detail.id,
                spaces: detail.spaces,
                coverImageUrl: detail.coverImageUrl,
                onChanged: { Task { await load(silently: true) } }
            )
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

    // Said plainly, on the screen where the editing happens: this is
    // publishing, not saving. Mirrors the employee web page's own banner
    // (src/app/employee/(portal)/projects/[id]/layout.tsx) word for word —
    // shown only on this side, since it is telling the team something the
    // manager already knows from the publish badge beside it.
    @ViewBuilder
    private func liveStatusBanner(_ detail: ProjectDetail) -> some View {
        StatusNote(
            symbol: detail.publishState == "PUBLISHED" ? "dot.radiowaves.left.and.right" : "exclamationmark.triangle.fill",
            tone: .warning,
            title: detail.publishState == "PUBLISHED"
                ? L("This project is live. Anything you add or remove here changes the client’s page straight away.")
                : L("This project is not published, so the client sees nothing until somebody publishes it.")
        )
    }

    // MARK: - The client's page: link, sharing, publishing

    private func publishLine(_ state: String) -> String {
        switch state {
        case "PUBLISHED": return L("Live — the client can open this link.")
        case "ARCHIVED": return L("Archived — hidden from the client link.")
        default: return L("Not published — the client sees nothing yet.")
        }
    }

    @ViewBuilder
    private func clientPageCard(_ detail: ProjectDetail) -> some View {
        SectionCard(
            L("Client Page"),
            subtitle: publishLine(detail.publishState),
            symbol: "link",
            hue: .purple
        ) {
            if let link = detail.clientLink {
                linkCapsule(link)

                // Three that stay on this phone, then the two that message
                // the client — each asks first, naming who gets it.
                VStack(spacing: NeonSpace.sm) {
                    HStack(alignment: .top, spacing: NeonSpace.sm) {
                        ProjectActionTile(title: L("Copy Link"), symbol: "doc.on.doc.fill", hue: .blue) {
                            copy(link)
                        }
                        ProjectActionTile(title: L("Preview"), symbol: "safari.fill", hue: .indigo) {
                            openURL(link)
                        }
                        ShareLink(item: link) {
                            ProjectActionTileLabel(title: L("Share"), symbol: "square.and.arrow.up.fill", hue: .purple)
                        }
                        .buttonStyle(.pressable)
                    }
                    HStack(alignment: .top, spacing: NeonSpace.sm) {
                        ProjectActionTile(title: L("Send to Client"), symbol: "paperplane.fill", hue: .green, isBusy: sending == "sent_to_client") {
                            askToSend("sent_to_client")
                        }
                        .disabled(sending != nil)
                        ProjectActionTile(title: L("Send Update"), symbol: "bell.badge.fill", hue: .cyan, isBusy: sending == "sent_update") {
                            askToSend("sent_update")
                        }
                        .disabled(sending != nil)
                    }
                }

                NeonDivider()
            }

            publishControls(detail)
        }
    }

    private func linkCapsule(_ link: URL) -> some View {
        Button {
            copy(link)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "globe")
                    .font(.system(.footnote, weight: .semibold))
                    .foregroundStyle(NeonHue.purple.deep)
                Text(verbatim: link.absoluteString)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.neonTextSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 4)
                Image(systemName: "doc.on.doc")
                    .font(.system(.caption, weight: .semibold))
                    .foregroundStyle(Color.neonTextTertiary)
            }
            // A web address reads left to right in either language.
            .environment(\.layoutDirection, .leftToRight)
            .padding(.horizontal, 12)
            .frame(minHeight: 38)
            .background(Capsule().fill(Color.neonSurfaceSunken))
            .overlay(Capsule().strokeBorder(Color.neonLine, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.pressable)
        .accessibilityLabel(Text(L("Copy Link")))
        .accessibilityValue(Text(verbatim: link.absoluteString))
    }

    @ViewBuilder
    private func publishControls(_ detail: ProjectDetail) -> some View {
        HStack(spacing: NeonSpace.sm) {
            if detail.publishState != "PUBLISHED" {
                NeonButton(L("Publish Project"), symbol: "checkmark.seal.fill", kind: .brand, size: .medium, fullWidth: true) {
                    await setPublish("PUBLISHED")
                }
            } else {
                NeonButton(
                    L("Unpublish"), symbol: "eye.slash", kind: .secondary, size: .medium, fullWidth: true,
                    confirm: L("Unpublish this project?"),
                    confirmMessage: L("The client's link stops opening until you publish again.")
                ) {
                    await setPublish("DRAFT")
                }
            }
            if detail.publishState != "ARCHIVED" {
                NeonButton(
                    L("Archive"), symbol: "archivebox", kind: .ghost, size: .medium,
                    confirm: L("Archive this project?"), confirmMessage: L("It will be hidden from the client link.")
                ) {
                    await setPublish("ARCHIVED")
                }
                .fixedSize()
            }
        }
    }

    // MARK: - Sending to the client

    private var clientPhone: String? {
        let phone = detail?.clientPhone?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return phone.isEmpty ? nil : phone
    }

    /// A message to the client goes out only after a confirmation that says
    /// to whom. With no number on file there is nothing to confirm: the
    /// server says so itself.
    private func askToSend(_ kind: String) {
        guard sending == nil else { return }
        if clientPhone == nil {
            Task { await send(kind: kind) }
        } else {
            Haptic.warning()
            confirmSend = kind
        }
    }

    private func sendTitle(_ kind: String) -> String {
        let name = detail?.clientName.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        switch (kind, name.isEmpty) {
        case ("sent_update", true): return L("Send the client an update on WhatsApp?")
        case ("sent_update", false): return L("Send %@ an update on WhatsApp?", name)
        case (_, true): return L("Send the client the project link on WhatsApp?")
        default: return L("Send %@ the project link on WhatsApp?", name)
        }
    }

    /// The number and the message's first line, as the server writes it
    /// (sendProjectWhatsApp in src/lib/actions/whatsapp-actions.ts — it sends
    /// in English, whatever this phone reads).
    private func sendPreview(_ kind: String) -> String {
        let name = detail?.clientName ?? ""
        let opening = kind == "sent_update"
            ? "Hi \(name), there's an update on your NEON project."
            : "Hi \(name), your project from NEON is ready."
        return L("To %@", clientPhone ?? "") + "\n“" + opening + " …”"
    }

    // MARK: - Actions

    private func copy(_ link: URL) {
        UIPasteboard.general.string = link.absoluteString
        Haptic.soft()
        Toast.info(L("Copied"), detail: link.absoluteString)
    }

    private func load(silently: Bool = false) async {
        do {
            let loaded = try await api.fetchProjectDetail(id: projectId)
            withNeonAnimation(NeonMotion.gentle) {
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
        guard sending == nil else { return }
        sending = kind
        defer { sending = nil }
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

// MARK: - Where the hero and the tabs are

/// Screen positions of named edges on the project's page, gathered up to the
/// scroll view: the hero's bottom and the tabs' top say whether the tabs have
/// pinned (and the hero gone under the bar).
private struct ProjectPageMarks: PreferenceKey {
    static let defaultValue: [String: CGFloat] = [:]
    static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
        value.merge(nextValue()) { $1 }
    }
}

private struct ProjectPageMark: View {
    let name: String
    let edge: VerticalEdge

    var body: some View {
        GeometryReader { geo in
            let frame = geo.frame(in: .global)
            Color.clear.preference(key: ProjectPageMarks.self, value: [name: edge == .top ? frame.minY : frame.maxY])
        }
    }
}
