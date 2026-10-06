import SwiftUI

// Handing work out by saying it — the website's "Hand out work by saying it"
// (components/tasks/task-briefing.tsx; the rules are lib/task-dictation.ts).
//
//   POST do/tasks/briefing/draft   [words]  → the drafts and what could not be placed (creates nothing)
//   POST do/tasks/briefing/assign  [drafts] → creates them, tells each person once
//
// Two steps on purpose: speech recognition mishears names, and the wrong job
// on the wrong person's phone is the one mistake this could make out loud.
// So the list always comes back to be read and corrected first.

// MARK: - What the server answers

struct BriefingDraft: Codable, Identifiable, Equatable {
    var id = UUID()
    var employeeId: String
    var title: String
    var note: String?
    var acceptance: String?
    var startKey: String
    var endKey: String
    /// "LOW", "MEDIUM" or "HIGH".
    var priority: String

    enum CodingKeys: String, CodingKey {
        case employeeId, title, note, acceptance, startKey, endKey, priority
    }

    /// What `tasks/briefing/assign` is sent: read again from nothing there.
    var payload: [String: Any] {
        [
            "employeeId": employeeId,
            "title": title,
            "note": note.map { $0 as Any } ?? NSNull(),
            "acceptance": acceptance.map { $0 as Any } ?? NSNull(),
            "startKey": startKey,
            "endKey": endKey,
            "priority": priority,
        ]
    }
}

/// Something that was said and did not become a task, and why.
struct BriefingUnplaced: Decodable, Equatable, Identifiable {
    let said: String
    let why: String
    var id: String { said + why }
}

struct BriefingAnswer: Decodable, Equatable {
    let ok: Bool
    let error: String?
    let todayKey: String?
    let tomorrowKey: String?
    let drafts: [BriefingDraft]?
    let unplaced: [BriefingUnplaced]?
}

struct BriefingAssigned: Decodable {
    let ok: Bool
    let error: String?
    let created: Int?
    let people: Int?
    let skipped: Int?
}

extension APIClient {
    /// Reads the words into drafts. The assistant takes a while — long enough
    /// to think — so it gets two minutes rather than the usual one.
    func draftBriefing(_ words: String) async throws -> BriefingAnswer {
        // Straight to the route: nothing changed, so no screen should re-read.
        let data = try await sendJSON("POST", "do/tasks/briefing/draft", ["args": [words]], timeout: 120)
        guard let answer = try ActionOutcome(data: data).result(BriefingAnswer.self) else { throw APIError.decoding }
        return answer
    }

    func assignBriefing(_ drafts: [BriefingDraft]) async throws -> BriefingAssigned {
        let outcome = try await perform("tasks/briefing/assign", args: [drafts.map(\.payload)])
        guard let answer = try outcome.result(BriefingAssigned.self) else { throw APIError.decoding }
        return answer
    }
}

// MARK: - The way in

/// On the Tasks tab (and the Assign view): the box that opens the briefing.
struct TaskBriefingCard: View {
    let onOpen: () -> Void

