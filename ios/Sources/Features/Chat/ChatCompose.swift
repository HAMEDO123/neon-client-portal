import PhotosUI
import SwiftUI

// The manager's + menu: handing out a task and setting a meeting from a
// conversation, natively — the same two forms the web's TaskDialog and
// MeetingSheet are, reading who the card can go to from chat/members and
// writing through chat/tasks/create and chat/meetings/create. Both are the
// manager's alone; ChatRoomView only offers + when the viewer is admin.

struct ChatTaskComposeSheet: View {
    let conversationSlug: String
    var onCreated: () -> Void = {}

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var description = ""
    @State private var priority: String? = "MEDIUM"
    @State private var assignees: Set<TaskMember> = []
    /// Opens on defaultDue in lib/chat-tasks.ts — the end of today's working
    /// day while an hour of it is left, else the end of the next one — from
    /// the studio's own hours once Settings has said them.
    @State private var due = ChatWorkingDay.standard.defaultDue()
    /// What the form proposed, so the studio's hours arriving can move a
    /// date nobody has touched, and never one somebody chose.
    @State private var proposedDue: Date?
    @State private var members: [TaskMember] = []
    @State private var loadingMembers = true
    @State private var loadError: String?
    @State private var attachment: UploadFile?
    @State private var attachError: String?
    @State private var photoItem: PhotosPickerItem?
    @State private var showPhotos = false
    @State private var showCamera = false
    @State private var showFiles = false

    var body: some View {
        SheetScaffold(
            L("New task"), subtitle: L("Hand out work in this chat"), symbol: "checklist",
            primaryTitle: L("Hand out"), isPrimaryEnabled: isValid
        ) {
            await create()
        } content: {
            FormSection(L("Task")) {
                NeonTextField(L("Title"), text: $title, prompt: L("e.g. Kitchen elevations"), symbol: "textformat", isRequired: true)
                NeonTextEditor(L("Details"), text: $description, minLines: 3, maxLines: 8, limit: 4000)
                MenuField(L("Priority"), selection: $priority, options: ["LOW", "MEDIUM", "HIGH"], title: { localizedEnum("priority", $0) })
                DateField(L("Due"), date: $due, components: [.date, .hourAndMinute], in: Date()...Date.distantFuture)
            }
            FormSection(L("Assigned to")) {
                if loadingMembers {
                    SkeletonRows(count: 2)
                } else if members.isEmpty {
                    StatusNote(symbol: "person.slash", tone: .warning, title: L("Nobody to hand this to"), detail: L("There is nobody else in this chat."))
                } else {
                    SelectField(L("People"), selection: $assignees, options: members, title: \.name,
                                avatar: { facePhotoURL($0.photoUrl) }, isRequired: true)
                }
                if let loadError { ValidationMessage(loadError) }
            }
            FormSection(L("Attachment")) {
                if let attachment {
                    PickedAttachmentRow(filename: attachment.filename) { self.attachment = nil }
                } else {
                    Menu {
                        if CameraPicker.isAvailable {
                            Button { showCamera = true } label: { Label(L("Camera"), systemImage: "camera") }
                        }
                        Button { showPhotos = true } label: { Label(L("Photo"), systemImage: "photo") }
                        Button { showFiles = true } label: { Label(L("File"), systemImage: "doc") }
                    } label: {
                        Label(L("Attach a photo or file"), systemImage: "paperclip")
                            .font(.neonCallout)
                            .foregroundStyle(Color.neonCyanStrong)
                    }
                }
                if let attachError { ValidationMessage(attachError) }
            }
        }
        .neonSheet([.large])
        .task { await loadMembers() }
        .task {
            proposedDue = due
            let day = await ChatWorkingDay.studio(api)
            let studioDue = day.defaultDue()
            if due == proposedDue {
                due = studioDue
                proposedDue = studioDue
            }
        }
        .photosPicker(isPresented: $showPhotos, selection: $photoItem, matching: .images)
        .onChange(of: photoItem) { item in
            guard let item else { return }
            photoItem = nil
            Task {
                guard let file = await UploadMaker.photo(item) else {
                    attachError = L("That photo could not be read.")
                    return
                }
                attachError = nil
                attachment = file
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                attachError = nil
                attachment = UploadMaker.photo(image)
            }
            .ignoresSafeArea()
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: UploadMaker.documentTypes) { result in
            guard case .success(let url) = result else { return }
            guard let file = UploadMaker.file(url, field: "attachment") else {
                attachError = L("That file could not be read.")
                return
            }
            attachError = nil
            attachment = file
        }
    }

    private var isValid: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !assignees.isEmpty && due > Date().addingTimeInterval(-60)
    }

    private func loadMembers() async {
        do {
            members = try await api.fetchChatMembers(conversation: conversationSlug).task
        } catch {
            loadError = error.localizedDescription
        }
        loadingMembers = false
    }

    private func create() async {
        do {
            try await api.createChatTask(
                conversation: conversationSlug,
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                description: description.trimmingCharacters(in: .whitespacesAndNewlines),
                priority: priority ?? "MEDIUM",
                assignees: assignees.map(\.id),
                due: due,
                attachment: attachment
            )
            Haptic.success()
            dismiss()
            onCreated()
        } catch {
            Toast.error(error)
            Haptic.error()
        }
    }
}

