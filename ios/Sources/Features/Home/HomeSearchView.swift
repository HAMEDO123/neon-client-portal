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
            SearchField(text: $query, prompt: L("Projects, people, chats"))

            if trimmed.isEmpty {
                SectionCard(L("Search the studio"), symbol: "magnifyingglass", hue: .indigo) {
                    Text(L("Projects by name, client or place; the team by name or role; your conversations by name."))
                        .font(.neonLabel)
                        .foregroundStyle(Color.neonTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .neonAppear()
            } else {
                results
            }
        }
        .navigationTitle(L("Search"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadConversations() }
    }

    @ViewBuilder
    private var results: some View {
        let projectHits = foundProjects
        let peopleHits = foundPeople
        let chatHits = foundConversations

        if !projectHits.isEmpty {
            SectionHeader(L("Projects"), count: projectHits.count)
            VStack(spacing: NeonSpace.sm) {
                ForEach(Array(projectHits.enumerated()), id: \.element.id) { index, project in
                    Button {
                        Haptic.tap()
                        onOpen(.project(project.id))
                    } label: {
                        ListCardRow(
                            project.name,
                            subtitle: project.location.map { "\(project.clientName) · \($0)" } ?? project.clientName,
                            leading: (project.coverImageUrl ?? "").isEmpty
                                ? .icon("folder.fill", tint: .neonBlueStrong)
                                : .thumbnail(url: resolvedMediaURL(project.coverImageUrl)),
                            badge: HomePipeline.label(project.pipelineStatus),
                            badgeTone: statusTone(project.pipelineStatus)
                        )
                    }
                    .buttonStyle(.pressableCard)
                    .staggered(index)
                }
            }
        }

        if !peopleHits.isEmpty {
            SectionHeader(L("People"), count: peopleHits.count)
            VStack(spacing: NeonSpace.sm) {
                ForEach(Array(peopleHits.enumerated()), id: \.element.id) { index, person in
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

    private func loadConversations() async {
        do {
            conversations = try await api.fetchConversations().value.conversations
            conversationsError = nil
        } catch {
            conversationsError = error.localizedDescription
        }
    }
}