    var body: some View {
        Button {
            Haptic.tap()
            onOpen()
        } label: {
            HStack(spacing: 14) {
                ZStack {
                    Circle().fill(LinearGradient.neonBrand)
                    Image(systemName: "mic.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .frame(width: 48, height: 48)
                .neonShadow(.glow(.neonPurple))
                VStack(alignment: .leading, spacing: 3) {
                    Text(L("Say the tasks"))
                        .font(.neonCardTitle)
                        .foregroundStyle(Color.neonInk)
                    Text(L("Say who does what and when. NEON lays it out as tasks to check, then sends each person theirs."))
                        .font(.neonSubtitle)
                        .foregroundStyle(Color.neonTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.forward")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.neonTextFaint)
            }
            .padding(NeonSpace.card)
            .frame(maxWidth: .infinity, alignment: .leading)
            .neonSurface(.glass, radius: NeonRadius.lg)
        }
        .buttonStyle(.pressableCard)
        .accessibilityHint(Text(L("Opens the microphone to say the tasks")))
    }
}

// MARK: - The screen

/// Say (or type) who does what; read the list it becomes; correct it; send.
struct TaskBriefingView: View {
    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var listener = TaskDictationListener()

    @State private var words = ""
    /// What was in the box when the microphone opened: what is heard is added after it.
    @State private var wordsBefore = ""
    @State private var team: [AssignTeamMember] = []
    @State private var drafts: [BriefingDraft] = []
    @State private var unplaced: [BriefingUnplaced] = []
    @State private var todayKey: String?
    @State private var reading = false
    @State private var assigning = false
    @State private var errorMessage: String?
    @FocusState private var typing: Bool

    init() {}

    #if DEBUG
    /// Debug screenshots: the list as an answer would leave it.
    init(preview words: String, answer: BriefingAnswer?, team: [AssignTeamMember]) {
        _words = State(initialValue: words)
        _team = State(initialValue: team)
        _drafts = State(initialValue: answer?.drafts ?? [])
        _unplaced = State(initialValue: answer?.unplaced ?? [])
        _todayKey = State(initialValue: answer?.todayKey)
    }
    #endif

    private var hasList: Bool { !drafts.isEmpty || !unplaced.isEmpty }

    var body: some View {
        NavigationStack {
            NeonScroll(spacing: NeonSpace.stack) {
                wordsCard
                if let errorMessage {
                    StatusNote(symbol: "exclamationmark.triangle.fill", tone: .warning, title: errorMessage)
                        .transition(.neonRise)
                }
                if hasList {
                    listSection
                }
            }
            .safeAreaInset(edge: .bottom) {
                if !drafts.isEmpty { assignBar }
            }
            .navigationTitle(L("Say the tasks"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L("Close")) {
                        listener.stop()
                        dismiss()
                    }
                }
            }
            .animation(NeonMotion.resolved(NeonMotion.smooth), value: drafts)
            .animation(NeonMotion.resolved(NeonMotion.smooth), value: errorMessage)
        }
        .task {
            if team.isEmpty, let loaded = try? await api.fetchAssignTeam() { team = loaded.value }
        }
        .onChange(of: listener.heard) { heard in
            words = join(wordsBefore, heard)
        }
        .onDisappear { listener.stop() }
        .neonSheet([.large])
    }

    // MARK: Saying it

    private var wordsCard: some View {
        VStack(alignment: .leading, spacing: NeonSpace.md) {
            ZStack(alignment: .topLeading) {
                if words.isEmpty {
                    Text(L("For example: Wael today, one, call the supplier, two, send the villa drawings. Sally tomorrow, finish the living room renders, urgent."))
                        .font(.neonBody)
                        .foregroundStyle(Color.neonTextFaint)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 8)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $words)
                    .font(.neonBody)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 130, maxHeight: 260)
                    .focused($typing)
                    .disabled(listener.isListening)
            }
            .padding(6)
            .background(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous).fill(Color.neonSurfaceSunken))

            HStack(spacing: NeonSpace.md) {
                micButton
                VStack(alignment: .leading, spacing: 4) {
                    Text(listener.isListening ? L("Listening… tap to stop") : L("Tap the microphone and talk"))
                        .font(.neonSubheadline.weight(.semibold))
                        .foregroundStyle(listener.isListening ? Color.neonDangerStrong : Color.neonText)
                    if let problem = listener.problem {
                        Text(problem)
                            .font(.neonCaption)
                            .foregroundStyle(Color.neonWarningStrong)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text(L("Or type it. Nothing is sent before you check the list."))
                            .font(.neonCaption)
                            .foregroundStyle(Color.neonTextTertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                Menu {
                    ForEach(TaskDictationListener.Language.allCases) { language in
                        Button {
                            listener.language = language
                        } label: {
                            if listener.language == language {
                                Label(language.label, systemImage: "checkmark")
                            } else {
                                Text(language.label)
                            }
                        }
                    }
                } label: {
                    Text(listener.language.label)
                        .font(.neonCaption.weight(.semibold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(NeonHue.purple.wash))
                        .foregroundStyle(Color.neonPurpleStrong)
                }
                .disabled(listener.isListening)
                .accessibilityLabel(Text(L("The language it listens for")))
            }

            HStack(spacing: NeonSpace.md) {
                if !words.isEmpty && !listener.isListening {
                    NeonButton(L("Clear"), kind: .ghost, size: .medium) {
                        words = ""
                        drafts = []
                        unplaced = []
                        errorMessage = nil
                    }
                }
                NeonButton(hasList ? L("Read it again") : L("Make the tasks"), symbol: "sparkles", kind: hasList ? .secondary : .brand,
                           size: .medium, fullWidth: true, isLoading: reading) {
                    await read()
                }
                .disabled(words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || listener.isListening)
            }
            if reading {
                Text(L("Reading what you said… this takes a few seconds."))
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextTertiary)
                    .transition(.opacity)
            }
        }
        .padding(NeonSpace.card)
        .neonSurface(.glass, radius: NeonRadius.lg)
    }

    private var micButton: some View {
        Button {
            typing = false
            if !listener.isListening { wordsBefore = words }
            listener.toggle()
        } label: {
            ZStack {
                Circle()
                    .fill(listener.isListening ? Color.neonDanger.opacity(0.16) : NeonHue.purple.wash)
                    .frame(width: 64, height: 64)
                    .scaleEffect(listener.isListening ? 1 + listener.level * 0.35 : 1)
                    .animation(.easeOut(duration: 0.12), value: listener.level)
                Circle()
                    .fill(listener.isListening ? AnyShapeStyle(Color.neonDanger) : AnyShapeStyle(LinearGradient.neonBrand))
                    .frame(width: 52, height: 52)
                Image(systemName: listener.isListening ? "stop.fill" : "mic.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .buttonStyle(PressableStyle(scale: 0.9))
        .accessibilityLabel(Text(listener.isListening ? L("Stop listening") : L("Start listening")))
    }

    // MARK: The list

    /// The people in the order they were first named.
    private var groups: [(person: String, drafts: [BriefingDraft])] {
        var order: [String] = []
        var byPerson: [String: [BriefingDraft]] = [:]
        for draft in drafts {
            if byPerson[draft.employeeId] == nil { order.append(draft.employeeId) }
            byPerson[draft.employeeId, default: []].append(draft)
        }
        return order.map { ($0, byPerson[$0] ?? []) }
    }

    @ViewBuilder
    private var listSection: some View {
        if !drafts.isEmpty {
            SectionHeader(L("Check the list"), subtitle: L("%d tasks for %d people · change anything before sending", drafts.count, groups.count))
        }
        ForEach(groups, id: \.person) { group in
            personCard(group.person, group.drafts)
        }
        if !unplaced.isEmpty {
            SectionCard(L("Not turned into tasks"), subtitle: L("Said, but not given to anybody"), symbol: "questionmark.bubble.fill", hue: .orange) {
                VStack(alignment: .leading, spacing: NeonSpace.sm) {
                    ForEach(unplaced) { item in
                        VStack(alignment: .leading, spacing: 2) {
                            DirText("“\(item.said)”", font: .neonSubheadline.weight(.semibold))
                            DirText(L(item.why), font: .neonCaption, color: .neonTextSecondary)
                        }
                        if item.id != unplaced.last?.id { NeonDivider() }
                    }
                }
            }
        }
    }

    private func personCard(_ personId: String, _ theirs: [BriefingDraft]) -> some View {
        let member = team.first { $0.id == personId }
        let name = member?.name ?? L("Somebody on the team")
        return VStack(alignment: .leading, spacing: NeonSpace.md) {
            HStack(spacing: 12) {
                AvatarView(url: facePhotoURL(member?.photoUrl), name: name, size: 40, style: .solid)
                VStack(alignment: .leading, spacing: 2) {
                    DirText(name, font: .neonCardTitle, lineLimit: 1)
                    Text(theirs.count == 1 ? L("1 task") : L("%d tasks", theirs.count))
                        .font(.neonSubtitle)
                        .foregroundStyle(Color.neonTextSecondary)
                }
                Spacer(minLength: 0)
            }
            ForEach(theirs) { draft in
                draftRow(draft)
                if draft.id != theirs.last?.id { NeonDivider() }
            }
        }
        .padding(NeonSpace.card)
        .neonSurface(.glass, radius: NeonRadius.lg)
    }

    private func draftRow(_ draft: BriefingDraft) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                TextField(L("Task"), text: binding(draft.id, \.title), axis: .vertical)
                    .font(.neonRowTitle)
                    .lineLimit(1...4)
                Button {
                    Haptic.soft()
                    drafts.removeAll { $0.id == draft.id }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(Color.neonTextFaint)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(L("Remove: %@", draft.title)))
            }
            if let note = draft.note, !note.isEmpty {
                DirText(note, font: .neonCaption, color: .neonTextSecondary)
            }
            if let acceptance = draft.acceptance, !acceptance.isEmpty {
                Label {
                    DirText(acceptance, font: .neonCaption, color: .neonTextSecondary)
                } icon: {
                    Image(systemName: "checkmark.seal").font(.caption)
                }
            }
            FlowRow {
                dayMenu(draft)
                priorityMenu(draft)
                personMenu(draft)
            }
        }
    }

    private func dayMenu(_ draft: BriefingDraft) -> some View {
        Menu {
            ForEach(dayOptions, id: \.self) { key in
                Button(dayLabel(key)) { moveDay(draft.id, to: key) }
            }
        } label: {
            BriefingChip(symbol: "calendar", text: dayRange(draft), hue: .blue)
        }
    }

    private func priorityMenu(_ draft: BriefingDraft) -> some View {
        Menu {
            ForEach(["HIGH", "MEDIUM", "LOW"], id: \.self) { priority in
                Button(priorityText(priority)) { update(draft.id) { $0.priority = priority } }
            }
        } label: {
            BriefingChip(symbol: draft.priority == "HIGH" ? "flame.fill" : "flag", text: priorityText(draft.priority),
                         hue: draft.priority == "HIGH" ? .pink : .grey)
        }
    }

    private func personMenu(_ draft: BriefingDraft) -> some View {
        Menu {
            ForEach(team) { member in
                Button(member.name) { update(draft.id) { $0.employeeId = member.id } }
            }
        } label: {
            BriefingChip(symbol: "person.fill", text: L("Give to…"), hue: .purple)
        }
        .disabled(team.count < 2)
    }

    private var assignBar: some View {
        let people = Set(drafts.map(\.employeeId)).count
        return VStack(spacing: 6) {
            NeonButton(
                L("Send %d tasks to %d people", drafts.count, people),
                symbol: "paperplane.fill",
                kind: .brand,
                isLoading: assigning
            ) {
                await assign()
            }
            .disabled(reading || listener.isListening || drafts.contains { $0.title.trimmingCharacters(in: .whitespaces).isEmpty })
            Text(L("Each person is told once, with their own list."))
                .font(.neonCaption)
                .foregroundStyle(Color.neonTextTertiary)
        }
        .padding(.horizontal, NeonSpace.gutter)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(.ultraThinMaterial)
    }

    // MARK: Changing a draft

    private func binding(_ id: UUID, _ path: WritableKeyPath<BriefingDraft, String>) -> Binding<String> {
        Binding(
            get: { drafts.first { $0.id == id }?[keyPath: path] ?? "" },
            set: { value in update(id) { $0[keyPath: path] = value } }
        )
    }

    private func update(_ id: UUID, _ change: (inout BriefingDraft) -> Void) {
        guard let index = drafts.firstIndex(where: { $0.id == id }) else { return }
        change(&drafts[index])
    }

    /// A new first day keeps the job's length, as the website's does.
    private func moveDay(_ id: UUID, to key: String) {
        update(id) { draft in
            let length = BriefingDays.between(draft.startKey, draft.endKey)
            draft.startKey = key
            draft.endKey = BriefingDays.shift(key, by: max(0, length))
        }
    }

    // MARK: Days and words

    private var baseDay: String { todayKey ?? NeonFormat.dayKey(Date()) }

    private var dayOptions: [String] {
        (0..<15).map { BriefingDays.shift(baseDay, by: $0) }
    }

    private func dayLabel(_ key: String) -> String {
        let ahead = BriefingDays.between(baseDay, key)
        if ahead == 0 { return L("Today") }
        if ahead == 1 { return L("Tomorrow") }
        return BriefingDays.label(key)
    }

    private func dayRange(_ draft: BriefingDraft) -> String {
        guard draft.endKey != draft.startKey else { return dayLabel(draft.startKey) }
        let days = BriefingDays.between(draft.startKey, draft.endKey) + 1
        return L("%@ → %@ · %d days", dayLabel(draft.startKey), dayLabel(draft.endKey), days)
    }

    private func priorityText(_ priority: String) -> String {
        switch priority {
        case "HIGH": return L("Urgent")
        case "LOW": return L("When there's time")
        default: return L("Normal")
        }
    }

    private func join(_ first: String, _ second: String) -> String {
        let a = first.trimmingCharacters(in: .whitespacesAndNewlines)
        let b = second.trimmingCharacters(in: .whitespacesAndNewlines)
        if a.isEmpty { return b }
        if b.isEmpty { return a }
        return a + " " + b
    }

    // MARK: Asking the server

    private func read() async {
        listener.stop()
        typing = false
        reading = true
        errorMessage = nil
        defer { reading = false }
        do {
            let answer = try await api.draftBriefing(words)
            guard answer.ok else {
                Haptic.warning()
                errorMessage = L(answer.error ?? "The assistant gave no answer. Try again.")
                return
            }
            Haptic.success()
            todayKey = answer.todayKey
            drafts = answer.drafts ?? []
            unplaced = answer.unplaced ?? []
            if drafts.isEmpty && unplaced.isEmpty {
                errorMessage = L("Nothing in that was a task. Say who does what.")
            }
        } catch {
            Haptic.error()
            errorMessage = error.localizedDescription
        }
    }

    private func assign() async {
        assigning = true
        defer { assigning = false }
        do {
            let answer = try await api.assignBriefing(drafts)
            guard answer.ok else {
                Haptic.warning()
                errorMessage = L(answer.error ?? "Nothing was sent.")
                return
            }
            Haptic.success()
            let created = answer.created ?? drafts.count
            let people = answer.people ?? Set(drafts.map(\.employeeId)).count
            Toast.success(L("%d tasks sent to %d people", created, people),
                          detail: (answer.skipped ?? 0) > 0 ? L("%d could not be given to anybody and were left out.", answer.skipped ?? 0) : nil)
            dismiss()
        } catch {
            Toast.error(error)
        }
    }
}

/// A small tappable capsule under a draft: its day, its priority, who it is for.
private struct BriefingChip: View {
    let symbol: String
    let text: String
    let hue: NeonHue

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: symbol).font(.system(size: 11, weight: .semibold))
            Text(text).font(.neonCaption.weight(.semibold)).lineLimit(1)
            Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold)).opacity(0.6)
        }
        .foregroundStyle(hue == .grey ? Color.neonTextSecondary : hue.deep)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Capsule().fill(hue.wash))
    }
}

/// "YYYY-MM-DD" arithmetic, in UTC so no day slips.
enum BriefingDays {
    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    private static let parser: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func date(_ key: String) -> Date? { parser.date(from: key) }

    static func shift(_ key: String, by days: Int) -> String {
        guard let date = date(key), let moved = calendar.date(byAdding: .day, value: days, to: date) else { return key }
        return parser.string(from: moved)
    }

    static func between(_ from: String, _ to: String) -> Int {
        guard let a = date(from), let b = date(to) else { return 0 }
        return calendar.dateComponents([.day], from: a, to: b).day ?? 0
    }

    /// "Sun 12 Oct", in the app's language.
    static func label(_ key: String) -> String {
        guard let date = date(key) else { return key }
        var style = Date.FormatStyle(locale: AppLanguage.current.locale).weekday(.abbreviated).day().month(.abbreviated)
        style.timeZone = TimeZone(identifier: "UTC")!
        return date.formatted(style)
    }
}