/// A file picked for the task, not yet sent — mirrors the web task sheet's
/// own "attach a photo or file" pill, one attachment at a time.
private struct PickedAttachmentRow: View {
    let filename: String
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc.fill")
                .foregroundStyle(Color.neonTextTertiary)
            Text(filename)
                .font(.neonCallout)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 8)
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(Color.neonTextTertiary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L("Remove %@", filename))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .neonSurface(.sunken, radius: NeonRadius.md)
    }
}

struct ChatMeetingComposeSheet: View {
    let conversationSlug: String
    /// Where the meeting lands, said under the title when that is not the
    /// chat the sheet was opened from (the Meetings page posts to the team).
    var postedIn: String?
    var onCreated: () -> Void = {}

    private static let durations = [15, 30, 45, 60, 90, 120]
    private static let reminders = [0, 5, 10, 15, 30, 60]

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var agenda = ""
    @State private var mode: String? = "ONLINE"
    @State private var place = ""
    @State private var attendees: Set<MeetingMember> = []
    /// defaultWhen in lib/chat-meetings.ts: the next half hour inside the
    /// working day, else the start of the next working day.
    @State private var when = ChatWorkingDay.standard.defaultMeetingStart()
    @State private var proposedWhen: Date?
    @State private var duration: Int? = 30
    @State private var remind: Int? = 10
    @State private var members: [MeetingMember] = []
    @State private var loadingMembers = true
    @State private var loadError: String?

    var body: some View {
        SheetScaffold(
            L("Set a meeting"), subtitle: postedIn ?? L("Everybody asked is told, and reminded before it starts"), symbol: "calendar.badge.plus",
            primaryTitle: L("Set a meeting"), isPrimaryEnabled: isValid
        ) {
            await create()
        } content: {
            FormSection(L("Meeting")) {
                NeonTextField(L("Title"), text: $title, prompt: L("e.g. Villa review with the client"), symbol: "textformat", isRequired: true)
                NeonTextEditor(L("Agenda"), text: $agenda, minLines: 2, maxLines: 6, limit: 4000)
                DateField(L("Starts"), date: $when, components: [.date, .hourAndMinute], in: Date()...Date.distantFuture)
                // Who is asked matters most after when, so it comes next.
                if loadingMembers {
                    SkeletonRows(count: 2)
                } else if members.isEmpty {
                    StatusNote(symbol: "person.slash", tone: .warning, title: L("Nobody to ask"), detail: L("There is nobody else in this chat."))
                } else {
                    SelectField(L("People"), selection: $attendees, options: members, title: \.name,
                                avatar: { facePhotoURL($0.photo) }, isRequired: true)
                }
                if let loadError { ValidationMessage(loadError) }
                MenuField(L("Where"), selection: $mode,
                          options: ["ONLINE", "IN_PERSON"], title: { $0 == "ONLINE" ? L("Online") : L("In person") })
                if mode == "IN_PERSON" {
                    NeonTextField(L("Place"), text: $place, symbol: "mappin.and.ellipse")
                }
                MenuField(L("Duration"), selection: $duration, options: Self.durations, title: { L("%d min", $0) })
                MenuField(L("Remind"), selection: $remind, options: Self.reminders,
                          title: { $0 == 0 ? L("At the time") : L("%d min before", $0) })
            }
        }
        .neonSheet([.large])
        .task { await loadMembers() }
        .task {
            proposedWhen = when
            let day = await ChatWorkingDay.studio(api)
            let studioStart = day.defaultMeetingStart()
            if when == proposedWhen {
                when = studioStart
                proposedWhen = studioStart
            }
        }
    }

    private var isValid: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !attendees.isEmpty
            && when > Date().addingTimeInterval(-60)
            && ((mode ?? "ONLINE") != "IN_PERSON" || !place.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    private func loadMembers() async {
        do {
            members = try await api.fetchChatMembers(conversation: conversationSlug).meeting
        } catch {
            loadError = error.localizedDescription
        }
        loadingMembers = false
    }

    private func create() async {
        do {
            try await api.createChatMeeting(
                conversation: conversationSlug,
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                agenda: agenda.trimmingCharacters(in: .whitespacesAndNewlines),
                mode: mode ?? "ONLINE",
                place: place.trimmingCharacters(in: .whitespacesAndNewlines),
                attendees: attendees.map(\.key),
                when: when,
                durationMinutes: duration ?? 30,
                remindMinutes: remind ?? 10
            )
            Haptic.success()
            dismiss()
            onCreated()
        } catch {
            Toast.error(error)
            Haptic.error()
        }
    }
}

/// The studio's working day as the task and meeting forms need it: which
/// weekdays are worked and when the day starts and ends — the same values
/// Settings edits (ops/settings's workHours). Times are the device's wall
/// clock, as everything the forms send is (timeKey, NeonFormat.dayKey).
struct ChatWorkingDay {
    /// JavaScript weekdays, 0 for Sunday, as lib/work-hours.ts keeps them.
    let days: Set<Int>
    /// Minutes since midnight.
    let start: Int
    let end: Int

