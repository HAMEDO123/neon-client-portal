#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Add every screen and sheet of this area here, so each can be checked.
enum ProjectsScreens {
    static let ids: [String] = ["project-detail"]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "project-detail":
            return debugPushed(DebugAsync(load: { try await APIClient.shared.fetchProjectsList().value.projects.first }) { project in
                ProjectDetailView(projectId: project.id, seed: project)
            })
        default: return nil
        }
    }
}
#endif
