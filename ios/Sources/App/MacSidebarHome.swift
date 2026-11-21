import SwiftUI

// On a Mac the app is a window, not a phone (Mac Catalyst). Five tabs and a
// "More" grid are how a phone fits everything into a thumb's reach; a window
// has room for all of it at once — so every destination is a row in a
// sidebar, and the screen it opens fills the rest of the window. The screens
// themselves are the phone's own, unchanged: only how you get to them moves.
//
// AdminHome and EmployeeHome choose this under `targetEnvironment(macCatalyst)`
// and keep everything else they do (the polling, the badges, a tapped
// notification or widget opening its screen).

struct SidebarItem: Identifiable {
    let id: String
    let title: String
    let symbol: String
    var badge: Int = 0
    /// The screen brings its own NavigationStack (the phone's tab roots do);
    /// the ones the phone pushed from More are given one here.
    var ownsStack = false
    let make: () -> AnyView
}

struct SidebarSection: Identifiable {
    let id: String
    let title: String?
    let items: [SidebarItem]
}

struct MacSidebarHome: View {
    let sections: [SidebarSection]
    @Binding var selection: String

    private var selected: SidebarItem? {
        sections.lazy.flatMap(\.items).first { $0.id == selection }
    }

    var body: some View {
        NavigationSplitView {
            List(selection: Binding<String?>(get: { selection }, set: { if let id = $0 { selection = id } })) {
                ForEach(sections) { section in
                    if let title = section.title {
                        Section(title) { rows(section.items) }
                    } else {
                        Section { rows(section.items) }
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("NEON")
            .navigationSplitViewColumnWidth(min: 210, ideal: 240, max: 320)
        } detail: {
            if let item = selected {
                Group {
                    if item.ownsStack {
                        item.make()
                    } else {
                        NavigationStack { item.make() }
                    }
                }
                // A new row is a new screen, never the last one's pushed pages.
                .id(item.id)
            }
        }
        .navigationSplitViewStyle(.balanced)
        .onAppear(perform: MacWindow.fit)
    }

    private func rows(_ items: [SidebarItem]) -> some View {
        ForEach(items) { item in
            Label(item.title, systemImage: item.symbol)
                .badge(item.badge)
                .tag(item.id)
        }
    }
}

/// The window opens big enough for a sidebar beside a screen, and cannot be
/// squeezed to where a screen's own layout would break.
enum MacWindow {
    static func fit() {
        #if targetEnvironment(macCatalyst)
        for scene in UIApplication.shared.connectedScenes {
            guard let scene = scene as? UIWindowScene else { continue }
            scene.sizeRestrictions?.minimumSize = CGSize(width: 980, height: 660)
            scene.titlebar?.titleVisibility = .hidden
        }
        #endif
    }
}

// MARK: - Which row a link opens

/// A notification's or a widget's web path, as a sidebar row — finer than the
/// phone's five tabs, because every screen has a row of its own here.
enum MacRoute {
    static func admin(_ path: String) -> String {
        let routes: [(String, String)] = [
            ("/admin/chat", "chat"), ("/admin/whatsapp", "whatsapp"),
            ("/admin/tasks", "tasks"), ("/admin/projects", "projects"),
            ("/admin/reviews", "reviews"), ("/admin/requests", "requests"),
            ("/admin/alerts", "alerts"), ("/admin/meetings", "meetings"),
            ("/admin/site-visits", "visits"), ("/admin/employees", "employees"),
            ("/admin/payroll", "payroll"), ("/admin/attendance", "attendance"),
            ("/admin/team-map", "map"), ("/admin/cameras", "cameras"),
            ("/admin/status", "status"), ("/admin/shopping", "shopping"),
            ("/admin/analytics", "analytics"), ("/admin/settings", "settings"),
        ]
        return routes.first { path.hasPrefix($0.0) }?.1 ?? "home"
    }

    static func employee(_ path: String) -> String {
        let routes: [(String, String)] = [
            ("/employee/chat", "chat"), ("/employee/tasks", "tasks"),
            ("/employee/assigned", "tasks"), ("/employee/projects", "projects"),
            ("/employee/notifications", "alerts"), ("/employee/meetings", "meetings"),
            ("/employee/requests", "requests"), ("/employee/shopping", "shopping"),
            ("/employee/profile", "profile"),
        ]
        return routes.first { path.hasPrefix($0.0) }?.1 ?? "today"
    }
}

// MARK: - The two sides' rows

extension AdminHome {
    func macSections(unreadChat: Int, onUnread: @escaping (Int) -> Void) -> [SidebarSection] {
        [
            SidebarSection(id: "main", title: nil, items: [
                SidebarItem(id: "home", title: L("Home"), symbol: "house", ownsStack: true) { AnyView(AdminHomeView()) },
                SidebarItem(id: "projects", title: L("Projects"), symbol: "square.grid.2x2", ownsStack: true) { AnyView(ProjectsRootView()) },
                SidebarItem(id: "tasks", title: L("Tasks"), symbol: "checklist", ownsStack: true) { AnyView(TasksRootView()) },
                SidebarItem(id: "chat", title: L("Chat"), symbol: "bubble.left.and.bubble.right", badge: unreadChat, ownsStack: true) {
                    AnyView(ChatListView(onUnreadChange: onUnread))
                },
            ]),
            SidebarSection(id: "work", title: L("Work"), items: [
                SidebarItem(id: "reviews", title: L("Reviews"), symbol: "tray.and.arrow.down") { AnyView(ReviewsRootView()) },
                SidebarItem(id: "requests", title: L("Requests"), symbol: "tray.full") { AnyView(RequestsRootView()) },
                SidebarItem(id: "alerts", title: L("Alerts"), symbol: "bell.badge") { AnyView(AlertsRootView()) },
                SidebarItem(id: "meetings", title: L("Meetings"), symbol: "calendar") { AnyView(MeetingsView()) },
                SidebarItem(id: "visits", title: L("Site visits"), symbol: "mappin.and.ellipse") { AnyView(SiteVisitsRootView()) },
                SidebarItem(id: "whatsapp", title: L("WhatsApp"), symbol: "phone.bubble") { AnyView(WhatsAppRootView()) },
            ]),
            SidebarSection(id: "team", title: L("Team"), items: [
                SidebarItem(id: "employees", title: L("Employees"), symbol: "person.2") { AnyView(EmployeesRootView()) },
                SidebarItem(id: "attendance", title: L("Attendance"), symbol: "clock.badge.checkmark") { AnyView(AttendanceRootView()) },
                SidebarItem(id: "payroll", title: L("Payroll"), symbol: "banknote", ownsStack: true) { AnyView(PayrollRootView()) },
                SidebarItem(id: "map", title: L("Team map"), symbol: "map") { AnyView(TeamMapView()) },
            ]),
            SidebarSection(id: "office", title: L("The office"), items: [
                SidebarItem(id: "cameras", title: L("Cameras"), symbol: "video") { AnyView(CamerasRootView()) },
                SidebarItem(id: "status", title: L("Network & server"), symbol: "server.rack") { AnyView(StatusRootView()) },
                SidebarItem(id: "shopping", title: L("Office shopping"), symbol: "cart") { AnyView(OfficeShoppingView()) },
                SidebarItem(id: "analytics", title: L("Analytics"), symbol: "chart.bar") { AnyView(AnalyticsRootView()) },
                SidebarItem(id: "settings", title: L("Settings"), symbol: "gearshape") { AnyView(SettingsRootView()) },
            ]),
            SidebarSection(id: "account", title: nil, items: [
                SidebarItem(id: "more", title: L("Account"), symbol: "person.crop.circle", ownsStack: true) { AnyView(AdminMoreView()) },
            ]),
        ]
    }
}

extension EmployeeHome {
    func macSections(unreadChat: Int, unread: Int, onUnread: @escaping (Int) -> Void, openChat: @escaping () -> Void) -> [SidebarSection] {
        [
            SidebarSection(id: "main", title: nil, items: [
                SidebarItem(id: "today", title: L("Today"), symbol: "sun.max", ownsStack: true) { AnyView(TodayView()) },
                SidebarItem(id: "tasks", title: L("Tasks"), symbol: "checklist", ownsStack: true) { AnyView(TasksView()) },
                SidebarItem(id: "chat", title: L("Chat"), symbol: "bubble.left.and.bubble.right", badge: unreadChat, ownsStack: true) {
                    AnyView(ChatListView(onUnreadChange: onUnread))
                },
                SidebarItem(id: "projects", title: L("Projects"), symbol: "square.grid.2x2", ownsStack: true) { AnyView(ProjectsRootView()) },
            ]),
            SidebarSection(id: "day", title: L("Your day"), items: [
                SidebarItem(id: "alerts", title: L("Alerts"), symbol: "bell.badge", badge: unread) { AnyView(NotificationsView(openChat: openChat)) },
                SidebarItem(id: "meetings", title: L("Meetings"), symbol: "calendar") { AnyView(MeetingsView()) },
                SidebarItem(id: "requests", title: L("My requests"), symbol: "tray.full") { AnyView(MyRequestsRootView()) },
                SidebarItem(id: "shopping", title: L("Office shopping"), symbol: "cart") { AnyView(OfficeShoppingView()) },
            ]),
            SidebarSection(id: "account", title: nil, items: [
                SidebarItem(id: "profile", title: L("Profile"), symbol: "person.crop.circle") { AnyView(ProfileRootView()) },
                // Assign work, site visits and WhatsApp, for whoever they are given to.
                SidebarItem(id: "more", title: L("More"), symbol: "ellipsis.circle", ownsStack: true) { AnyView(EmployeeMoreView(openChat: openChat)) },
            ]),
        ]
    }
}
