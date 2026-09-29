#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Add every screen and sheet of this area here, so each can be checked.
///
/// The Home tab itself is `tab-home`; its lower sections scroll into view
/// with `-neonScroll kpis|progress|today|month|reviews|actions|now|day|projects`.
enum HomeScreens {
    static let ids: [String] = ["home-today", "home-search", "home-upload-photos"]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "home-today":
            return debugPushed(DebugAsync(load: { try await APIClient.shared.fetchHomeToday().value }) { today in
                HomeTodayView(today: today, error: nil, retry: {}, onOpen: { _ in })
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
