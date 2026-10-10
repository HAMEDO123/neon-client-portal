import PhotosUI
import SwiftUI

/// Everything on this person's plate — whose work it is is decided on the
/// server by `ownedBy`, and this list only mirrors it.
///
/// Read once, whole (`me/tasks/mine`), and narrowed here: each button says
/// how many it holds, and a count needs the tasks the list is not showing.
/// The rules are the website's (TaskListFilter.swift), so the numbers match.
struct TasksView: View {
    @EnvironmentObject var api: APIClient
    @State private var filter: TaskFilter = .open
    @State private var mine: MyTasksResponse?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @StateObject private var cards = ChatCardsLoader()
    @State private var proofFor: ProofTarget?
    #if DEBUG
    /// The debug router's fixture: drawn from a fixed answer, reading nothing.
    private var isPreview = false

    init(preview: MyTasksResponse? = nil, filter: TaskFilter = .open) {
        _mine = State(initialValue: preview)
        _filter = State(initialValue: filter)
        isPreview = preview != nil
    }
    #endif

    var body: some View {
        NavigationStack {
            // Not lazy: a handful of long sections, and a lazy stack re-measuring
            // one it had let go of moved the page under the reader's finger.
            NeonScroll(spacing: NeonSpace.stack, lazy: false) {
                ScreenHeader(L("Tasks")) {
                    AccountMenu()
                }

                if let cachedAt { OfflineBanner(savedAt: cachedAt) }

                if let mine {
                    TaskFilterBar(selection: $filter, options: TaskFilter.mine, counts: counts(mine), mine: true)

                    let board = boardTasks(mine)
                    let jobs = handedJobs(mine)
                    let fromChat = MyChatJobsSection.parts(cards: cards, viewer: api.identity, filter: filter, standing: standing(mine))

                    if board.isEmpty && jobs.isEmpty && fromChat.isEmpty {
                        EmptyState(symbol: "checklist", title: emptyTitle, detail: emptyDetail, hue: .blue, card: true)
                    }

                    if !board.isEmpty {
                        SectionCard(L("On the project board"), subtitle: L("%d on the board", board.count), symbol: "square.stack.3d.up.fill", hue: .blue) {
                            VStack(spacing: NeonSpace.sm) {
                                ForEach(Array(board.enumerated()), id: \.element.id) { index, task in
                                    NavigationLink(value: TaskRoute(id: task.id)) {
                                        TodayTaskRow(task: task)
                                    }
                                    .buttonStyle(.pressableCard)
                                    .staggered(index)
                                    if task.id != board.last?.id { NeonDivider() }
                                }
                            }
                        }
                    }

                    if !jobs.isEmpty {
                        SectionCard(L("Handed to you"), subtitle: L("%d handed to you directly", jobs.count), symbol: "shippingbox.fill", hue: .purple) {
                            VStack(spacing: NeonSpace.sm) {
                                ForEach(Array(jobs.enumerated()), id: \.element.id) { index, job in
                                    NavigationLink(value: JobRoute(id: job.id)) {
                                        JobRow(job: job)
                                    }
                                    .buttonStyle(.pressableCard)
                                    .staggered(index)
                                    if job.id != jobs.last?.id { NeonDivider() }
                                }
                            }
                        }
                    }

                    MyChatJobsSection(parts: fromChat) { part, card in
                        proofFor = ProofTarget(id: part.id, title: card.title, detail: card.description)
                    }
                } else if let errorMessage {
                    ErrorState(message: errorMessage) { await load() }
                } else {
                    SkeletonRows(count: 5)
                }
            }
            .refreshable {
                Haptic.tap()
                await load()
                await cards.load(api)
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: TaskRoute.self) { route in
                TaskDetailView(taskId: route.id)
            }
            .navigationDestination(for: JobRoute.self) { route in
                JobDetailView(jobId: route.id)
            }
            .navigationDestination(for: ChatRoute.self) { ChatRoomView(route: $0) }
            .neonAmbientBackground()
        }
        // Runs again each time the tab comes back into view, and reads the
        // list again in place: what is on screen stays, where it was.
        .task { await load() }
        .task { await cards.load(api) }
        .sheet(item: $proofFor) { target in
            ProofSheet(targetId: target.id, title: target.title, subtitle: target.detail) {
                Task {
                    await load()
                    await cards.load(api)
                }
            }
        }
    }

