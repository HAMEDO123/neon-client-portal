import SwiftUI

/// Somebody on the team, as Home's search finds them.
struct HomeSearchPerson: Identifiable {
    let id: String
    let name: String
    let role: String?
    let online: Bool
}

/// The team as Home already knows it: "Right now" has everybody active (and
/// who is here), the day board adds their role.
func homeSearchPeople(now: HomeNow?, day: HomeDay?) -> [HomeSearchPerson] {
    let roles = Dictionary((day?.everyone ?? []).map { ($0.employeeId, $0.role) }, uniquingKeysWith: { first, _ in first })
    if let now {
        return now.people.map { HomeSearchPerson(id: $0.id, name: $0.name, role: roles[$0.id] ?? nil, online: $0.online) }
    }
    return (day?.everyone ?? []).map { HomeSearchPerson(id: $0.employeeId, name: $0.name, role: $0.role, online: false) }
}

/// The header's search: projects (by name, client or place), the team (by
/// name or role) and the manager's conversations (by name), all in one box.
/// Each result opens the real screen for it.
struct HomeSearchView: View {
    let projects: [HomeProject]
    let people: [HomeSearchPerson]
    let onOpen: (HomeRoute) -> Void

    @EnvironmentObject var api: APIClient
    @State private var query = ""
    @State private var conversations: [ConversationSummary]?
    @State private var conversationsError: String?
    @FocusState private var searching: Bool

    /// What the empty screen offers before anything is typed.
    private let suggested = 4

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var foundProjects: [HomeProject] {
        projects.filter { matchesSearch(trimmed, $0.name, $0.clientName, $0.location) }
    }

    private var foundPeople: [HomeSearchPerson] {
        people.filter { matchesSearch(trimmed, $0.name, $0.role) }
    }

    private var foundConversations: [ConversationSummary] {
        (conversations ?? []).filter { matchesSearch(trimmed, $0.title, $0.subtitle) }
    }

