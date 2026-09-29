#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Every screen and sheet of the Projects area is here, each opened with the
/// studio's first real project (or the first one that has what it needs).
enum ProjectsScreens {
    static let ids: [String] = [
        "projects-list", "project-detail", "project-gallery", "project-analytics",
        "project-new", "project-edit", "project-filter", "project-add-space",
        "project-add-photos", "project-hotspots", "project-viewer",
    ]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "projects-list":
            return AnyView(ProjectsRootView())
        case "project-detail":
            return debugPushed(DebugAsync(load: { try await firstProject() }) { project in
                ProjectDetailView(projectId: project.id, seed: project)
            })
        case "project-gallery":
            return debugPushed(DebugAsync(load: { try await firstDetail(where: { !$0.allImages.isEmpty })?.summary }) { project in
                ProjectDetailView(projectId: project.id, seed: project, initialSection: .gallery)
            })
        case "project-analytics":
            return debugPushed(DebugAsync(load: { try await firstProject() }) { project in
                ProjectDetailView(projectId: project.id, seed: project, initialSection: .analytics)
            })
        case "project-new":
            return sheet(NewProjectSheet { _ in })
        case "project-edit":
            return sheet(DebugAsync(load: { try await firstDetail(where: { _ in true })?.detail }) { detail in
                EditProjectSheet(detail: detail) {}
            })
        case "project-filter":
            return sheet(DebugAsync(load: { try await APIClient.shared.fetchProjectsList().value.projects }) { projects in
                ProjectFilterScreen(projects: projects)
            })
        case "project-add-space":
            return sheet(DebugAsync(load: { try await firstProject() }) { project in
                ProjectAddSpaceSheet(projectId: project.id) {}
            })
        case "project-add-photos":
            return sheet(DebugAsync(load: { try await firstDetail(where: { !$0.spaces.isEmpty }) }) { found in
                if let space = found.detail.spaces.first {
                    AddPhotosSheet(projectId: found.detail.id, space: space) {}
                }
            })
        case "project-hotspots":
            return sheet(DebugAsync(load: { try await firstImage(preferringHotspots: true) }) { found in
                HotspotEditorView(projectId: found.projectId, image: found.image) {}
            })
        case "project-viewer":
            return AnyView(DebugAsync(load: { try await firstDetail(where: { !$0.allImages.isEmpty })?.detail }) { detail in
                ImageViewerView(payload: viewerPayload(detail))
                    .neonLanguage()
            })
        default: return nil
        }
    }

    // MARK: - Finding something real to open

    private struct Found {
        let detail: ProjectDetail
        let summary: ProjectSummary
    }

    private struct FoundImage {
        let projectId: String
        let image: GalleryImage
    }

    @MainActor private static func firstProject() async throws -> ProjectSummary? {
        try await APIClient.shared.fetchProjectsList().value.projects.first
    }

    /// The first project, newest update first, whose page satisfies `test`.
    @MainActor private static func firstDetail(where test: (ProjectDetail) -> Bool) async throws -> Found? {
        let projects = try await APIClient.shared.fetchProjectsList().value.projects
        for project in projects {
            let detail = try await APIClient.shared.fetchProjectDetail(id: project.id).value
            if test(detail) { return Found(detail: detail, summary: project) }
        }
        return nil
    }

    @MainActor private static func firstImage(preferringHotspots: Bool) async throws -> FoundImage? {
        let projects = try await APIClient.shared.fetchProjectsList().value.projects
        var fallback: FoundImage?
        for project in projects {
            let detail = try await APIClient.shared.fetchProjectDetail(id: project.id).value
            for image in detail.allImages {
                if !preferringHotspots || !image.hotspots.isEmpty { return FoundImage(projectId: detail.id, image: image) }
                if fallback == nil { fallback = FoundImage(projectId: detail.id, image: image) }
            }
        }
        return fallback
    }

    /// The viewer as the gallery opens it, on the first space with photos.
    private static func viewerPayload(_ detail: ProjectDetail) -> ImageViewerPayload {
        let space = detail.spaces.first { !$0.images.isEmpty }
        let images = space?.images ?? []
        return ImageViewerPayload(
            items: images.map { image in
                ImageViewerItem(
                    id: image.id,
                    url: image.resolvedURL,
                    caption: image.caption,
                    beforeURL: image.isBeforeAfter ? image.resolvedBeforeURL : nil,
                    hotspots: image.hotspots.map { ImageViewerHotspot(id: $0.id, x: $0.xPercent / 100, y: $0.yPercent / 100, label: $0.label, category: $0.category) }
                )
            },
            startIndex: 0,
            title: space?.name,
            actions: [
                ImageViewerAction(id: "hotspots", title: L("Hotspots"), symbol: "mappin.and.ellipse") { _ in },
                ImageViewerAction(id: "cover", title: L("Set as Cover"), symbol: "star") { _ in },
                ImageViewerAction(id: "delete", title: L("Delete"), symbol: "trash", isDestructive: true) { _ in },
            ]
        )
    }

    /// A sheet drawn as a screen, on the page colour a sheet has.
    @MainActor private static func sheet<V: View>(_ content: V) -> AnyView {
        AnyView(content.background(NeonAmbient().ignoresSafeArea()).neonLanguage())
    }
}

/// The filter sheet with bindings of its own, for the router.
private struct ProjectFilterScreen: View {
    let projects: [ProjectSummary]
    @State private var pipeline: String?
    @State private var stage: String?

    var body: some View {
        ProjectFilterSheet(pipelineFilter: $pipeline, stageFilter: $stage, projects: projects)
    }
}
#endif
