import SwiftUI

/// A question about this task, sent into a chat
/// (components/employee/ask-about-task.tsx; lib/task-questions.ts).
///
/// It goes to the manager privately or to the company's group — whoever is
/// asking chooses, because "when is this due" is the manager's to answer and
/// "who has the keys" is anybody's. The message carries the task's name, and
/// sending it opens that chat: the answer comes back there, and so does the
/// rest of the conversation. Under the box, what was already asked about it
/// and where.
///
/// The form says which task and where, and nothing else: who is asking is
/// the session's, and the server finds the task as theirs.
struct AskAboutTaskCard: View {
    /// "board" (a step on a project) or "assigned" (a job handed out by hand).
    let kind: String
    let id: String
    /// Drawn from a saved copy: nothing can be sent.
    var isOffline = false
    #if DEBUG
    /// The debug router's fixture for "already asked".
    var previewAsked: [AskedQuestion]?
    #endif

    @EnvironmentObject var api: APIClient
    @State private var destination = "manager"
    @State private var text = ""
    @State private var sending = false
    @State private var error: String?
    @State private var asked: [AskedQuestion] = []
    @State private var openedChat: ChatRoute?
    @FocusState private var focused: Bool

    /// The website's own limit on one question (QUESTION_MAX).
    private static let limit = 2000

    var body: some View {
        SectionCard(
            L("Ask about this task"),
            subtitle: L("Your question goes into the chat with this task's name on it, and the answer comes back there."),
            symbol: "questionmark.bubble.fill",
            hue: .cyan
        ) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    choice("manager", title: L("The manager"), hint: L("Only the two of you"), symbol: "person.fill")
                    choice("team", title: L("Team group"), hint: L("Everybody sees it"), symbol: "person.3.fill")
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(L("Who to ask"))

                NeonTextEditor(
                    L("Your question"), text: $text, prompt: L("What do you need to know?"),
                    minLines: 3, maxLines: 6, error: error, focus: $focused
                )
                // What was wrong a moment ago is being put right.
                .onChange(of: text) { _ in if error != nil { error = nil } }

                NeonButton(
                    destination == "team" ? L("Ask the group") : L("Ask the manager"),
                    symbol: "paperplane.fill", kind: .brand, isLoading: sending
                ) {
                    await send()
                }
                .disabled(isOffline || sending)

                if !asked.isEmpty {
                    NeonDivider()
                    VStack(spacing: 8) {
                        ForEach(asked) { question in
                            Button {
                                Haptic.tap()
                                Task { await open(question.where) }
                            } label: {
                                askedRow(question)
                            }
                            .buttonStyle(.pressableCard)
                        }
                    }
                }
            }
        }
        .task(id: id) {
            #if DEBUG
            if let previewAsked {
                asked = previewAsked
                return
            }
            #endif
            asked = await api.fetchAskedAbout(kind: kind, id: id)
        }
        .navigationDestination(isPresented: Binding(get: { openedChat != nil }, set: { if !$0 { openedChat = nil } })) {
            if let openedChat { ChatRoomView(route: openedChat) }
        }
    }

    private func choice(_ key: String, title: String, hint: String, symbol: String) -> some View {
        let on = destination == key
        let shape = RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
        return Button {
            guard !on else { return }
            Haptic.selection()
            withNeonAnimation(NeonMotion.snappy) { destination = key }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 14, weight: .semibold))
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(.subheadline, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Text(hint)
                        .font(.system(.caption2))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .opacity(0.7)
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(on ? Color.white : Color.neonInk.opacity(0.75))
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                if on {
                    shape.fill(LinearGradient.neonAccent)
                } else {
                    shape.fill(Color.white.opacity(0.9))
                        .overlay(shape.strokeBorder(Color.neonLineStrong, lineWidth: 1))
                }
            }
            .contentShape(shape)
        }
        .buttonStyle(PressableStyle(scale: 0.97))
        .accessibilityAddTraits(on ? .isSelected : [])
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    private func askedRow(_ question: AskedQuestion) -> some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
        let whom = question.where == "team" ? L("You asked the group") : L("You asked the manager")
        return HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text([whom, formattedISODate(question.at)].compactMap { $0 }.joined(separator: " · "))
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextTertiary)
                DirText(question.text, font: .neonSubtitle, color: .neonTextSecondary, fill: false, lineLimit: 2)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.forward")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.neonTextFaint)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(shape.fill(Color.white.opacity(0.6)))
        .overlay(shape.strokeBorder(Color.neonLine, lineWidth: 1))
    }

    private func send() async {
        guard !sending else { return }
        let question = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else {
            error = L("Write your question first.")
            return
        }
        sending = true
        error = nil
        do {
            try await api.askAboutTask(kind: kind, id: id, where: destination, body: String(question.prefix(Self.limit)))
            Haptic.success()
            // Only once it has gone: a question that failed to send is
            // exactly the text somebody wants back.
            text = ""
            focused = false
            asked = await api.fetchAskedAbout(kind: kind, id: id)
            // Into the conversation it went to, where the answer will arrive.
            await open(destination)
        } catch {
            Haptic.error()
            self.error = error.localizedDescription
        }
        sending = false
    }

    /// The manager's private chat or the team's, as this person's own list
    /// names it — a route needs more than the word.
    private func open(_ slug: String) async {
        guard let loaded = try? await api.fetchConversations(),
              let match = loaded.value.conversations.first(where: { $0.slug == slug }) else {
            Toast.success(L("Sent. The answer will come in the chat."))
            return
        }
        openedChat = ChatRoute(match)
    }
}
