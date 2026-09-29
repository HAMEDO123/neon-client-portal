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

    private var tone: BadgeTone { taskStateTone(job.state) }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconTile("shippingbox.fill", hue: .purple, size: 38)

            VStack(alignment: .leading, spacing: 5) {
                DirText(job.title, font: .system(.callout, weight: .semibold))
                Text(L("From the manager"))
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextTertiary)

                FlowRow {
                    BadgeView(text: taskStateLabel(job.state), tone: tone)
                    if let priority = priorityLabel(job.priority) {
                        BadgeView(text: priority, tone: job.priority == "HIGH" ? .pink : .neutral)
                    }
                }
                Label(when, systemImage: "calendar")
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextTertiary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.forward")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.neonTextFaint)
                .padding(.top, 8)
        }
        .padding(.vertical, 4)
    }

    private var when: String {
        let from = formattedDayKey(job.startKey)
        let to = formattedDayKey(job.endKey)
        return job.startKey == job.endKey ? from : "\(from) – \(to)"
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
                    subtitle: L("From the manager"),
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
                BadgeView(text: L("From the manager"), tone: .neutral, symbol: "shippingbox.fill")
                Spacer()
            }
            DirText(job.title, font: .neonTitle2)
            FlowRow {
                BadgeView(text: taskStateLabel(job.state), tone: taskStateTone(job.state))
                if let priority = priorityLabel(job.priority) {
                    BadgeView(text: priority, tone: job.priority == "HIGH" ? .pink : .neutral)
                }
            }
            Label(when(job), systemImage: "calendar")
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonAppear()
    }

    private func when(_ job: MyAssignedJob) -> String {
        let from = formattedDayKey(job.startKey)
        let to = formattedDayKey(job.endKey)
        return job.startKey == job.endKey ? from : "\(from) – \(to)"
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
                    NeonButton(L("Put back to pending"), symbol: "arrow.uturn.backward", kind: .secondary) {
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