    // MARK: Narrowing

    /// Everything the buttons count: the board's steps and the jobs handed
    /// out by hand, as the website counts them. (A task card from a chat is
    /// one of those jobs, so it is already in the number.)
    private func counts(_ mine: MyTasksResponse) -> [TaskFilter: Int] {
        TaskFilter.counts(
            mine.tasks.map { TaskStanding(state: $0.state, late: $0.late ?? false) }
                + mine.jobs.map { TaskStanding(state: $0.state, late: $0.late ?? false) }
        )
    }

    /// Soonest due first, then the higher priority — the website's order.
    /// Work with no date at all sorts after everything that has one.
    private func boardTasks(_ mine: MyTasksResponse) -> [StaffTask] {
        mine.tasks
            .filter { filter.matches(TaskStanding(state: $0.state, late: $0.late ?? false)) }
            .sorted { Self.before(($0.dueKey, $0.priority), ($1.dueKey, $1.priority)) }
    }

    private func handedJobs(_ mine: MyTasksResponse) -> [MyAssignedJob] {
        mine.jobs
            .filter { filter.matches(TaskStanding(state: $0.state, late: $0.late ?? false)) }
            .sorted { Self.before(($0.endKey, $0.priority), ($1.endKey, $1.priority)) }
    }

    /// Where a job stands, by its id — for a chat's task card, whose part is
    /// one of these jobs.
    private func standing(_ mine: MyTasksResponse) -> [String: TaskStanding] {
        Dictionary(mine.jobs.map { ($0.id, TaskStanding(state: $0.state, late: $0.late ?? false)) }, uniquingKeysWith: { first, _ in first })
    }

    private static func before(_ a: (due: String?, priority: String?), _ b: (due: String?, priority: String?)) -> Bool {
        let noDate = "9999-12-31"
        let (dueA, dueB) = (a.due ?? noDate, b.due ?? noDate)
        if dueA != dueB { return dueA < dueB }
        return rank(a.priority) < rank(b.priority)
    }

    private static func rank(_ priority: String?) -> Int {
        switch priority {
        case "HIGH": return 0
        case "LOW": return 2
        default: return 1
        }
    }

    // What an empty list says, which depends on what was asked for. Not "no
    // tasks assigned" under Open: somebody whose work is all with the manager
    // has plenty assigned, and none of it is theirs to do right now.
    private var emptyTitle: String {
        switch filter {
        case .open: return L("Nothing to do right now")
        case .all: return L("No tasks assigned")
        case .progress: return L("Nothing in progress")
        case .review: return L("Nothing waiting for review")
        case .late: return L("Nothing is late")
        case .done: return L("Nothing completed yet")
        }
    }

    private var emptyDetail: String {
        switch filter {
        case .open: return L("Work you have sent in is under Sent for review. New work appears here and you get a notification.")
        case .all: return L("Work the manager gives you appears here and you get a notification.")
        case .progress: return L("Start a task and it is listed here.")
        case .review: return L("Work you send in stays here until the manager has looked at it.")
        case .late: return L("Work that passes its day without being approved shows here.")
        case .done: return L("Tasks you finish will be listed here.")
        }
    }

