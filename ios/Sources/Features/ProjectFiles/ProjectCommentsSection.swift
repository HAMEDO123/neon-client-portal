import SwiftUI

// The client's feedback thread — the web's comments tab
// (src/app/admin/(dashboard)/projects/[id]/comments/page.tsx): resolve or
// reopen, and remove. Replying as the studio has no server action on the web
// (see lib/mobile/projectfiles-comments.ts for why); it is offered here all
// the same, since it is what the old admin route already let the studio do.

struct ProjectCommentsSection: View {
    let projectId: String

    @EnvironmentObject private var api: APIClient
    @State private var comments: [PFComment]?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var toDelete: PFComment?
    @State private var replyText = ""
    @State private var replyRef = ""
    @State private var showReply = false
    @State private var sending = false

    var body: some View {
        VStack(alignment: .leading, spacing: NeonSpace.lg) {
            SectionHeader(L("Comments"), count: comments?.count) {
                IconButton("arrowshape.turn.up.left", label: L("Reply")) {
                    withNeonAnimation(.snappy) { showReply.toggle() }
                }
            }

            if showReply { replyBox }

            LoadStateView(value: comments, error: errorMessage, cachedAt: cachedAt, retry: load) { rows in
                if rows.isEmpty {
                    EmptyState(
                        symbol: "bubble.left.and.bubble.right",
                        title: L("No comments yet"),
                        detail: L("Client feedback and change requests appear here."),
                        hue: .blue,
                        card: true
                    )
                } else {
                    VStack(spacing: 10) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { index, comment in
                            commentCard(comment)
                                .staggered(index)
                        }
                    }
                }
            }
        }
        .task { await load() }
        .confirmDestructive(item: $toDelete, title: { _ in L("Delete this comment?") }, actionTitle: L("Delete")) { comment in
            Task { await delete(comment) }
        }
    }

    private var replyBox: some View {
        VStack(alignment: .leading, spacing: 10) {
            NeonTextField(L("Referring to (optional)"), text: $replyRef, prompt: L("e.g. Living Room drawing"))
            NeonTextEditor(L("Reply as NEON Team"), text: $replyText, minLines: 2, maxLines: 6)
            NeonButton(L("Send reply"), symbol: "paperplane.fill", size: .medium, isLoading: sending) {
                await sendReply()
            }
            .disabled(replyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(14)
        .neonSurface(.tinted(.neonCyan), radius: NeonRadius.lg)
        .transition(.neonSlideUp)
    }

    private func commentCard(_ comment: PFComment) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                DirText(comment.authorName, font: .system(size: 14, weight: .semibold), color: .neonInk, fill: false, lineLimit: 1)
                if comment.authorType == "ADMIN" {
                    BadgeView(text: L("Studio"), tone: .purple)
                }
                if let refLabel = comment.refLabel, !refLabel.isEmpty {
                    BadgeView(text: refLabel, tone: .cyan)
                }
                Spacer(minLength: 4)
                BadgeView(text: comment.status == "OPEN" ? L("Open") : L("Resolved"), tone: comment.status == "OPEN" ? .warning : .success)
            }
            DirText(comment.message, font: .system(size: 14.5), color: .neonInk.opacity(0.85), fill: false)
            HStack {
                Text(formattedISODate(comment.createdAt) ?? "")
                    .font(.system(size: 11)).foregroundStyle(Color.neonTextFaint)
                Spacer()
                Button {
                    Task { await toggleStatus(comment) }
                } label: {
                    Text(comment.status == "OPEN" ? L("Mark Resolved") : L("Reopen"))
                        .font(.system(size: 12.5, weight: .semibold))
                }
                .buttonStyle(.neon(.secondary, size: .small))
                Button(role: .destructive) { toDelete = comment } label: {
                    Image(systemName: "trash").foregroundStyle(.red)
                }
            }
        }
        .padding(14)
        .neonSurface(.glass, radius: NeonRadius.lg)
    }

    // MARK: Networking

    private func load() async {
        do {
            let loaded = try await api.fetchProjectComments(projectId: projectId)
            comments = loaded.value.comments
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func toggleStatus(_ comment: PFComment) async {
        do {
            try await api.resolveComment(projectId: projectId, id: comment.id, status: comment.status == "OPEN" ? "RESOLVED" : "OPEN")
            Haptic.success()
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func delete(_ comment: PFComment) async {
        do {
            try await api.deleteComment(projectId: projectId, id: comment.id)
            Haptic.success()
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func sendReply() async {
        sending = true
        defer { sending = false }
        do {
            try await api.replyToComment(projectId: projectId, message: replyText, refLabel: replyRef.isEmpty ? nil : replyRef)
            Haptic.success()
            Toast.success(L("Reply sent"))
            replyText = ""
            replyRef = ""
            withNeonAnimation(.snappy) { showReply = false }
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}
