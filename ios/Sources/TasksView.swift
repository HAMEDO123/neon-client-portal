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

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Picker(L("Show"), selection: $filter) {
                        ForEach(TaskFilter.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    if let cachedAt { OfflineBanner(savedAt: cachedAt) }

                    if let tasks {
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
            }
            .navigationTitle(L("Tasks"))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { AccountMenu() }
            }
            .navigationDestination(for: TaskRoute.self) { route in
                TaskDetailView(taskId: route.id)
            }
            .neonAmbientBackground()
        }
        .task(id: filter) {
            tasks = nil
            await load()
        }
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

// MARK: - Sending proof

/// Hands finished work in: a photo (or a PDF, drawing, spreadsheet or ZIP) and
/// a note, as multipart to `/tasks/[id]/proof`. The server answers SUBMITTED —
/// the start of the manager's check, never the end of one.
///
/// What to photograph sits above the camera, because telling somebody what to
/// photograph after they have photographed something is advice too late.
struct ProofSheet: View {
    /// A board cell's id, or a chat job's assignment id — the server finds which.
    let targetId: String
    let title: String
    var subtitle: String?
    var evidence: [String] = []
    var acceptance: [String] = []
    let onSent: () -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var file: UploadFile?
    @State private var preview: UIImage?
    @State private var note = ""
    @State private var photoItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var showFiles = false
    @State private var sending = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        DirText(title, font: .system(size: 20, weight: .bold, design: .rounded))
                        if let subtitle { DirText(subtitle, font: .system(size: 13), color: .neonInk.opacity(0.55)) }
                    }

                    if !evidence.isEmpty {
                        DetailCard(title: L("Proof to send"), symbol: "camera") { BulletList(lines: evidence) }
                    }
                    if !acceptance.isEmpty {
                        DetailCard(title: L("It will be checked against"), symbol: "checkmark.circle") { BulletList(lines: acceptance) }
                    }

                    picked

                    HStack(spacing: 10) {
                        if CameraPicker.isAvailable {
                            sourceButton(L("Camera"), symbol: "camera.fill") { showCamera = true }
                        }
                        PhotosPicker(selection: $photoItem, matching: .images) {
                            sourceLabel(L("Photos"), symbol: "photo.on.rectangle")
                        }
                        .buttonStyle(.pressable)
                        sourceButton(L("File"), symbol: "doc.fill") { showFiles = true }
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text(L("Note for the manager (optional)"))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Color.neonInk.opacity(0.6))
                        TextField(L("What should the manager know?"), text: $note, axis: .vertical)
                            .lineLimit(3...6)
                            .padding(12)
                            .background(Color.white.opacity(0.8), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.neonInk.opacity(0.1)))
                            .environment(\.layoutDirection, naturalDirection(note) ?? AppLanguage.current.layoutDirection)
                    }

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    Text(L("Sending puts this in the manager's review. It is marked done only when they approve it."))
                        .font(.system(size: 12))
                        .foregroundStyle(Color.neonInk.opacity(0.5))
                }
                .padding(16)
            }
            .neonAmbientBackground()
            .navigationTitle(L("Send proof"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L("Cancel")) { dismiss() }.disabled(sending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await send() }
                    } label: {
                        if sending { ProgressView() } else { Text(L("Send")).bold() }
                    }
                    .disabled(file == nil || sending)
                }
            }
            .interactiveDismissDisabled(sending)
            .onChange(of: photoItem) { item in
                guard let item else { return }
                Task {
                    if let made = await UploadMaker.photo(item) {
                        set(made)
                    } else {
                        errorMessage = L("That photo could not be read.")
                    }
                }
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { image in
                    if let made = UploadMaker.photo(image) { set(made) }
                }
                .ignoresSafeArea()
            }
            .fileImporter(isPresented: $showFiles, allowedContentTypes: UploadMaker.documentTypes) { result in
                guard case .success(let url) = result else { return }
                if let made = UploadMaker.file(url, field: "photo") {
                    set(made)
                } else {
                    errorMessage = L("That file could not be read.")
                }
            }
        }
    }

    @ViewBuilder
    private var picked: some View {
        if let preview {
            Image(uiImage: preview)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: 280)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        } else if let file {
            HStack(spacing: 12) {
                Image(systemName: "doc.fill").font(.system(size: 26)).foregroundStyle(Color.neonPurpleStrong)
                VStack(alignment: .leading, spacing: 2) {
                    Text(file.filename).font(.system(size: 14, weight: .semibold)).lineLimit(2)
                    Text(byteCount(file.data.count)).font(.system(size: 12)).foregroundStyle(Color.neonInk.opacity(0.5))
                }
                Spacer()
            }
            .padding(14)
            .glassCard(radius: 16)
        } else {
            VStack(spacing: 6) {
                Image(systemName: "photo.badge.plus").font(.system(size: 30))
                Text(L("Add a photo or a file of the finished work"))
                    .font(.system(size: 14, weight: .medium))
                    .multilineTextAlignment(.center)
            }
            .foregroundStyle(Color.neonInk.opacity(0.4))
            .frame(maxWidth: .infinity)
            .frame(height: 150)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
                    .foregroundStyle(Color.neonInk.opacity(0.18))
            )
        }
    }

    private func set(_ made: UploadFile) {
        errorMessage = nil
        file = made
        preview = made.mimeType.hasPrefix("image/") ? UIImage(data: made.data) : nil
    }

    private func sourceButton(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { sourceLabel(title, symbol: symbol) }
            .buttonStyle(.pressable)
    }

    private func sourceLabel(_ title: String, symbol: String) -> some View {
        VStack(spacing: 5) {
            Image(systemName: symbol).font(.system(size: 18))
            Text(title).font(.system(size: 12, weight: .semibold))
        }
        .foregroundStyle(Color.neonInk)
        .frame(maxWidth: .infinity)
        .frame(height: 62)
        .background(Color.white.opacity(0.75), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.neonInk.opacity(0.1)))
    }

    private func send() async {
        guard let file else { return }
        sending = true
        errorMessage = nil
        defer { sending = false }
        do {
            try await api.submitProof(taskId: targetId, file: file, note: note)
            Haptic.success()
            onSent()
            dismiss()
        } catch APIError.unauthorized {
            dismiss()
        } catch {
            Haptic.error()
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Small pieces

struct StatusNote: View {
    let symbol: String
    let tone: BadgeTone
    let title: String
    var detail: String?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 20))
                .foregroundStyle(tone.foreground)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 15, weight: .semibold))
                if let detail {
                    Text(detail).font(.system(size: 13)).foregroundStyle(Color.neonInk.opacity(0.6))
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(tone.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct DetailCard<Content: View>: View {
    let title: String
    let symbol: String
    var tint: Color = .neonCyanStrong
    var footnote: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(tint)
            content
            if let footnote {
                Text(footnote)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.neonInk.opacity(0.45))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(radius: 16)
    }
}

struct BulletList: View {
    let lines: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                let direction = naturalDirection(line) ?? AppLanguage.current.layoutDirection
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("•").foregroundStyle(Color.neonInk.opacity(0.4))
                    Text(verbatim: line)
                        .font(.system(size: 14))
                        .foregroundStyle(Color.neonInk)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .environment(\.layoutDirection, direction)
            }
        }
    }
}

/// Badges that wrap onto a second line instead of running off the screen.
struct FlowRow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += line + spacing
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
        }
        return CGSize(width: width.isFinite ? width : x, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += line + spacing
                line = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}
