#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Add every screen and sheet of this area here, so each can be checked.
///
/// The team's own screens (`me-today` … `me-proof`) read real data through
/// the signed-in session, exactly like every other screen here — but the
/// orchestrator only holds the manager's sign-in, so these can only be
/// screenshotted live once somebody signs in as a team member on the
/// simulator. `more-admin` and `more-employee` need no such session data of
/// their own (the grid itself is static), so both can be shot as the
/// manager. `TodayView` puts `.id("tomorrow")` on its Tomorrow section for
/// `-neonScroll tomorrow`.
enum MeScreens {
    static let ids: [String] = [
        "me-today", "me-tasks", "me-task-detail", "me-job-detail", "me-proof",
        "me-assign", "me-requests", "me-notifications", "me-profile",
        "more-admin", "more-employee",
    ]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "me-today": return AnyView(TodayView())
        case "me-tasks": return AnyView(TasksView())
        case "me-task-detail":
            return debugPushed(DebugAsync(load: {
                try await APIClient.shared.fetchTasks(filter: .all).value.tasks.first
            }) { task in
                TaskDetailView(taskId: task.id)
            })
        case "me-job-detail":
            return debugPushed(DebugAsync(load: {
                try await APIClient.shared.fetchJobs(filter: .all).value.first
            }) { job in
                JobDetailView(jobId: job.id)
            })
        case "me-proof":
            return AnyView(DebugAsync(load: {
                try await APIClient.shared.fetchTasks(filter: .all).value.tasks.first
            }) { task in
                ProofSheet(
                    targetId: task.id,
                    title: task.task.name,
                    subtitle: task.project.name,
                    evidence: linesOf(task.task.evidence),
                    acceptance: linesOf(task.effectiveAcceptance)
                ) {}
            })
        case "me-assign": return debugPushed(AssignRootView())
        case "me-requests": return debugPushed(MyRequestsRootView())
        case "me-notifications": return debugPushed(NotificationsView())
        case "me-profile": return debugPushed(ProfileRootView())
        case "more-admin": return AnyView(AdminMoreView())
        case "more-employee": return AnyView(EmployeeMoreView())
        default: return nil
        }
    }
}
#endif
