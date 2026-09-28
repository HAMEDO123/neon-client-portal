import PhotosUI
import SwiftUI

/// Everything on this person's plate, from `/tasks` — whose work it is is
/// decided on the server by `ownedBy`, and this list only mirrors it.
struct TasksView: View {
    @EnvironmentObject var api: APIClient
    @State private var filter: TaskFilter = .open
    @State private var tasks: [StaffTask]?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @StateObject private var cards = ChatCardsLoader()
    @State private var proofFor: ProofTarget?
    @State private var web: WebPortalLink?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    // Jobs handed out on the week board have no phone route
                    // yet (ios/SERVER-REQUEST.md); the website's list has them.
                    WebTile(title: L("My week on the web"), symbol: "calendar") {
                        web = WebPortalLink(path: "/employee/tasks", title: L("My week"))
                    }

                    Picker(L("Show"), selection: $filter) {
                        ForEach(TaskFilter.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    if let cachedAt { OfflineBanner(savedAt: cachedAt) }

                    if let tasks {
                        SectionLabel(L("On the project board"))
                        if tasks.isEmpty {
                            EmptyState(
                                symbol: "checklist",
                                title: filter == .completed ? L("No approved work yet") : L("Nothing on your list"),
                                detail: filter == .open ? L("Work the manager puts on the board for you appears here.") : nil
                            )
                            .glassCard(radius: 18)
                        } else {
                            TaskList(tasks: tasks)
                        }

                        MyChatJobsSection(filter: filter, cards: cards, viewer: api.identity) { part, card in
                            proofFor = ProofTarget(id: part.id, title: card.title, detail: card.description)
                        }
                    } else if let errorMessage {
                        ErrorState(message: errorMessage) { await load() }
                    } else {
                        SkeletonRows(count: 5)
                    }
                }
                .padding(16)
            }
            .refreshable {
                Haptic.tap()
                await load()
                await cards.load(api)
            }
            .navigationTitle(L("Tasks"))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { AccountMenu() }
            }
            .navigationDestination(for: TaskRoute.self) { route in
                TaskDetailView(taskId: route.id)
            }
            .navigationDestination(for: ChatRoute.self) { ChatRoomView(route: $0) }
            .neonAmbientBackground()
        }
        .task(id: filter) {
            tasks = nil
            await load()
        }
        .task { await cards.load(api) }
        .sheet(item: $proofFor) { target in
            ProofSheet(targetId: target.id, title: target.title, subtitle: target.detail) {
                Task { await cards.load(api) }
            }
        }
        .fullScreenCover(item: $web) { WebPortalSheet(link: $0) }
    }

    private func load() async {
        do {
            let loaded = try await api.fetchTasks(filter: filter)
            tasks = loaded.value.tasks
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - One task

/// One task with everything the person doing it needs: what to hand in, what
/// counts as done, what it waits on. The only moves offered are the ones the
/// server allows an employee: start it, put it back, or send proof. "Done" is
/// the manager's word, after reviewing the proof — there is no button for it.
struct TaskDetailView: View {
    let taskId: String

    @EnvironmentObject var api: APIClient
    @State private var task: StaffTask?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var working = false
    @State private var actionError: String?
    @State private var showProof = false
    @State private var justSubmitted = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let cachedAt { OfflineBanner(savedAt: cachedAt) }

                if let task {
                    header(task)
                    actions(task)
                    detail(task)
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
            if let task {
                ProofSheet(
                    targetId: task.id,
                    title: task.task.name,
                    subtitle: task.project.name,
                    evidence: linesOf(task.task.evidence),
                    acceptance: linesOf(task.effectiveAcceptance)
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

    // MARK: Parts

    private func header(_ task: StaffTask) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            DirText(task.task.name, font: .system(size: 24, weight: .bold, design: .rounded))
            DirText(
                [task.project.name, task.project.clientName, task.project.location]
                    .compactMap { $0?.isEmpty == false ? $0 : nil }
                    .joined(separator: " · "),
                font: .system(size: 14),
                color: .neonInk.opacity(0.55)
            )
            FlowRow {
                BadgeView(text: taskStateLabel(task.state), tone: taskStateTone(task.state))
                if let priority = priorityLabel(task.priority) {
                    BadgeView(text: priority, tone: task.priority == "HIGH" ? .pink : .neutral)
                }
                if let estimate = task.effectiveEstimate {
                    BadgeView(text: L("≈ %@ h", estimate.formatted(.number.precision(.fractionLength(0...1)))), tone: .cyan)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                if let day = formattedDay(task.scheduledFor) {
                    Label(L("On the day: %@", day), systemImage: "calendar")
                }
                if let due = formattedISODate(task.dueAt) {
                    Label(L("Due %@", due), systemImage: "clock")
                }
            }
            .font(.system(size: 13))
            .foregroundStyle(Color.neonInk.opacity(0.6))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func actions(_ task: StaffTask) -> some View {
        switch task.state {
        case "SUBMITTED":
            StatusNote(
                symbol: "paperplane.fill",
                tone: .purple,
                title: justSubmitted ? L("Sent. The manager has been told.") : L("With the manager for review"),
                detail: L("It is marked done when the manager approves the proof. If they send it back, it returns here as in progress.")
            )
        case "DONE":
            StatusNote(
                symbol: "checkmark.seal.fill",
                tone: .success,
                title: L("Approved by the manager"),
                detail: formattedISODate(task.completedAt).map { L("Approved %@", $0) }
            )
        default:
            VStack(spacing: 10) {
                Button {
                    Haptic.tap()
                    showProof = true
                } label: {
                    Label(L("Send proof of finished work"), systemImage: "camera.fill")
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                }
                .background(Color.neonInk, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .foregroundStyle(.white)
                .buttonStyle(.pressable)

                if task.state == "IN_PROGRESS" {
                    moveButton(L("Put back to pending"), symbol: "arrow.uturn.backward", to: "TODO", task: task)
                } else {
                    moveButton(L("Start this task"), symbol: "play.fill", to: "IN_PROGRESS", task: task)
                }
            }
            .disabled(working || cachedAt != nil)
        }
    }

    private func moveButton(_ title: String, symbol: String, to state: String, task: StaffTask) -> some View {
        Button {
            Task { await move(task, to: state) }
        } label: {
            HStack {
                if working { ProgressView() } else { Image(systemName: symbol) }
                Text(title)
            }
            .font(.system(size: 15, weight: .semibold, design: .rounded))
            .frame(maxWidth: .infinity)
            .frame(height: 46)
            .foregroundStyle(Color.neonInk)
            .background(Color.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.neonInk.opacity(0.12)))
        }
        .buttonStyle(.pressable)
    }

    @ViewBuilder
    private func detail(_ task: StaffTask) -> some View {
        if let reason = task.blockedReason, !reason.isEmpty {
            DetailCard(title: L("Blocked"), symbol: "hand.raised.fill", tint: .neonOrangeStrong) {
                DirText(reason, font: .system(size: 14))
                if let by = task.blockedBy {
                    Text(L("Waiting on %@", by.name))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.neonInk.opacity(0.55))
                }
            }
        }

        if !task.waitingOn.isEmpty {
            DetailCard(title: L("Waits for"), symbol: "hourglass", tint: .neonOrangeStrong) {
                ForEach(task.waitingOn, id: \.id) { dependency in
                    HStack {
                        DirText(dependency.task.name, font: .system(size: 14))
                        BadgeView(text: taskStateLabel(dependency.state), tone: taskStateTone(dependency.state))
                    }
                }
            }
        }

        if let deliverable = task.effectiveDeliverable {
            DetailCard(title: L("What to hand in"), symbol: "shippingbox") {
                DirText(deliverable, font: .system(size: 14))
            }
        }

        let acceptance = linesOf(task.effectiveAcceptance)
        if !acceptance.isEmpty {
            DetailCard(
                title: L("Counts as done when"),
                symbol: "checkmark.circle",
                footnote: task.acceptanceIsFromStep ? L("The studio's standard for this step.") : nil
            ) {
                BulletList(lines: acceptance)
            }
        }

        let evidence = linesOf(task.task.evidence)
        if !evidence.isEmpty {
            DetailCard(title: L("Proof to send"), symbol: "camera") {
                BulletList(lines: evidence)
            }
        }

        let checklist = linesOf(task.task.checklist)
        if !checklist.isEmpty {
            // A reminder with nothing to tick: a ticked box would be a claim,
            // and a claim here has exactly one route — the proof.
            DetailCard(title: L("Checklist"), symbol: "list.bullet") {
                BulletList(lines: checklist)
            }
        }

        if let note = task.adminNote, !note.isEmpty {
            DetailCard(title: L("From the manager"), symbol: "text.bubble") {
                DirText(note, font: .system(size: 14))
            }
        }

        if let next = task.nextStep, !next.isEmpty {
            DetailCard(title: L("Next step"), symbol: "arrow.forward.circle") {
                DirText(next, font: .system(size: 14))
            }
        }

        if let update = task.lastUpdateNote, !update.isEmpty {
            DetailCard(title: L("Last update"), symbol: "clock.arrow.circlepath", footnote: formattedISODate(task.lastUpdateAt)) {
                DirText(update, font: .system(size: 14))
            }
        }

        if let own = task.employeeNote, !own.isEmpty {
            DetailCard(title: L("Your note"), symbol: "pencil") {
                DirText(own, font: .system(size: 14))
            }
        }
    }

    // MARK: Loading and moving

    private func load() async {
        do {
            let loaded = try await api.fetchTask(id: taskId)
            task = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func move(_ task: StaffTask, to state: String) async {
        working = true
        defer { working = false }
        do {
            try await api.setTaskState(id: task.id, state: state)
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
