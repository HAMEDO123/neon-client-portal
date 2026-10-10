import SwiftUI

// Jobs the manager (or whoever they trust with Assign) hands out directly,
// outside any project — `AssignedTask` on the server, `/employee/assigned/[id]`
// on the web. Used by TasksView (this person's own jobs) and by AssignRootView
// (that week's jobs, for whoever is handing them out).

/// A job to open, by id.
struct JobRoute: Hashable {
    let id: String
}

/// One job in a list — the board's `TaskRow`, shaped for a job instead of a
/// board cell.
struct JobRow: View {
    let job: MyAssignedJob

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconTile("shippingbox.fill", hue: .purple, size: 38)

            VStack(alignment: .leading, spacing: 5) {
                // `fill: false` so the block hugs the leading edge instead of
                // stretching to the chevron's edge — with `fill: true` (the
                // default) an Arabic title sits flush against the chevron
                // while the rest of the card sits at the leading edge.
                DirText(job.title, font: .neonRowTitle, fill: false)
                Text(L("Handed out directly"))
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextTertiary)

                FlowRow {
                    meStateBadge(job.state)
                    priorityChip(job.priority)
                    lateBadge(job.late)
                }
                MetaLabel(jobDateRange(startKey: job.startKey, endKey: job.endKey), symbol: "calendar")
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.forward")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.neonTextFaint)
                .padding(.top, 8)
        }
        .padding(.vertical, 4)
        .taskPriorityWash(job.priority, state: job.state)
    }
}

/// One job the manager handed out directly — laid out and working like a task
/// from the board, because the person doing it should not learn two sets of
/// rules for two kinds of work. "Done" is never offered here either.
struct JobDetailView: View {
    let jobId: String

    @EnvironmentObject var api: APIClient
    @State private var job: MyAssignedJob?
    @State private var submissions: [JobSubmission] = []
    /// From a chat's task card: discussed under that card, so no second
    /// place to ask is offered here.
    @State private var fromChat = false
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var actionError: String?
    @State private var showProof = false
    @State private var justSubmitted = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let cachedAt { OfflineBanner(savedAt: cachedAt) }

                if let job {
                    header(job)
                    actions(job)
                    detail(job)
                    if !submissions.isEmpty { sentSection }
                    if !fromChat, api.identity?.id == job.employeeId {
                        AskAboutTaskCard(kind: "assigned", id: job.id, isOffline: cachedAt != nil)
                    }
                } else if let errorMessage {
                    ErrorState(message: errorMessage) { await load() }
                } else {
                    SkeletonRows(count: 3)
                }
            }
            .padding(16)
        }
        .refreshable { await load() }
        .navigationTitle(L("Task"))
        .navigationBarTitleDisplayMode(.inline)
        .neonAmbientBackground()
        .task { await load() }
        .sheet(isPresented: $showProof) {
            if let job {
                ProofSheet(
                    targetId: job.id,
                    title: job.title,
                    subtitle: L("Handed out directly"),
                    acceptance: linesOf(job.acceptance)
                ) {
                    justSubmitted = true
                    Task { await load() }
                }
            }
        }
        .alert(L("That didn't go through"), isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button(L("OK"), role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    private func header(_ job: MyAssignedJob) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                BadgeView(text: L("Handed out directly"), tone: .neutral, symbol: "shippingbox.fill")
                Spacer()
            }
            DirText(job.title, font: .neonTitle2)
            FlowRow {
                meStateBadge(job.state)
                priorityChip(job.priority)
            }
            MetaLabel(jobDateRange(startKey: job.startKey, endKey: job.endKey), symbol: "calendar", tint: .neonTextSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonAppear()
    }

    @ViewBuilder
    private func actions(_ job: MyAssignedJob) -> some View {
        switch job.state {
        case "SUBMITTED":
            StatusNote(
                symbol: "paperplane.fill",
                tone: .purple,
                title: justSubmitted ? L("Sent. The manager has been told.") : L("With the manager for review"),
                detail: L("It is marked done when the manager approves the proof. If they send it back, it returns here as in progress.")
            )
        case "DONE":
            StatusNote(symbol: "checkmark.seal.fill", tone: .success, title: L("Approved by the manager"), detail: nil)
        default:
            VStack(spacing: NeonSpace.sm) {
                NeonButton(L("Send proof of finished work"), symbol: "camera.fill", kind: .brand) {
                    Haptic.tap()
                    showProof = true
                }
                .disabled(cachedAt != nil)

                if job.state == "IN_PROGRESS" {
                    NeonButton(L("Not started yet"), symbol: "arrow.uturn.backward", kind: .secondary) {
                        await move(to: "TODO")
                    }
                    .disabled(cachedAt != nil)
                } else {
                    NeonButton(L("Start this task"), symbol: "play.fill", kind: .secondary) {
                        await move(to: "IN_PROGRESS")
                    }
                    .disabled(cachedAt != nil)
                }
            }
        }
    }

    @ViewBuilder
    private func detail(_ job: MyAssignedJob) -> some View {
        if job.deliverable?.isEmpty == false || job.acceptance?.isEmpty == false {
            DetailCard(title: L("What counts as finished"), symbol: "package") {
                if let deliverable = job.deliverable, !deliverable.isEmpty {
                    DirText(deliverable, font: .system(size: 14))
                }
                let acceptance = linesOf(job.acceptance)
                if !acceptance.isEmpty { BulletList(lines: acceptance) }
            }
        }
        if let note = job.note, !note.isEmpty {
            DetailCard(title: L("Notes from the manager"), symbol: "text.bubble") {
                DirText(note, font: .system(size: 14))
            }
        }
    }

    private var sentSection: some View {
        DetailCard(title: L("What you sent"), symbol: "camera") {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(submissions) { submission in
                    HStack(alignment: .top, spacing: 12) {
                        RemoteImage(url: resolvedMediaURL(submission.imageUrl), contentMode: .fill)
                            .frame(width: 56, height: 56)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        VStack(alignment: .leading, spacing: 4) {
                            BadgeView(text: submissionLabel(submission.status), tone: submissionTone(submission.status))
                            if let time = formattedISODate(submission.createdAt) {
                                Text(time).font(.neonCaption).foregroundStyle(Color.neonTextTertiary)
                            }
                            if let note = submission.reviewNote, !note.isEmpty {
                                DirText(note, font: .system(size: 13))
                            }
                        }
                    }
                }
            }
        }
    }

    private func submissionLabel(_ status: String) -> String {
        switch status {
        case "APPROVED": return L("Approved")
        case "REJECTED": return L("Sent back")
        default: return L("Waiting for review")
        }
    }

    private func submissionTone(_ status: String) -> BadgeTone {
        switch status {
        case "APPROVED": return .success
        case "REJECTED": return .pink
        default: return .purple
        }
    }

    private func load() async {
        do {
            let loaded = try await api.fetchJobDetail(id: jobId)
            job = loaded.value.job
            submissions = loaded.value.submissions
            fromChat = loaded.value.fromChat ?? false
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func move(to state: String) async {
        do {
            try await api.setJobStatus(id: jobId, state: state)
            Haptic.success()
            await load()
        } catch APIError.unauthorized {
            // Signed out; the root view has already taken over.
        } catch {
            Haptic.error()
            actionError = error.localizedDescription
        }
    }
}
