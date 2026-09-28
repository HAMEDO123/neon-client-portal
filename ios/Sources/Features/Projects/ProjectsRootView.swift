import SwiftUI

/// The Projects tab, for the manager and the team alike — the studio decided
/// the team works a project exactly as the manager does. Tab root: owns the
/// one NavigationStack for the list, a project's page and its sections.
struct ProjectsRootView: View {
    var body: some View {
        NavigationStack {
            ProjectListView()
                .navigationDestination(for: ProjectRoute.self) { route in
                    ProjectDetailView(projectId: route.id, seed: route.seed)
                }
        }
    }
}

/// Pushed from the list (which already has the row's summary — shown at once,
/// no skeleton) or from a deep link with only an id (the detail screen loads
/// its own name then).
struct ProjectRoute: Hashable {
    let id: String
    let seed: ProjectSummary?

    static func == (lhs: ProjectRoute, rhs: ProjectRoute) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