    var body: some View {
        NeonScroll(spacing: NeonSpace.stack) {
            HomeSearchBox(text: $query, prompt: L("Projects, people, chats"), focused: $searching)

            if trimmed.isEmpty {
                suggestions
            } else {
                results
            }
        }
        .navigationTitle(L("Search"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadConversations() }
        .task {
            // Opened to type into: the keyboard comes up once the push has
            // settled (focus set during the push itself is dropped).
            try? await Task.sleep(nanoseconds: 450_000_000)
            searching = true
        }
    }

    /// Before anything is typed: the latest projects and the team, straight
    /// from what Home already holds, so the common case is one tap.
    @ViewBuilder
    private var suggestions: some View {
        if projects.isEmpty && people.isEmpty {
            EmptyState(
                symbol: "magnifyingglass",
                title: L("Search the studio"),
                detail: L("Projects by name, client or place; the team by name or role; your conversations by name."),
                hue: .indigo,
                card: true
            )
        } else {
            if !projects.isEmpty {
                SectionHeader(L("Projects"), subtitle: L("Most recently updated first"))
                projectRows(Array(projects.prefix(suggested)))
            }
            if !people.isEmpty {
                SectionHeader(L("People"))
                peopleRows(people)
            }
        }
    }

    @ViewBuilder
    private var results: some View {
        let projectHits = foundProjects
        let peopleHits = foundPeople
        let chatHits = foundConversations

        if !projectHits.isEmpty {
            SectionHeader(L("Projects"), count: projectHits.count)
            projectRows(projectHits)
        }

        if !peopleHits.isEmpty {
            SectionHeader(L("People"), count: peopleHits.count)
            peopleRows(peopleHits)
        }

        if !chatHits.isEmpty {
            SectionHeader(L("Conversations"), count: chatHits.count)
            VStack(spacing: NeonSpace.sm) {
                ForEach(Array(chatHits.enumerated()), id: \.element.id) { index, chat in
                    Button {
                        Haptic.tap()
                        onOpen(.chat(ChatRoute(chat)))
                    } label: {
                        ListCardRow(
                            chat.title,
                            subtitle: chat.subtitle,
                            leading: .avatar(url: chat.avatarURL, name: chat.title, online: chat.online ?? false),
                            count: chat.unread
                        )
                    }
                    .buttonStyle(.pressableCard)
                    .staggered(index)
                }
            }
        } else if let conversationsError {
            StatusNote(symbol: "exclamationmark.triangle.fill", tone: .warning, title: L("Conversations couldn't be searched"), detail: conversationsError)
        }

        if projectHits.isEmpty && peopleHits.isEmpty && chatHits.isEmpty {
            EmptyState(
                symbol: "magnifyingglass",
                title: L("Nothing matches “%@”", trimmed),
                detail: conversations == nil && conversationsError == nil
                    ? L("Still looking through your conversations…")
                    : L("No project, person or conversation has that in its name."),
                hue: .indigo,
                card: true
            )
        }
    }

    private func projectRows(_ list: [HomeProject]) -> some View {
        VStack(spacing: NeonSpace.sm) {
            ForEach(Array(list.enumerated()), id: \.element.id) { index, project in
                Button {
                    Haptic.tap()
                    onOpen(.project(project.id))
                } label: {
                    ListCardRow(
                        project.name,
                        subtitle: project.location.map { "\(project.clientName) · \($0)" } ?? project.clientName,
                        leading: .thumbnail(url: resolvedMediaURL(project.coverImageUrl)),
                        badge: HomePipeline.label(project.pipelineStatus),
                        badgeTone: statusTone(project.pipelineStatus)
                    )
                }
                .buttonStyle(.pressableCard)
                .staggered(index)
            }
        }
    }

    private func peopleRows(_ list: [HomeSearchPerson]) -> some View {
        VStack(spacing: NeonSpace.sm) {
            ForEach(Array(list.enumerated()), id: \.element.id) { index, person in
                Button {
                    Haptic.tap()
                    onOpen(.employee(person.id))
                } label: {
                    ListCardRow(
                        person.name,
                        subtitle: person.role,
                        leading: .avatar(url: nil, name: person.name, online: person.online)
                    )
                }
                .buttonStyle(.pressableCard)
                .staggered(index)
            }
        }
    }

    private func loadConversations() async {
        do {
            conversations = try await api.fetchConversations().value.conversations
            conversationsError = nil
        } catch {
            conversationsError = error.localizedDescription
        }
    }
}

/// The kit's search capsule (`SearchField`: same size, fill, hairline, focus
/// ring and clear button, from the same tokens), with a focus binding so the
/// search screen can open with the keyboard up. The kit's own field keeps its
/// focus private; go back to it once it takes a binding.
struct HomeSearchBox: View {
    @Binding var text: String
    var prompt: String
    var focused: FocusState<Bool>.Binding

    var body: some View {
        let isFocused = focused.wrappedValue
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(isFocused ? Color.neonAccent : Color.neonTextTertiary)
            TextField("", text: $text, prompt: Text(prompt).foregroundColor(Color.neonTextTertiary))
                .font(.system(size: 15))
                .foregroundStyle(Color.neonInk)
                .focused(focused)
                .submitLabel(.search)
                .autocorrectionDisabled()
            if !text.isEmpty {
                Button {
                    Haptic.tap()
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(Color.neonTextFaint)
                }
                .buttonStyle(.plain)
                .transition(.neonPop)
                .accessibilityLabel(L("Clear"))
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 46)
        .background(Capsule().fill(Color.white.opacity(isFocused ? 1 : 0.94)))
        .overlay(
            Capsule()
                .strokeBorder(isFocused ? Color.neonAccent.opacity(0.5) : Color.neonLine, lineWidth: isFocused ? 1.5 : 1)
        )
        .shadow(color: isFocused ? Color.neonAccent.opacity(0.14) : Color.neonShadowTint.opacity(0.06), radius: 10, x: 0, y: 4)
        .animation(NeonMotion.quick, value: isFocused)
        .animation(NeonMotion.snappy, value: text.isEmpty)
        .contentShape(Rectangle())
        .onTapGesture { focused.wrappedValue = true }
    }
}