    private func load() async {
        #if DEBUG
        if isPreview { return }
        #endif
        do {
            let loaded = try await api.fetchMyTasks()
            mine = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            if mine == nil { errorMessage = error.localizedDescription }
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
    @State private var actionError: String?
    @State private var showProof = false
    @State private var justSubmitted = false
    @State private var followUp: FollowUpQuestion?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NeonSpace.stack) {
                if let cachedAt { OfflineBanner(savedAt: cachedAt) }

                if let task {
                    header(task)
                    if let followUp {
                        FollowUpCard(question: followUp) { self.followUp = nil }
                            .transition(.neonRise)
                    }
                    actions(task)
                    detail(task)
                    AskAboutTaskCard(kind: "board", id: task.id, isOffline: cachedAt != nil)
                } else if let errorMessage {
                    ErrorState(message: errorMessage) { await load() }
                } else {
                    SkeletonRows(count: 3)
                }
            }
            .padding(NeonSpace.gutter)
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
            DirText(task.task.name, font: .neonTitle2)
            DirText(
                [task.project.name, task.project.clientName, task.project.location]
                    .compactMap { $0?.isEmpty == false ? $0 : nil }
                    .joined(separator: " · "),
                font: .neonSubtitle,
                color: .neonTextSecondary
            )
            FlowRow {
                meStateBadge(task.state)
                priorityChip(task.priority)
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
            .font(.neonFootnote)
            .foregroundStyle(Color.neonTextSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonAppear()
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
            VStack(spacing: NeonSpace.sm) {
                NeonButton(L("Send proof of finished work"), symbol: "camera.fill", kind: .brand) {
                    Haptic.tap()
                    showProof = true
                }
                .disabled(cachedAt != nil)

                if task.state == "IN_PROGRESS" {
                    NeonButton(L("Not started yet"), symbol: "arrow.uturn.backward", kind: .secondary) {
                        await move(task, to: "TODO")
                    }
                    .disabled(cachedAt != nil)
                } else {
                    NeonButton(L("Start this task"), symbol: "play.fill", kind: .secondary) {
                        await move(task, to: "IN_PROGRESS")
                    }
                    .disabled(cachedAt != nil)
                }
            }
        }
    }

    @ViewBuilder
    private func detail(_ task: StaffTask) -> some View {
        if let reason = task.blockedReason, !reason.isEmpty {
            DetailCard(title: L("Blocked"), symbol: "hand.raised.fill", tint: .neonOrangeStrong) {
                DirText(reason, font: .system(size: 14))
                if let by = task.blockedBy {
                    Text(L("Waiting on %@", by.name))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.neonTextSecondary)
                }
            }
        }

        if !task.waitingOn.isEmpty {
            DetailCard(title: L("Waits for"), symbol: "hourglass", tint: .neonOrangeStrong) {
                ForEach(task.waitingOn, id: \.id) { dependency in
                    HStack {
                        DirText(dependency.task.name, font: .system(size: 14))
                        meStateBadge(dependency.state)
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
        // What the day asked about this task, if anything — the same
        // `openFollowUpForTask` the website reads. Failing quietly here is
        // right: a missed question is not worse than the task screen itself
        // not loading, and the page above already reports that failure.
        followUp = try? await api.fetchFollowUp(entryId: taskId).value
    }

    private func move(_ task: StaffTask, to state: String) async {
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

// MARK: - What the day asked (follow-up-reply.tsx, native)

/// One tap where the day asked something. The buttons live on this screen on
/// purpose, mirroring the web: iOS draws no action buttons on a web push at
/// all, so a reply that only existed there would not exist here either — the
/// notification opens the task, and this card is the whole answer.
private struct FollowUpChoice: Identifiable {
    let id: String
    let label: String
    let symbol: String
    let tone: BadgeTone
    let asks: String?
}

private func followUpChoices(for kind: String) -> [FollowUpChoice] {
    switch kind {
    case "block-end":
        return [
            FollowUpChoice(id: "done", label: L("Done"), symbol: "play.fill", tone: .success, asks: nil),
            FollowUpChoice(id: "partly", label: L("Partly done"), symbol: "clock", tone: .warning, asks: L("What is left?")),
            FollowUpChoice(id: "blocked", label: L("Blocked"), symbol: "pause.circle.fill", tone: .pink, asks: L("What is in the way?")),
            FollowUpChoice(id: "not-started", label: L("Not started"), symbol: "exclamationmark.circle", tone: .neutral, asks: L("What happened?")),
        ]
    default: // "block-start" and anything unrecognised, exactly as the website falls back
        return [
            FollowUpChoice(id: "started", label: L("Started"), symbol: "play.fill", tone: .success, asks: nil),
            FollowUpChoice(id: "need-info", label: L("Need information"), symbol: "exclamationmark.circle", tone: .warning, asks: L("What do you need?")),
            FollowUpChoice(id: "blocked", label: L("Blocked"), symbol: "pause.circle.fill", tone: .pink, asks: L("What is in the way?")),
            FollowUpChoice(id: "more-time", label: L("Needs more time"), symbol: "clock", tone: .neutral, asks: L("How much longer?")),
        ]
    }
}

private func followUpAsked(_ kind: String) -> String {
    switch kind {
    case "block-start": return L("This was due to start now.")
    case "block-middle": return L("About halfway — how is it going?")
    case "block-end": return L("This was planned to finish about now.")
    default: return L("How is this going?")
    }
}

private struct FollowUpCard: View {
    let question: FollowUpQuestion
    /// Told once the question is settled, so the parent can drop it from the
    /// screen instead of this card reloading the whole task.
    let onAnswered: () -> Void

    @EnvironmentObject var api: APIClient
    @State private var asking: FollowUpChoice?
    @State private var note = ""
    @State private var working = false
    @State private var doneLabel: String?
    @State private var error: String?
    @FocusState private var noteFocused: Bool

    private var choices: [FollowUpChoice] { followUpChoices(for: question.kind) }

    var body: some View {
        Group {
            if let doneLabel {
                StatusNote(
                    symbol: "checkmark.circle.fill",
                    tone: .success,
                    title: L("Thanks — that is recorded."),
                    detail: L("The manager can see it on the board.")
                )
                .accessibilityLabel(doneLabel)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    DirText(followUpAsked(question.kind), font: .system(size: 15, weight: .semibold))

                    if let asking {
                        VStack(alignment: .leading, spacing: 8) {
                            NeonTextEditor(asking.asks ?? "", text: $note, minLines: 2, maxLines: 5, focus: $noteFocused)
                            HStack(spacing: 10) {
                                NeonButton(L("Send"), kind: .primary, size: .medium) {
                                    await send(asking, note: note)
                                }
                                NeonButton(L("Back"), kind: .secondary, size: .medium) {
                                    withNeonAnimation(.snappy) { self.asking = nil }
                                    note = ""
                                }
                            }
                        }
                        .transition(.neonRise)
                    } else {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                            ForEach(choices) { choice in
                                Button {
                                    Haptic.selection()
                                    if choice.asks != nil {
                                        withNeonAnimation(.snappy) { asking = choice }
                                    } else {
                                        Task { await send(choice, note: nil) }
                                    }
                                } label: {
                                    Label(choice.label, systemImage: choice.symbol)
                                        .font(.system(size: 14, weight: .semibold))
                                        .frame(maxWidth: .infinity)
                                        .frame(height: NeonSize.touch)
                                        .foregroundStyle(choice.tone.foreground)
                                }
                                .buttonStyle(.pressable)
                                .background(choice.tone.background, in: RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous).strokeBorder(choice.tone.foreground.opacity(0.25)))
                            }
                        }
                        .disabled(working)
                    }

                    if let error {
                        Text(error)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.neonPinkStrong)
                    }
                }
                .padding(NeonSpace.lg)
                .neonSurface(.glass, radius: NeonRadius.lg)
            }
        }
        .animation(NeonMotion.smooth, value: doneLabel)
    }

    private func send(_ choice: FollowUpChoice, note: String?) async {
        error = nil
        working = true
        defer { working = false }
        do {
            try await api.answerFollowUp(id: question.id, answer: choice.id, note: note)
            Haptic.success()
            withNeonAnimation(.smooth) { doneLabel = choice.label }
            try? await Task.sleep(nanoseconds: 900_000_000)
            onAnswered()
        } catch APIError.unauthorized {
            // Signed out; the root view has already taken over.
        } catch {
            Haptic.error()
            self.error = error.localizedDescription
        }
    }
}
