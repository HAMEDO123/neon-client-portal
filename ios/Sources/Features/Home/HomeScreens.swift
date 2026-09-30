#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Add every screen and sheet of this area here, so each can be checked.
///
/// The Home tab itself is `tab-home`; its lower sections scroll into view
/// with `-neonScroll kpis|progress|projects|today|month|reviews|actions|now|day`
/// (`now` and `day` are the top and the lower half of the one team card).
enum HomeScreens {
    static let ids: [String] = [
        "home-today", "home-search", "home-upload-photos", "home-projects-published", "home-projects-updated",
    ]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "home-today":
            // Loaded by the screen's own states, so a failed read shows the
            // app's ErrorState with Retry, as it does on the phone — never a
            // raw Swift error on a bare page.
            return debugPushed(HomeTodayDebug())
        case "home-projects-published", "home-projects-updated":
            let filter: HomeProjectFilter = id == "home-projects-published" ? .published : .updated
            return debugPushed(DebugAsync(load: { try await APIClient.shared.fetchHomeOverview().value.projects }) { projects in
                HomeProjectListView(filter: filter, projects: projects, onOpen: { _ in })
            })
        case "home-search":
            return debugPushed(DebugAsync(load: { try await HomeDebugData.load() }) { data in
                HomeSearchView(projects: data.projects, people: homeSearchPeople(now: data.now, day: nil), onOpen: { _ in })
            })
        case "home-upload-photos":
            return AnyView(DebugAsync(load: { try await APIClient.shared.fetchHomeOverview().value.projects }) { projects in
                HomeUploadPhotosSheet(projects: projects, onUploaded: {})
            })
        default: return nil
        }
    }
}

/// "View All" on Today's Tasks, reading home/today the way Home does and
/// handing the screen its value or its error.
private struct HomeTodayDebug: View {
    @State private var today: HomeToday?
    @State private var error: String?

    var body: some View {
        HomeTodayView(today: today, error: error, retry: load, onOpen: { _ in })
            .task { await load() }
    }

    private func load() async {
        do {
            today = try await APIClient.shared.fetchHomeToday().value
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// What the search screen is opened with: the projects and the team, read
/// the way Home reads them.
private struct HomeDebugData {
    let projects: [HomeProject]
    let now: HomeNow?

    @MainActor static func load() async throws -> HomeDebugData? {
        let projects = try await APIClient.shared.fetchHomeOverview().value.projects
        let now = try? await APIClient.shared.fetchHomeNow().value
        return HomeDebugData(projects: projects, now: now)
    }
}
#endif
