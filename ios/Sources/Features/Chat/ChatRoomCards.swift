import SwiftUI

// The two cards a conversation carries besides messages: a job handed out
// from the chat, and a meeting set from it. Both are white cards with a
// coloured edge — purple for work, cyan for meetings, the same families the
// rest of the app uses for them.

// MARK: - Task card

/// A job handed out from the chat. Each person on it has their own part; the
/// person looking at their own part, while it is still theirs to do, gets the
/// one action that moves it on — sending proof. The manager approves or sends
/// it back right here, exactly where the web review queue's buttons lead —
/// "Done" stays the manager's word either way — and everybody on the card can
/// talk about it in the thread underneath.
struct ChatTaskCardView: View {
    let card: TaskCard
    let message: ChatMessage
    let viewer: Identity?
    let sendProof: (TaskCard.Assignment, TaskCard) -> Void
    let onChanged: () -> Void

    @EnvironmentObject private var api: APIClient
    @Environment(\.openURL) private var openURL
    @Environment(\.chatRoomPalette) private var palette
    @State private var commentDraft = ""
    @State private var sendingComment = false
    @State private var reviewNote = ""
    @State private var reviewingSubmissionId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                IconTile("checklist", hue: .purple, size: 34)
                // The label and the title start on the same side, whatever
                // language the title is in.
                VStack(alignment: .leading, spacing: 3) {
                    Text(L("TASK"))
                        .font(.neonOverline)
                        .tracking(0.6)
                        .foregroundStyle(NeonHue.purple.deep)
                    DirText(card.title, font: .neonCardTitle, fill: false)
                }
            }

            if let description = card.description, !description.isEmpty {
                DirText(description, font: .neonSubheadline, color: .neonTextSecondary)
            }

            // With one person on the card, their own badge below says where
            // it stands; the card's overall one would only repeat it.
            if card.assignments.count != 1 || priorityLabel(card.priority) != nil {
                FlowRow(spacing: 6) {
                    if card.assignments.count != 1 {
                        StateBadge(cardStateLabel(card.overall), tone: taskStateTone(card.overall),
                                   symbol: StateBadge.symbol(for: card.overall), pulsing: card.overall == "IN_PROGRESS")
                    }
                    if let priority = priorityLabel(card.priority) {
                        StateBadge(priority, tone: statusTone(card.priority ?? ""), symbol: card.priority == "HIGH" ? "flame.fill" : "arrow.down")
                    }
                }
            }

            if let due = chatCardDate(card.dueAt) {
                MetaLabel(L("Due %@", due), symbol: card.isOverdue ? "exclamationmark.circle.fill" : "clock",
                          tint: card.isOverdue ? .neonDangerStrong : .neonTextSecondary)
            }

            if let url = resolvedMediaURL(card.attachmentUrl) {
                Button {
                    Haptic.tap()
                    openURL(url)
                } label: {
                    HStack(spacing: 8) {
                        IconTile("paperclip", hue: .blue, size: 28)
                        Text(verbatim: card.attachmentName ?? L("Attachment"))
                            .font(.system(.footnote, weight: .semibold))
                            .foregroundStyle(Color.neonInk)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.up.forward")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Color.neonTextTertiary)
                    }
                    .padding(6)
                    .background(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous).fill(Color.neonSurfaceSunken))
                }
                .buttonStyle(PressableStyle(scale: 0.97))
            }

            NeonDivider()

            ForEach(card.assignments) { part in
                assignmentRow(part)
            }

            if viewer != nil {
                NeonDivider()
                commentsSection
            }
        }
        .padding(NeonSpace.lg - 2)
        .frame(maxWidth: 300, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous).fill(Color.white))
        .overlay(alignment: .top) { ChatRoomCardEdge(hue: .purple) }
        .clipShape(RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous).strokeBorder(Color.neonPurple.opacity(0.16), lineWidth: 1))
        .neonShadow(.card)
        .neonContextShape(radius: NeonRadius.lg)
        .animation(NeonMotion.resolved(NeonMotion.snappy), value: reviewingSubmissionId)
    }

    @ViewBuilder
    private func assignmentRow(_ part: TaskCard.Assignment) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ChatAvatar(url: facePhotoURL(part.employee?.photoUrl) ?? palette.photo(key: part.employeeId),
                           name: part.employee?.name ?? "—", size: 26,
                           color: part.employee?.color ?? palette.color(key: part.employeeId, name: part.employee?.name))
                DirText(part.employee?.name ?? "—", font: .system(.subheadline, weight: .semibold), fill: false, lineLimit: 1)
                Spacer(minLength: 4)
                StateBadge(cardStateLabel(part.state), tone: taskStateTone(part.state),
                           symbol: StateBadge.symbol(for: part.state), pulsing: part.state == "IN_PROGRESS")
            }
            if let pending = part.submissions?.first, part.state == "SUBMITTED" {
                HStack(spacing: 6) {
                    Image(systemName: "photo.on.rectangle.angled")
                    Text(viewer?.side == .admin ? L("Proof waiting for your review") : L("Proof sent — waiting for review"))
                }
                .font(.system(.caption, weight: .medium))
                .foregroundStyle(NeonHue.purple.deep)
                if let note = pending.note, !note.isEmpty {
                    DirText(note, font: .system(.footnote), color: .neonTextSecondary)
                        .padding(8)
                        .background(RoundedRectangle(cornerRadius: NeonRadius.xs, style: .continuous).fill(NeonHue.purple.wash))
                }
                if viewer?.side == .admin {
                    if reviewingSubmissionId == pending.id {
                        VStack(alignment: .leading, spacing: 8) {
                            TextField(L("Note (optional)"), text: $reviewNote, axis: .vertical)
                                .font(.system(.footnote))
                                .lineLimit(1...4)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 9)
                                .background(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous).fill(Color.neonSurfaceSunken))
                                .environment(\.layoutDirection, naturalDirection(reviewNote) ?? AppLanguage.current.layoutDirection)
                            HStack(spacing: 8) {
                                NeonButton(L("Approve"), symbol: "checkmark", kind: .tinted(.neonSuccessStrong), size: .small, fullWidth: true) {
                                    await respond(to: pending.id, approve: true)
                                }
                                NeonButton(L("Send back"), symbol: "arrow.uturn.backward", kind: .tinted(.neonDangerStrong), size: .small, fullWidth: true) {
                                    await respond(to: pending.id, approve: false)
                                }
                            }
                        }
                        .transition(.neonRise)
                    } else {
                        NeonButton(L("Review"), symbol: "checkmark.seal", kind: .primary, size: .small, fullWidth: true) {
                            reviewNote = ""
                            reviewingSubmissionId = pending.id
                        }
                    }
                }
            }
            // Nobody marks their own work done: their part's only move is proof,
            // which goes to the manager's review.
            if isMine(part), part.state != "SUBMITTED", part.state != "DONE" {
                NeonButton(L("Send proof"), symbol: "camera.fill", kind: .brand, size: .medium, fullWidth: true) {
                    sendProof(part, card)
                }
            }
        }
    }

    private var commentsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !card.comments.isEmpty {
                ForEach(card.comments) { comment in
                    let key = chatAuthorKey(authorType: comment.authorType, authorId: comment.authorId)
                    let name = comment.authorType == "ADMIN" ? L("Manager") : comment.authorName
                    HStack(alignment: .top, spacing: 8) {
                        ChatAvatar(url: palette.photo(key: key), name: name, size: 22, color: palette.color(key: key, name: comment.authorName))
                        // What they wrote sits under their name, on the same
                        // side, rather than across the card in its own direction.
                        VStack(alignment: .leading, spacing: 1) {
                            Text(verbatim: name)
                                .font(.system(.caption, weight: .semibold))
                                .foregroundStyle(palette.nameColor(key: key, name: comment.authorName))
                            DirText(comment.body, font: .system(.footnote), color: .neonText, fill: false)
                        }
                        Spacer(minLength: 0)
                    }
                    .transition(.neonRise)
                }
            }
            HStack(spacing: 8) {
                TextField(L("Write a comment…"), text: $commentDraft, axis: .vertical)
                    .font(.system(.footnote))
                    .lineLimit(1...4)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(Color.neonSurfaceSunken))
                    .environment(\.layoutDirection, naturalDirection(commentDraft) ?? AppLanguage.current.layoutDirection)
                Button {
                    send()
                } label: {
                    Group {
                        if sendingComment {
                            ProgressView().controlSize(.small).tint(.white)
                        } else {
                            Image(systemName: "paperplane.fill")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(.white)
                        }
                    }
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(LinearGradient.neonAction))
                }
                .buttonStyle(PressableStyle(scale: 0.88))
                .disabled(commentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sendingComment)
                .opacity(commentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.45 : 1)
                .accessibilityLabel(L("Send"))
            }
        }
        .animation(NeonMotion.resolved(NeonMotion.snappy), value: card.comments.count)
    }

    private func isMine(_ part: TaskCard.Assignment) -> Bool {
        viewer?.side == .employee && viewer?.id == part.employeeId
    }

    private func send() {
        let body = commentDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        commentDraft = ""
        Haptic.tap()
        sendingComment = true
        Task {
            defer { sendingComment = false }
            do {
                _ = try await api.addChatTaskComment(taskId: card.id, body: body)
                onChanged()
            } catch {
                commentDraft = body
                Toast.error(error)
            }
        }
    }

    private func respond(to submissionId: String, approve: Bool) async {
        do {
            if approve {
                _ = try await api.approveChatSubmission(id: submissionId, note: reviewNote)
            } else {
                _ = try await api.rejectChatSubmission(id: submissionId, note: reviewNote)
            }
            Haptic.success()
            reviewingSubmissionId = nil
            onChanged()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

// MARK: - Meeting card

/// A meeting set from the chat: the manager's ONLINE or IN_PERSON card with
/// its attendees. Whoever was asked answers ACCEPTED or DECLINED right here;
/// the manager can call it off; Join opens ten minutes before the start,
/// through the same call buttons the conversation's header carries. Somebody
/// who has not answered is "Not answered yet" — never read as a no.
struct ChatMeetingCardView: View {
    let meeting: MeetingCard
    let callSlug: String
    let callTitle: String
    let viewer: Identity?
    let onChanged: () -> Void

    @EnvironmentObject private var api: APIClient
    @Environment(\.chatRoomPalette) private var palette
    @State private var confirmCancel = false
    @State private var cancelling = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 10) {
                ChatMeetingDateTile(iso: meeting.startsAt)
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("MEETING"))
                        .font(.neonOverline)
                        .tracking(0.6)
                        .foregroundStyle(NeonHue.cyan.deep)
                    DirText(meeting.title, font: .neonCardTitle, lineLimit: 3)
                }
                Spacer(minLength: 4)
                if viewer?.side == .admin {
                    Button {
                        Haptic.warning()
                        confirmCancel = true
                    } label: {
                        Group {
                            if cancelling {
                                ProgressView().controlSize(.small)
                            } else {
                                Image(systemName: "xmark").font(.system(size: 12, weight: .bold))
                            }
                        }
                        .foregroundStyle(NeonHue.red.deep)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(NeonHue.red.wash))
                    }
                    .buttonStyle(PressableStyle(scale: 0.88))
                    .disabled(cancelling)
                    .accessibilityLabel(L("Cancel meeting"))
                }
            }

            if let agenda = meeting.agenda, !agenda.isEmpty {
                DirText(agenda, font: .neonSubheadline, color: .neonTextSecondary)
            }

            VStack(alignment: .leading, spacing: 6) {
                if let starts = chatCardDate(meeting.startsAt) {
                    MetaLabel(meeting.durationMinutes.map { L("%@ · %d min", starts, $0) } ?? starts, symbol: "clock", tint: .neonTextSecondary)
                }
                MetaLabel(
                    meeting.mode == "IN_PERSON" ? (meeting.place?.isEmpty == false ? meeting.place! : L("In person")) : L("Online"),
                    symbol: meeting.mode == "IN_PERSON" ? "mappin.and.ellipse" : "video.fill",
                    tint: .neonTextSecondary
                )
            }

            if meeting.mode != "IN_PERSON", isUpcoming {
                HStack(spacing: 8) {
                    if isLive {
                        StateBadge(L("Now"), tone: .pink, pulsing: true)
                    } else if !hasStarted {
                        StateBadge(L("Starting soon"), tone: .cyan)
                    }
                    Spacer(minLength: 0)
                    CallButtons(slug: callSlug, title: callTitle)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous).fill(NeonHue.cyan.wash))
            }

            if !meeting.attendees.isEmpty {
                NeonDivider()
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(meeting.attendees) { person in
                        HStack(spacing: 8) {
                            ChatAvatar(url: palette.photo(key: person.memberKey), name: chatMemberName(key: person.memberKey, name: person.name), size: 24,
                                       color: palette.color(key: person.memberKey, name: person.name))
                            DirText(chatMemberName(key: person.memberKey, name: person.name), font: .system(.subheadline, weight: .medium), fill: false, lineLimit: 1)
                            Spacer(minLength: 4)
                            StateBadge(rsvpLabel(person.rsvp), tone: rsvpTone(person.rsvp), symbol: rsvpSymbol(person.rsvp))
                        }
                    }
                }
            }

            if let mine = myAttendee {
                HStack(spacing: 8) {
                    NeonButton(L("Coming"), symbol: "checkmark",
                               kind: mine.rsvp == "ACCEPTED" ? .tinted(.neonSuccessStrong) : .secondary,
                               size: .small, fullWidth: true) {
                        await rsvp("ACCEPTED")
                    }
                    NeonButton(L("Not coming"), symbol: "xmark",
                               kind: mine.rsvp == "DECLINED" ? .tinted(.neonDangerStrong) : .secondary,
                               size: .small, fullWidth: true) {
                        await rsvp("DECLINED")
                    }
                }
            }
        }
        .padding(NeonSpace.lg - 2)
        .frame(maxWidth: 300, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous).fill(Color.white))
        .overlay(alignment: .top) { ChatRoomCardEdge(hue: .cyan) }
        .clipShape(RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous).strokeBorder(Color.neonCyan.opacity(0.2), lineWidth: 1))
        .neonShadow(.card)
        .neonContextShape(radius: NeonRadius.lg)
        .confirmationDialog(L("Cancel this meeting?"), isPresented: $confirmCancel, titleVisibility: .visible) {
            Button(L("Cancel meeting"), role: .destructive) { cancel() }
            Button(L("Keep it"), role: .cancel) {}
        }
    }

    private var myKey: String? {
        guard let viewer else { return nil }
        return viewer.side == .admin ? "admin" : viewer.id
    }

    private var myAttendee: MeetingCard.Attendee? {
        guard let myKey else { return nil }
        return meeting.attendees.first { $0.memberKey == myKey }
    }

    /// Ten minutes before the start and while it is plausibly still running —
    /// the same window the card's own Join button opens in on the web.
    private var isUpcoming: Bool {
        guard let starts = parseISODate(meeting.startsAt) else { return true }
        let duration = TimeInterval((meeting.durationMinutes ?? 60) * 60)
        return Date() > starts.addingTimeInterval(-600) && Date() < starts.addingTimeInterval(duration + 1800)
    }

    private var hasStarted: Bool {
        guard let starts = parseISODate(meeting.startsAt) else { return false }
        return Date() >= starts
    }

    /// Between its start and its planned end.
    private var isLive: Bool {
        guard let starts = parseISODate(meeting.startsAt) else { return false }
        return Date() >= starts && Date() < starts.addingTimeInterval(TimeInterval((meeting.durationMinutes ?? 60) * 60))
    }

    private func rsvp(_ answer: String) async {
        do {
            _ = try await api.setChatMeetingRsvp(meetingId: meeting.id, rsvp: answer)
            Haptic.success()
            onChanged()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func cancel() {
        Haptic.tap()
        cancelling = true
        Task {
            defer { cancelling = false }
            do {
                _ = try await api.cancelChatMeeting(id: meeting.id)
                onChanged()
            } catch {
                Toast.error(error)
            }
        }
    }
}

/// When a card is due or a meeting starts: "Wed, Sep 16 · 7:00 PM", with
/// the year only when it is not this one.
func chatCardDate(_ iso: String?) -> String? {
    guard let date = parseISODate(iso) else { return nil }
    let locale = AppLanguage.current.locale
    let sameYear = Calendar.current.isDate(date, equalTo: Date(), toGranularity: .year)
    var day = Date.FormatStyle(locale: locale).weekday(.abbreviated).month(.abbreviated).day()
    if !sameYear { day = day.year() }
    let time = date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: locale))
    return "\(date.formatted(day)) · \(time)"
}

