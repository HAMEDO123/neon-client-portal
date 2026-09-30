import SwiftUI

/// "Upload Photos" from Home: pick the project, then the room of its gallery,
/// then the projects area's own add-photos form (`AddPhotosSheet`) — the same
/// upload, one photo per request, as on the project's Gallery.
struct HomeUploadPhotosSheet: View {
    let projects: [HomeProject]
    let onUploaded: () -> Void
    var onOpenProject: ((String) -> Void)?

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var chosen: HomeProject?
    @State private var detail: ProjectDetail?
    @State private var detailError: String?
    @State private var uploadSpace: GallerySpace?
    @State private var uploaded = false

    /// Archived projects are off the board and off the client's page.
    private var candidates: [HomeProject] {
        projects.filter { $0.publishState != "ARCHIVED" && matchesSearch(query, $0.name, $0.clientName, $0.location) }
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(
                L("Upload Photos"),
                subtitle: chosen == nil ? L("Which project are they for?") : L("Which room of %@?", chosen!.name),
                symbol: "camera.fill",
                tint: .neonPinkStrong
            ) { dismiss() }

            ScrollView {
                VStack(alignment: .leading, spacing: NeonSpace.stack) {
                    if let chosen {
                        rooms(for: chosen)
                            .transition(.neonRise)
                    } else {
                        projectList
                            .transition(.neonRise)
                    }
                }
                .padding(NeonSpace.gutter)
                .animation(NeonMotion.smooth, value: chosen?.id)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .sheet(item: $uploadSpace, onDismiss: {
            guard uploaded else { return }
            onUploaded()
            dismiss()
        }) { space in
            if let chosen {
                AddPhotosSheet(projectId: chosen.id, space: space) { uploaded = true }
            }
        }
        .neonSheet([.large])
    }

    // MARK: - Step 1: the project

    @ViewBuilder
    private var projectList: some View {
        SearchField(text: $query, prompt: L("Search projects"))
        if candidates.isEmpty {
            EmptyState(
                symbol: "folder",
                title: projects.isEmpty ? L("No projects yet") : L("No project matches"),
                detail: projects.isEmpty ? L("Create your first client project to start building its delivery portal.") : nil,
                hue: .pink,
                card: true
            )
        } else {
            VStack(spacing: NeonSpace.sm) {
                ForEach(Array(candidates.enumerated()), id: \.element.id) { index, project in
                    Button {
                        Haptic.selection()
                        choose(project)
                    } label: {
                        // Every row the same picture slot (the kit's placeholder
                        // when there is no cover), and whether the client can
                        // see it: a gallery photo has no visibility of its own.
                        ListCardRow(
                            project.name,
                            subtitle: project.clientName,
                            leading: .thumbnail(url: resolvedMediaURL(project.coverImageUrl)),
                            badge: localizedEnum("publish", project.publishState),
                            badgeTone: publishTone(project.publishState)
                        )
                    }
                    .buttonStyle(.pressableCard)
                    .staggered(index)
                }
            }
        }
    }

    // MARK: - Step 2: the room

    @ViewBuilder
    private func rooms(for project: HomeProject) -> some View {
        Button {
            Haptic.tap()
            withNeonAnimation(NeonMotion.smooth) {
                chosen = nil
                detail = nil
                detailError = nil
            }
        } label: {
            Label(L("Another project"), systemImage: "chevron.backward")
                .font(.system(.subheadline, weight: .semibold))
        }
        .buttonStyle(.neon(.ghost, size: .small))

        // A gallery photo carries no flag of its own: on a published project
        // it is on the client's page the moment it lands. Said before the
        // room is chosen, not after.
        if project.publishState == "PUBLISHED" {
            StatusNote(
                symbol: "eye.fill",
                tone: .info,
                title: L("The client sees these straight away"),
                detail: L("%@ is published, so photos you add appear on the client's page as soon as they upload.", project.name)
            )
        }

        if let detail {
            if detail.spaces.isEmpty {
                SectionCard(L("No rooms yet"), symbol: "square.split.2x2", hue: .pink) {
                    Text(L("Photos go into a room of the project's gallery. Add a room on the project's Gallery first, then upload into it."))
                        .font(.neonLabel)
                        .foregroundStyle(Color.neonTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if let onOpenProject {
                        NeonButton(L("Open the project"), symbol: "arrow.forward", kind: .tinted(.neonPinkStrong), size: .medium) {
                            dismiss()
                            onOpenProject(project.id)
                        }
                    }
                }
            } else {
                VStack(spacing: NeonSpace.sm) {
                    ForEach(Array(detail.spaces.enumerated()), id: \.element.id) { index, space in
                        Button {
                            Haptic.tap()
                            uploadSpace = space
                        } label: {
                            ListCardRow(
                                space.name,
                                subtitle: L("%d photos", space.images.count),
                                leading: .thumbnail(url: space.images.first?.resolvedURL)
                            )
                        }
                        .buttonStyle(.pressableCard)
                        .staggered(index)
                    }
                }
            }
        } else if let detailError {
            ErrorState(message: detailError) { await loadDetail(project.id) }
        } else {
            SkeletonRows(count: 3)
        }
    }

    private func choose(_ project: HomeProject) {
        withNeonAnimation(NeonMotion.smooth) { chosen = project }
        Task { await loadDetail(project.id) }
    }

    private func loadDetail(_ id: String) async {
        do {
            let loaded = try await api.fetchProjectDetail(id: id)
            guard chosen?.id == id else { return }
            withNeonAnimation(NeonMotion.smooth) {
                detail = loaded.value
                detailError = nil
            }
        } catch {
            detailError = error.localizedDescription
        }
    }
}
