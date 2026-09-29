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
    @State private var due = Date().addingTimeInterval(3600)
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
                NeonTextField(L("Title"), text: $title, symbol: "textformat", isRequired: true)
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
                    SelectField(L("People"), selection: $assignees, options: members, title: \.name, isRequired: true)
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
    @State private var when = roundedUpcomingHalfHour()
    @State private var duration: Int? = 30
    @State private var remind: Int? = 10
    @State private var members: [MeetingMember] = []
    @State private var loadingMembers = true
    @State private var loadError: String?

    var body: some View {
        SheetScaffold(
            L("Set a meeting"), subtitle: L("Everybody asked is told, and reminded before it starts"), symbol: "calendar.badge.plus",
            primaryTitle: L("Set meeting"), isPrimaryEnabled: isValid
        ) {
            await create()
        } content: {
            FormSection(L("Meeting")) {
                NeonTextField(L("Title"), text: $title, symbol: "textformat", isRequired: true)
                NeonTextEditor(L("Agenda"), text: $agenda, minLines: 2, maxLines: 6, limit: 4000)
                MenuField(L("Where"), selection: $mode,
                          options: ["ONLINE", "IN_PERSON"], title: { $0 == "ONLINE" ? L("Online") : L("In person") })
                if mode == "IN_PERSON" {
                    NeonTextField(L("Place"), text: $place, symbol: "mappin.and.ellipse")
                }
                DateField(L("Starts"), date: $when, components: [.date, .hourAndMinute], in: Date()...Date.distantFuture)
                MenuField(L("Duration"), selection: $duration, options: Self.durations, title: { L("%d min", $0) })
                MenuField(L("Remind"), selection: $remind, options: Self.reminders,
                          title: { $0 == 0 ? L("At the time") : L("%d min before", $0) })
            }
            FormSection(L("Attendees")) {
                if loadingMembers {
                    SkeletonRows(count: 2)
                } else if members.isEmpty {
                    StatusNote(symbol: "person.slash", tone: .warning, title: L("Nobody to ask"), detail: L("There is nobody else in this chat."))
                } else {
                    SelectField(L("People"), selection: $attendees, options: members, title: \.name, isRequired: true)
                }
                if let loadError { ValidationMessage(loadError) }
            }
        }
        .neonSheet([.large])
        .task { await loadMembers() }
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

/// Rounds up to the next half hour, the same default the web's form opens on.
private func roundedUpcomingHalfHour() -> Date {
    let now = Date().timeIntervalSinceReferenceDate
    let half: TimeInterval = 30 * 60
    return Date(timeIntervalSinceReferenceDate: (now / half).rounded(.up) * half)
}

/// The manager's "Ask the assistant" — a question, written into this
/// conversation alongside the answer as messages only they can see, so
/// there is nothing further to fetch: the reply appears where every other
/// message does, tagged "Only you".
struct ChatAssistantSheet: View {
    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var question = ""
    @State private var asking = false

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(L("Ask the assistant"), subtitle: L("Answers only you can see, in this chat"), symbol: "sparkles") { dismiss() }
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    NeonTextEditor(L("Question"), text: $question, minLines: 3, maxLines: 8, limit: 2000)
                    StatusNote(
                        symbol: "eye.slash.fill", tone: .purple,
                        title: L("Only you see this"),
                        detail: L("The question and its answer appear in this chat marked \"Only you\". Nobody else sees them.")
                    )
                    NeonButton(L("Ask"), symbol: "sparkles", kind: .brand, isLoading: asking) { await ask() }
                        .disabled(question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.horizontal, NeonSpace.gutter)
                .padding(.bottom, NeonSpace.xxl)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(NeonAmbient().ignoresSafeArea())
        .neonSheet([.medium, .large])
    }

    private func ask() async {
        asking = true
        defer { asking = false }
        do {
            try await api.askChatAssistant(question: question.trimmingCharacters(in: .whitespacesAndNewlines))
            Haptic.success()
            dismiss()
        } catch {
            Toast.error(error)
            Haptic.error()
        }
    }
}