/// What a meeting answer looks like: yes in green, no in red, and not yet in
/// a calm grey — silence is not a refusal.
func rsvpTone(_ rsvp: String) -> BadgeTone {
    switch rsvp {
    case "ACCEPTED": return .success
    case "DECLINED": return .danger
    default: return .neutral
    }
}

func rsvpSymbol(_ rsvp: String) -> String {
    switch rsvp {
    case "ACCEPTED": return "checkmark.circle.fill"
    case "DECLINED": return "xmark.circle.fill"
    default: return "hourglass"
    }
}

/// A meeting's day as a little calendar leaf: the month on a band, the day under it.
struct ChatMeetingDateTile: View {
    let iso: String
    var size: CGFloat = 44

    var body: some View {
        let date = parseISODate(iso)
        let locale = AppLanguage.current.locale
        VStack(spacing: 0) {
            Text(date.map { $0.formatted(Date.FormatStyle(locale: locale).month(.abbreviated)) } ?? "—")
                .font(.system(.caption2, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity)
                .frame(height: size * 0.36)
                .background(NeonHue.cyan.fill)
            Text(date.map { $0.formatted(Date.FormatStyle(locale: locale).day()) } ?? "")
                .font(.system(.title3, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(Color.neonInk)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(width: size, height: size + 4)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: NeonRadius.tile(size), style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: NeonRadius.tile(size), style: .continuous).strokeBorder(Color.neonLine, lineWidth: 1))
        .neonShadow(.low)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .accessibilityHidden(true)
    }
}

/// The coloured band along a card's top edge.
struct ChatRoomCardEdge: View {
    let hue: NeonHue

    var body: some View {
        LinearGradient(colors: hue.gradient, startPoint: .leading, endPoint: .trailing)
            .frame(height: 4)
            .flipsForRightToLeftLayoutDirection(true)
            .accessibilityHidden(true)
    }
}
