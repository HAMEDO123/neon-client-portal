import SwiftUI

// What an alert's `url` (an admin web path, e.g. "/admin/tasks",
// "/admin/employees/42", "/admin/chat/team?task=9") means as a native screen —
// parsed once here so AlertsRootView pushes the same screen the website would
// open, per ios/ARCHITECTURE.md's contract, rather than a browser.
//
// Every case names a view another area already owns; this file only ever
// *reads* those areas' public initialisers (ProjectDetailView, EmployeesRootView,
// EmployeeDetailView, RequestsRootView, SiteVisitsRootView, ChatRoute) — never
// their files.

enum HomeLinkDestination: Equatable {
    /// `/admin/tasks` — the whole board; there is no cell id to open one row of it.
    case tasksBoard
    /// `/admin/reviews` — this area's own ReviewsRootView.
    case reviews
    /// `/admin/employees` — the team list.
    case employees
    /// `/admin/employees/<id>` — one person's page.
    case employee(id: String)
    /// `/admin/projects/<id>` — the projects area's own project page.
    case project(id: String)
    /// `/admin/requests` — the ops area's queue.
    case requests
    /// `/admin/site-visits` — the ops area's diary.
    case siteVisits
    /// `/admin/chat/<slug>` (optionally `?task=` or `?meeting=`) — resolved to
    /// a live conversation by slug, since a ChatRoute needs more than an id.
    case chat(slug: String)
    /// Recognised but nothing here can open natively (e.g. Settings, WhatsApp,
    /// Analytics with query state this area doesn't reproduce) — the row says
    /// so instead of falling back to a browser.
    case unsupported
}

/// Parses an admin web path into what `AlertsRootView` can push. `nil` only
/// for something that isn't even an admin path (defensive; every alert this
/// area reads is the manager's own).
func parseAdminLink(_ raw: String) -> HomeLinkDestination? {
    guard let components = URLComponents(string: raw) else { return nil }
    let parts = components.path.split(separator: "/").map(String.init)
    guard parts.first == "admin" else { return nil }
    let rest = Array(parts.dropFirst())

    switch rest.first {
    case "tasks": return .tasksBoard
    case "reviews": return .reviews
    case "employees": return rest.count >= 2 ? .employee(id: rest[1]) : .employees
    case "projects": return rest.count >= 2 ? .project(id: rest[1]) : .unsupported
    case "requests": return .requests
    case "site-visits": return .siteVisits
    case "chat": return rest.count >= 2 ? .chat(slug: rest[1]) : .unsupported
    default: return .unsupported
    }
}

/// The screen a `HomeLinkDestination` pushes — shared by every screen in
/// this area that resolves one, so `AlertsRootView` and `AdminHomeView`
/// (its own project carousel, its "Open the board" quick action, a tapped
/// avatar on the team's day) push exactly the same native screen.
@ViewBuilder
func homeDestinationView(_ destination: HomeLinkDestination?) -> some View {
    switch destination {
    case .tasksBoard: TasksRootView()
    case .reviews: ReviewsRootView()
    case .employees: EmployeesRootView()
    case .employee(let id): EmployeeDetailView(employeeId: id)
    case .project(let id): ProjectDetailView(projectId: id)
    case .requests: RequestsRootView()
    case .siteVisits: SiteVisitsRootView()
    case .chat, .unsupported, .none: EmptyView()
    }
}
