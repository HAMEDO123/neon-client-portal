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
            SectionCard(L("Comments"), subtitle: headerSubtitle, symbol: PFSection.comments.symbol, hue: PFSection.comments.hue) {
                EmptyView()
            } trailing: {
                // A reply offers something to nothing while the thread is
                // empty — the empty state below carries its own action
                // instead — and the glyph is picked for RTL (.backward
                // rather than a hard-coded .left).
                if !(comments?.isEmpty ?? true) {
                    IconButton("square.and.pencil", label: L("Write to the client")) {
                        withNeonAnimation(.snappy) { showReply.toggle() }
                    }
                }
            }

            if showReply { replyBox }

            LoadStateView(value: comments, error: errorMessage, cachedAt: cachedAt, retry: load) { rows in
                if rows.isEmpty {
                    EmptyState(
                        symbol: PFSection.comments.symbol,
                        title: L("No comments yet"),
                        detail: L("Client feedback and change requests appear here."),
                        actionTitle: L("Write to the client"),
                        action: { withNeonAnimation(.snappy) { showReply = true } },
                        hue: PFSection.comments.hue,
                        card: true
                    )
                } else {
                    VStack(spacing: NeonSpace.stack) {
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

    private var headerSubtitle: String {
        guard let comments, !comments.isEmpty else { return L("Client feedback and change requests") }
        let open = comments.filter { $0.status == "OPEN" }.count
        return open > 0 ? L("%d open", open) : L("%d comments", comments.count)
    }

    private var replyBox: some View {
        VStack(alignment: .leading, spacing: 10) {
            NeonTextField(L("Referring to (optional)"), text: $replyRef, prompt: L("e.g. Living Room drawing"))
            NeonTextEditor(L("Reply as NEON Team"), text: $replyText, minLines: 2, maxLines: 6)
            NeonButton(L("Send Reply"), symbol: "paperplane.fill", size: .medium, isLoading: sending) {
                await sendReply()
            }
            .disabled(replyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(14)
        .neonSurface(.tinted(.neonCyan), radius: NeonRadius.lg)
        .transition(.neonSlideUp)
    }

    private func commentCard(_ comment: PFComment) -> some View {
        // The client's change request is settled only when the client says
        // so on their own page — the studio can only say it looked at it.
        // Still success green once the client actually confirms; "OPEN" vs
        // "RESOLVED" is the only state the server tracks today, so this
        // studio-side action reads as a claim, in info tone, rather than a
        // verdict, in success tone, for the state the server can express.
        let isOpen = comment.status == "OPEN"
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                DirText(comment.authorName, font: .neonRowTitle, color: .neonInk, fill: false, lineLimit: 1)
                if comment.authorType == "ADMIN" {
                    BadgeView(text: L("Studio"), tone: .purple)
                }
                if let refLabel = comment.refLabel, !refLabel.isEmpty {
                    BadgeView(text: refLabel, tone: .cyan)
                }
                Spacer(minLength: 4)
                BadgeView(text: isOpen ? L("Open") : L("Addressed · waiting on the client"), tone: isOpen ? .warning : .info)
            }
            DirText(comment.message, font: .neonLabel, color: .neonInk.opacity(0.85), fill: false)
            HStack {
                Text(formattedISODate(comment.createdAt) ?? "")
                    .font(.neonMeta).foregroundStyle(Color.neonTextFaint)
                Spacer()
                Button {
                    Task { await toggleStatus(comment) }
                } label: {
                    Text(isOpen ? L("Mark as Addressed") : L("Reopen"))
                        .font(.system(size: 12.5, weight: .semibold))
                }
                .buttonStyle(.neon(.secondary, size: .small))
                IconButton("trash", label: L("Delete"), look: .plain, tint: .neonDangerStrong, size: NeonSize.touch) {
                    toDelete = comment
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
