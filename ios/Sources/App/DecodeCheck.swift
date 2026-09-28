#if DEBUG
import Foundation

/// A developer check, Debug builds only: launched with `-neonDecodeCheck`, the
/// app reads every screen's data from the live server as whoever is signed in
/// and decodes it into the screen's own model — printing `DECODE ok` or
/// `DECODE FAIL` per read to the console. It only reads; it presses nothing
/// and changes nothing. It exists so a server shape and a Swift model that
/// have drifted apart are caught before somebody opens that screen.
enum DecodeCheck {
    static var requested: Bool { ProcessInfo.processInfo.arguments.contains("-neonDecodeCheck") }

    @MainActor
    static func run(_ api: APIClient) async {
        var passed = 0
        var failed = 0

        func check(_ name: String, _ body: () async throws -> Void) async {
            do {
                try await body()
                passed += 1
                print("DECODE ok   \(name)")
            } catch {
                failed += 1
                print("DECODE FAIL \(name): \(error)")
            }
        }

        let isAdmin = api.side == .admin

        // What every signed-in person sees.
        await check("chat/conversations") { _ = try await api.fetchConversations() }
        await check("chat/messages team") { _ = try await api.fetchMessages(conversation: "team") }
        await check("chat/tasks") { _ = try await api.fetchChatTasks() }
        await check("chat/meetings") { _ = try await api.fetchChatMeetings() }
        await check("chat/projects") { _ = try await api.fetchChatProjects() }
        await check("chat/members team") { _ = try await api.read("chat/members", ["conversation": "team"], as: ChatMembers.self) }
        await check("chat/reactions team") { _ = try await api.read("chat/reactions", ["conversation": "team"], as: ChatReactionSnapshot.self) }

        // Projects, for both sides.
        var projectIds: [String] = []
        await check("projects/list") {
            projectIds = try await api.read("projects/list", as: ProjectsListResponse.self).value.projects.map(\.id)
        }
        await check("projects/sellers") { _ = try await api.read("projects/sellers", as: [ProjectSeller].self) }
        // Every project, not the first: an empty list decodes whatever its
        // items look like, so only a project that has some proves the model.
        for projectId in projectIds {
            await check("projects/detail") { _ = try await api.read("projects/detail", ["id": projectId], as: ProjectDetail.self) }
            await check("projects/analytics") { _ = try await api.read("projects/analytics", ["id": projectId], as: ProjectAnalytics.self) }
            await check("projectfiles/drawings") { _ = try await api.fetchDrawings(projectId: projectId) }
            await check("projectfiles/documents") { _ = try await api.fetchDocuments(projectId: projectId) }
            await check("projectfiles/boq") { _ = try await api.fetchBoq(projectId: projectId) }
            await check("projectfiles/pricing") { _ = try await api.fetchPricing(projectId: projectId) }
            await check("projectfiles/materials") { _ = try await api.fetchMaterials(projectId: projectId) }
            await check("projectfiles/furniture") { _ = try await api.fetchFurniture(projectId: projectId) }
            await check("projectfiles/approvals") { _ = try await api.fetchApprovals(projectId: projectId) }
            await check("projectfiles/comments") { _ = try await api.fetchProjectComments(projectId: projectId) }
        }

        if isAdmin {
            await check("home/overview") { _ = try await api.read("home/overview", as: HomeOverview.self) }
            await check("home/day") { _ = try await api.read("home/day", as: HomeDay.self) }
            await check("home/alerts") { _ = try await api.read("home/alerts", as: HomeAlerts.self) }
            await check("home/reviews") { _ = try await api.read("home/reviews", as: HomeReviews.self) }
            await check("home/analytics") { _ = try await api.read("home/analytics", as: HomeAnalytics.self) }
            await check("tasks/board") { _ = try await api.read("tasks/board", as: TaskBoardResponse.self) }
            await check("tasks/week") { _ = try await api.read("tasks/week", as: WeekBoardResponse.self) }
            await check("tasks/process") { _ = try await api.read("tasks/process", as: ProcessResponse.self) }

            var employeeId: String?
            await check("team/employees") {
                employeeId = try await api.read("team/employees", as: TeamEmployeesResponse.self).value.employees.first?.id
            }
            if let employeeId {
                await check("team/employee") { _ = try await api.read("team/employee", ["id": employeeId], as: TeamEmployeeResponse.self) }
            }
            await check("team/payroll") { _ = try await api.read("team/payroll", as: TeamPayrollResponse.self) }

            await check("ops/attendanceOverview") { _ = try await api.read("ops/attendanceOverview", as: AttendanceOverview.self) }
            await check("ops/attendanceMonth") { _ = try await api.read("ops/attendanceMonth", as: AttendanceMonth.self) }
            await check("ops/requests") { _ = try await api.read("ops/requests", as: OpsRequests.self) }
            await check("ops/siteVisits") { _ = try await api.read("ops/siteVisits", as: [SiteVisit].self) }
            await check("ops/settings") { _ = try await api.read("ops/settings", as: OpsSettings.self) }
            await check("ops/automationPreview") { _ = try await api.read("ops/automationPreview", as: AutomationPreview.self) }

            await check("whatsapp/line") { _ = try await api.read("whatsapp/line", as: WhatsAppLineResponse.self) }
            await check("whatsapp/link-status") { _ = try await api.read("whatsapp/link-status", as: WhatsAppLinkState.self) }
            var chatId: String?
            await check("whatsapp/inbox") {
                chatId = try await api.read("whatsapp/inbox", ["limit": "40"], as: WhatsAppInboxResponse.self).value.chats.first?.id
            }
            if let chatId {
                await check("whatsapp/messages") { _ = try await api.read("whatsapp/messages", ["chatId": chatId, "limit": "40"], as: WhatsAppThreadResponse.self) }
            }
        } else {
            await check("me") { _ = try await api.fetchMe() }
            await check("today") { _ = try await api.fetchToday() }
            await check("tasks open") { _ = try await api.fetchTasks(filter: .open) }
            await check("notifications") { _ = try await api.fetchNotifications() }
            await check("me/jobs") { _ = try await api.read("me/jobs", ["filter": "open"], as: AssignedJobsResponse.self) }
            await check("me/requests") { _ = try await api.read("me/requests", as: RequestsResponse.self) }
            await check("me/profile") { _ = try await api.read("me/profile", as: ProfileResponse.self) }
        }

        print("DECODE DONE passed=\(passed) failed=\(failed)")
    }
}
#endif
