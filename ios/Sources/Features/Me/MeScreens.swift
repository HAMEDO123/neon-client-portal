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
        // TodayView, EmployeeMoreView and NotificationsView all declare
        // `@EnvironmentObject var store: StaffStore`, which nothing here
        // injected — DebugScreenHost hands out an APIClient only, so opening
        // any of these hit SwiftUI's fatal missing-environment-object error
        // and the app crashed to the Home Screen before drawing a pixel.
        case "me-today": return AnyView(TodayView().environmentObject(StaffStore()))
        case "me-tasks": return AnyView(TasksView())
        case "me-task-detail":
            return debugPushed(MeDebugAsync(load: {
                try await APIClient.shared.fetchTasks(filter: .all).value.tasks.first
            }) { task in
                TaskDetailView(taskId: task.id)
            })
        case "me-job-detail":
            return debugPushed(MeDebugAsync(load: {
                try await APIClient.shared.fetchJobs(filter: .all).value.first
            }) { job in
                JobDetailView(jobId: job.id)
            })
        case "me-proof":
            return AnyView(MeDebugAsync(load: {
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
        case "me-notifications": return debugPushed(NotificationsView().environmentObject(StaffStore()))
        case "me-profile": return debugPushed(ProfileRootView())
        case "more-admin": return AnyView(AdminMoreView())
        case "more-employee": return AnyView(EmployeeMoreView().environmentObject(StaffStore()))
        default: return nil
        }
    }
}

/// A stand-in for the shared `DebugAsync` (App/DebugScreens.swift), scoped to
/// this area: that one's failure branch is `Text(verbatim: "\(error)")`, which
/// is a raw Swift enum's own description on a blank page — exactly what
/// `me-job-detail` showed the critic when the manager's token was refused
/// fetching a team-only route. `App/DebugScreens.swift` is shared debug
/// infrastructure, not a file this area owns, so rather than edit it this
/// area's own screens (task detail, job detail, proof) go through this
/// near-identical loader instead, whose failure branch is an `ErrorState` on
/// a `NeonScroll` — the same shape every other failure in the app reports.
private struct MeDebugAsync<Value, Content: View>: View {
    let load: @MainActor () async throws -> Value?
    @ViewBuilder let content: (Value) -> Content

    @State private var value: Value?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let value {
                content(value)
            } else if let errorMessage {
                NeonScroll(spacing: NeonSpace.stack) {
                    ErrorState(message: errorMessage) { await attempt() }
                }
                .neonAmbientBackground()
            } else {
                ProgressView()
            }
        }
        .task { await attempt() }
    }

    private func attempt() async {
        do {
            if let loaded = try await load() {
                value = loaded
            } else {
                errorMessage = "Nothing on the server to open this with."
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
#endif
