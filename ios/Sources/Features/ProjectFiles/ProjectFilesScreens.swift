#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Every section is opened on the first real project (`DebugAsync`), wrapped
/// in a `NeonScroll` the way `ProjectDetailView` (Projects area) hosts it —
/// the section itself carries no page chrome of its own. An "Add" sheet is
/// pushed as its own screen too, since a sheet can be shown as a screen.
enum ProjectFilesScreens {
    static let ids: [String] = [
        "pf-drawings", "pf-drawings-add", "pf-drawings-revision",
        "pf-documents", "pf-documents-add",
        "pf-boq", "pf-boq-add",
        "pf-pricing", "pf-pricing-add",
        "pf-materials", "pf-materials-add",
        "pf-furniture", "pf-furniture-add",
        "pf-approvals", "pf-approvals-add",
        "pf-comments",
    ]

    private static func firstProjectId() async throws -> String? {
        try await APIClient.shared.fetchProjectsList().value.projects.first?.id
    }

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "pf-drawings":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                NeonScroll { ProjectDrawingsSection(projectId: id) }
            })
        case "pf-drawings-add":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                AddDrawingSheet(projectId: id) {}
            })
        case "pf-drawings-revision":
            return debugPushed(DebugAsync(load: { () async throws -> (String, PFDrawing)? in
                guard let projectId = try await firstProjectId() else { return nil }
                guard let drawing = try await APIClient.shared.fetchDrawings(projectId: projectId).value.drawings.first else { return nil }
                return (projectId, drawing)
            }) { pair in
                AddRevisionSheet(projectId: pair.0, drawing: pair.1) {}
            })
        case "pf-documents":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                NeonScroll { ProjectDocumentsSection(projectId: id) }
            })
        case "pf-documents-add":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                AddDocumentSheet(projectId: id) {}
            })
        case "pf-boq":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                NeonScroll { ProjectBoqSection(projectId: id) }
            })
        case "pf-boq-add":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                AddBoqSheet(projectId: id) {}
            })
        case "pf-pricing":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                NeonScroll { ProjectPricingSection(projectId: id) }
            })
        case "pf-pricing-add":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                AddPricingSheet(projectId: id) {}
            })
        case "pf-materials":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                NeonScroll { ProjectMaterialsSection(projectId: id) }
            })
        case "pf-materials-add":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                AddMaterialSheet(projectId: id) {}
            })
        case "pf-furniture":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                NeonScroll { ProjectFurnitureSection(projectId: id) }
            })
        case "pf-furniture-add":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                AddFurnitureSheet(projectId: id) {}
            })
        case "pf-approvals":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                NeonScroll { ProjectApprovalsSection(projectId: id) }
            })
        case "pf-approvals-add":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                AddApprovalSheet(projectId: id) {}
            })
        case "pf-comments":
            return debugPushed(DebugAsync(load: firstProjectId) { id in
                NeonScroll { ProjectCommentsSection(projectId: id) }
            })
        default: return nil
        }
    }
}
#endif