    /// DEFAULT_WORK_HOURS in lib/work-hours.ts — Sunday to Thursday,
    /// 11:00–19:00 — for the moment before Settings has answered, or if it
    /// cannot be read.
    static let standard = ChatWorkingDay(days: [0, 1, 2, 3, 4], start: 11 * 60, end: 19 * 60)

    /// The studio's own hours from Settings, else the platform's standard ones.
    @MainActor static func studio(_ api: APIClient) async -> ChatWorkingDay {
        guard let hours = try? await api.opsSettings().value.workHours,
              let start = minutes(hours.start), let end = minutes(hours.end), end > start
        else { return standard }
        return ChatWorkingDay(days: Set(hours.days), start: start, end: end)
    }

    /// "HH:MM" as minutes since midnight (minutesOf in lib/work-hours.ts).
    private static func minutes(_ time: String) -> Int? {
        let parts = time.trimmingCharacters(in: .whitespaces).split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, (0..<24).contains(parts[0]), (0..<60).contains(parts[1]) else { return nil }
        return parts[0] * 60 + parts[1]
    }

    private var calendar: Calendar { .current }

    private func isWorkingDay(_ day: Date) -> Bool {
        days.contains(calendar.component(.weekday, from: day) - 1)
    }

    private func at(_ minutes: Int, on day: Date) -> Date {
        let midnight = calendar.startOfDay(for: day)
        return calendar.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: midnight) ?? midnight
    }

    /// nextWorkingDay: the first worked day after this one (tomorrow if none is).
    private func nextWorkingDay(after day: Date) -> Date {
        let midnight = calendar.startOfDay(for: day)
        for offset in 1...14 {
            if let candidate = calendar.date(byAdding: .day, value: offset, to: midnight), isWorkingDay(candidate) {
                return candidate
            }
        }
        return calendar.date(byAdding: .day, value: 1, to: midnight) ?? midnight
    }

    /// defaultDue in lib/chat-tasks.ts: the end of today's working day while
    /// at least an hour of it is left, otherwise the end of the next one.
    func defaultDue(now: Date = Date()) -> Date {
        let endToday = at(end, on: now)
        if isWorkingDay(now), endToday.timeIntervalSince(now) >= 60 * 60 { return endToday }
        return at(end, on: nextWorkingDay(after: now))
    }

    /// defaultWhen in lib/chat-meetings.ts: the next half hour (never before
    /// the day starts) when a 30-minute meeting still fits in today's working
    /// day, otherwise the start of the next working day.
    func defaultMeetingStart(now: Date = Date()) -> Date {
        let half: TimeInterval = 30 * 60
        let rounded = Date(timeIntervalSinceReferenceDate: (now.timeIntervalSinceReferenceDate / half).rounded(.up) * half)
        let startToday = at(start, on: now)
        let soonest = max(rounded, startToday)
        if isWorkingDay(now), soonest.addingTimeInterval(half) <= at(end, on: now) { return soonest }
        return at(start, on: nextWorkingDay(after: now))
    }
}

/// The manager's "Ask the assistant" — a question, written into this
/// conversation alongside the answer as messages only they can see, so
/// there is nothing further to fetch: the reply appears where every other
/// message does, tagged "Only you".
struct ChatAssistantSheet: View {
    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var question = ""

    /// The website's own suggestions (assistant-panel.tsx), which fill the box
    /// rather than sending, so they can be read and changed first.
    private static let suggestions = ["What did the team report today?", "Anything I should follow up on?"]

    private var trimmed: String { question.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        SheetScaffold(
            L("Ask the assistant"),
            subtitle: L("Only you see the question and its answer, marked “Only you” in this chat"),
            symbol: "sparkles",
            primaryTitle: L("Ask"),
            isPrimaryEnabled: !trimmed.isEmpty
        ) {
            await ask()
        } content: {
            FormSection {
                NeonTextEditor(L("Question"), text: $question, prompt: L("Ask about anything the team has said…"),
                               minLines: 3, maxLines: 8, limit: 2000)
                FlowRow(spacing: 8) {
                    ForEach(Self.suggestions, id: \.self) { suggestion in
                        Chip(L(suggestion), symbol: "sparkles", isSelected: question == L(suggestion)) {
                            question = L(suggestion)
                        }
                    }
                }
            }
        }
        .neonSheet([.medium, .large])
    }

    private func ask() async {
        do {
            try await api.askChatAssistant(question: trimmed)
            Haptic.success()
            dismiss()
        } catch {
            Toast.error(error)
            Haptic.error()
        }
    }
}
