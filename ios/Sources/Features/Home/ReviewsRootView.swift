import SwiftUI

/// The evidence queue. Nothing on the board reads "Done" until it passes
/// through here — approving writes the completed state, sending it back
/// returns the work to In Progress with the manager's reason. Pushed from
/// More; owns no `NavigationStack`.
struct ReviewsRootView: View {
    @EnvironmentObject var api: APIClient
    @State private var data: HomeReviews?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?

    var body: some View {
        LoadStateView(value: data, error: errorMessage, cachedAt: cachedAt, retry: load) {
            NeonScroll { SkeletonRows(count: 4) }
        } content: { data in
            NeonScroll {
                Text(L("Work your team says is finished, with the proof attached. Approving marks the task complete on the board; sending it back returns it to In Progress with your reason."))
                    .font(.neonFootnote)
                    .foregroundStyle(Color.neonTextSecondary)

                if data.submissions.isEmpty {
                    EmptyState(symbol: "checkmark.seal", title: L("Nothing waiting"), detail: L("When someone finishes a task and sends a photo of it, it appears here."))
                } else {
                    ForEach(data.submissions) { submission in
                        SubmissionCard(submission: submission) { await refreshAfter($0) }
                    }
                }
            }
            .refreshable { Haptic.tap(); await load() }
        }
        .navigationTitle(L("Reviews"))
        .task { await load() }
    }

    private func load() async {
        do {
            let loaded = try await api.fetchHomeReviews()
            data = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func refreshAfter(_ id: String) async {
        // Drop it from view immediately — the server no longer counts it as
        // pending — then reconcile with a real read.
        withNeonAnimation(.snappy) {
            data?.submissions.removeAll { $0.id == id }
        }
        await load()
    }
}

private struct SubmissionCard: View {
    let submission: HomeSubmission
    let onDecided: (String) async -> Void

    @EnvironmentObject var api: APIClient
    @State private var note = ""
    @State private var noteError: String?
    @State private var busy: Busy?
    @Environment(\.openURL) private var openURL

    private enum Busy { case approving, rejecting }

    var body: some View {
        NeonCard {
            HStack(alignment: .top, spacing: NeonSpace.md) {
                attachment
                    .frame(width: 96, height: 84)
                    .clipShape(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))

                VStack(alignment: .leading, spacing: 3) {
                    Text((submission.projectName ?? L("Handed out by you")).uppercased())
                        .font(.neonOverline)
                        .foregroundStyle(Color.neonTextFaint)
                    DirText(submission.name, font: .neonHeadline, fill: false)
                    Text("\(submission.employee.name) · \(formattedISODate(submission.createdAt) ?? submission.createdAt)")
                        .font(.neonFootnote)
                        .foregroundStyle(Color.neonTextSecondary)
                }
                Spacer(minLength: 0)
            }

            if let note = submission.note {
                DirText(note, font: .neonFootnote, color: .neonTextSecondary)
                    .padding(NeonSpace.sm)
                    .neonSurface(.sunken, radius: NeonRadius.sm)
            }

            SubmissionChecksView(checks: submission.checks, outcomeLabel: submission.outcomeLabel, checked: submission.checkedAt != nil)

            VStack(alignment: .leading, spacing: NeonSpace.xs) {
                NeonTextField(L("Note"), text: $note, prompt: L("A note for them (required to send back)"), error: noteError)
                if let noteError {
                    ValidationMessage(noteError)
                }
                HStack(spacing: NeonSpace.sm) {
                    NeonButton(L("Approve"), symbol: "checkmark", kind: .tinted(.neonSuccessStrong), size: .medium, isLoading: busy == .approving) {
                        await approve()
                    }
                    .disabled(busy != nil)

                    NeonButton(L("Send back"), symbol: "arrow.uturn.left", kind: .secondary, size: .medium, isLoading: busy == .rejecting) {
                        await reject()
                    }
                    .disabled(busy != nil)
                }
            }
        }
    }

    @ViewBuilder private var attachment: some View {
        if submission.isImage, let url = resolvedMediaURL(submission.imageUrl) {
            Button { openURL(url) } label: {
                RemoteImage(url: url, contentMode: .fill)
            }
            .buttonStyle(.plain)
        } else {
            Button {
                if let url = resolvedMediaURL(submission.imageUrl) { openURL(url) }
            } label: {
                VStack(spacing: 6) {
                    Image(systemName: "doc.fill").font(.system(size: 22)).foregroundStyle(Color.neonPurpleStrong)
                    Text(submission.fileLabel).font(.neonCaption).foregroundStyle(Color.neonTextSecondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .neonSurface(.sunken, radius: NeonRadius.md)
            }
            .buttonStyle(.plain)
        }
    }

    private func approve() async {
        busy = .approving
        defer { busy = nil }
        do {
            try await api.approveHomeSubmission(submission.id, note: note)
            Haptic.success()
            Toast.success(L("Approved"))
            await onDecided(submission.id)
        } catch {
            Toast.error(error)
        }
    }

    private func reject() async {
        guard !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            noteError = L("Tell them what needs redoing.")
            Haptic.error()
            return
        }
        noteError = nil
        busy = .rejecting
        defer { busy = nil }
        do {
            try await api.rejectHomeSubmission(submission.id, note: note)
            Haptic.success()
            Toast.success(L("Sent back"))
            await onDecided(submission.id)
        } catch {
            Toast.error(error)
        }
    }
}

/// `SubmissionChecks` in submission-checks.tsx, verdict for verdict.
private struct SubmissionChecksView: View {
    let checks: [CriterionCheckRow]
    let outcomeLabel: String?
    let checked: Bool

    var body: some View {
        if !checked {
            StatusNote(
                symbol: "person.crop.circle.badge.questionmark",
                tone: .info,
                title: L("Not checked against the acceptance criteria — this is yours to judge."),
                detail: nil
            )
        } else if checks.isEmpty {
            StatusNote(
                symbol: "exclamationmark.triangle.fill",
                tone: .warning,
                title: L("Nothing is written under \u{201C}Counts as done when\u{201D} for this task, so there was nothing to check it against."),
                detail: nil
            )
        } else {
            VStack(alignment: .leading, spacing: NeonSpace.xs) {
                HStack(spacing: 4) {
                    Text(L("Checked against what you asked for")).font(.neonOverline).foregroundStyle(Color.neonTextFaint)
                    if let outcomeLabel {
                        Text("· \(outcomeLabel)").font(.neonCaption).foregroundStyle(Color.neonTextSecondary)
                    }
                }
                VStack(spacing: 6) {
                    ForEach(checks) { check in
                        CheckRow(check: check)
                    }
                }
                Text(L("A reading of the photo, not a decision. Approving and sending back are still yours."))
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextFaint)
            }
        }
    }
}

private struct CheckRow: View {
    let check: CriterionCheckRow

    var body: some View {
        let look = verdictLook(check.verdict)
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: look.symbol).font(.system(size: 13)).padding(.top, 1)
            VStack(alignment: .leading, spacing: 2) {
                DirText(check.required, font: .neonFootnote.weight(.semibold), fill: false)
                Text(look.label.uppercased()).font(.system(size: 10, weight: .semibold)).opacity(0.75)
                if let evidence = check.evidence {
                    DirText(evidence, font: .neonCaption, fill: false)
                }
                if let gap = check.gap {
                    DirText(gap, font: .neonCaption.weight(.semibold), fill: false)
                }
            }
        }
        .foregroundStyle(look.tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(NeonSpace.sm)
        .neonSurface(.tinted(look.toneBackground), radius: NeonRadius.sm)
    }
}
