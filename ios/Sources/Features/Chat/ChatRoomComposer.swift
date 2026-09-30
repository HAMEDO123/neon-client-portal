import SwiftUI

/// The foot of a conversation: the canned replies, the project the next
/// message is filed under, what went wrong with the last send, and the row
/// itself — + for everything that is not text, the box (with the camera in it
/// while it is empty), and the round button that is the microphone until
/// there is something to send. While recording, the row becomes the
/// recording: the time, the microphone's live level, bin and send.
struct ChatRoomComposer: View {
    @Binding var draft: String
    var focused: FocusState<Bool>.Binding
    @ObservedObject var recorder: ChatVoiceRecorder
    let isOffline: Bool
    let sendError: String?
    let onDismissError: () -> Void
    let taggedProject: ChatMessage.ProjectTag?
    let taggableProjects: [ChatMessage.ProjectTag]
    let onTag: (String?) -> Void
    /// The manager, anywhere but their own private chat with the assistant:
    /// + offers a task and a meeting.
    let canHandOut: Bool
    /// The team's canned answers — for the team, not the manager they answer
    /// (the website shows them on its studio side only).
    let showsQuickReplies: Bool
    let onCamera: () -> Void
    let onPhotos: () -> Void
    let onFiles: () -> Void
    let onTask: () -> Void
    let onMeeting: () -> Void
    let onSend: () -> Void
    let onQuickReply: (String) -> Void
    let onVoice: (URL, Int) -> Void

    private var draftIsEmpty: Bool { draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        VStack(spacing: 8) {
            if let sendError {
                errorNote(sendError)
                    .transition(.neonRise)
            }

            if recorder.isRecording {
                recordingRow
                    .transition(.neonRise)
            } else {
                if draftIsEmpty, showsQuickReplies {
                    quickReplies
                        .transition(.opacity.combined(with: .offset(y: 8)))
                }
                if let taggedProject {
                    projectChip(taggedProject)
                        .transition(.neonPop)
                }
                inputRow
            }
        }
        .padding(.top, 6)
        .padding(.bottom, 8)
        .animation(NeonMotion.resolved(NeonMotion.snappy), value: draftIsEmpty)
        .animation(NeonMotion.resolved(NeonMotion.snappy), value: recorder.isRecording)
        .animation(NeonMotion.resolved(NeonMotion.snappy), value: sendError)
        .animation(NeonMotion.resolved(NeonMotion.snappy), value: taggedProject?.id)
    }

    // MARK: The row

    private var inputRow: some View {
        HStack(alignment: .bottom, spacing: 8) {
            attachMenu

            HStack(alignment: .bottom, spacing: 6) {
                TextField("", text: $draft, prompt: Text(L("Message")).foregroundColor(.neonTextTertiary), axis: .vertical)
                    .font(.neonCallout)
                    .foregroundStyle(Color.neonInk)
                    .lineLimit(1...6)
                    .focused(focused)
                    .padding(.vertical, 11)
                    .environment(\.layoutDirection, naturalDirection(draft) ?? AppLanguage.current.layoutDirection)
                if draftIsEmpty {
                    Button {
                        Haptic.tap()
                        if CameraPicker.isAvailable { onCamera() } else { onPhotos() }
                    } label: {
                        Image(systemName: CameraPicker.isAvailable ? "camera.fill" : "photo.fill")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(Color.neonTextSecondary)
                            .frame(width: 34, height: 42)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressableStyle(scale: 0.85))
                    .disabled(isOffline)
                    .accessibilityLabel(CameraPicker.isAvailable ? L("Camera") : L("Photo"))
                    .transition(.scale(scale: 0.5).combined(with: .opacity))
                }
            }
            .padding(.leading, 16)
            .padding(.trailing, draftIsEmpty ? 6 : 16)
            .frame(minHeight: 44)
            .background(Capsule().fill(Color.white))
            .overlay(Capsule().strokeBorder(focused.wrappedValue ? Color.neonAccent.opacity(0.45) : Color.neonLine, lineWidth: focused.wrappedValue ? 1.5 : 1))
            .neonShadow(.low)
            .animation(NeonMotion.resolved(NeonMotion.quick), value: focused.wrappedValue)

            sendButton
        }
        .padding(.horizontal, 12)
    }

    private var attachMenu: some View {
        Menu {
            if CameraPicker.isAvailable {
                Button(action: onCamera) { Label(L("Camera"), systemImage: "camera") }
            }
            Button(action: onPhotos) { Label(L("Photo"), systemImage: "photo.on.rectangle") }
            Button(action: onFiles) { Label(L("File"), systemImage: "doc") }
            if !taggableProjects.isEmpty {
                Menu {
                    if taggedProject != nil {
                        Button { onTag(nil) } label: { Label(L("No project"), systemImage: "xmark") }
                        Divider()
                    }
                    ForEach(taggableProjects) { project in
                        Button { onTag(project.id) } label: {
                            if project.id == taggedProject?.id {
                                Label(project.name, systemImage: "checkmark")
                            } else {
                                Text(project.name)
                            }
                        }
                    }
                } label: {
                    Label(taggedProject?.name ?? L("Project this is about"), systemImage: "folder")
                }
            }
            if canHandOut {
                Divider()
                Button(action: onTask) { Label(L("Task"), systemImage: "checklist") }
                Button(action: onMeeting) { Label(L("Meeting"), systemImage: "calendar.badge.plus") }
            }
        } label: {
            IconButtonLabel("plus", look: .glass, tint: .neonInk, size: 44)
        }
        .disabled(isOffline)
        .opacity(isOffline ? 0.5 : 1)
        .accessibilityLabel(L("Attach"))
    }

    private var sendButton: some View {
        Button {
            if draftIsEmpty {
                Haptic.tap()
                recorder.start()
            } else {
                onSend()
            }
        } label: {
            ZStack {
                Circle().fill(LinearGradient.neonAction)
                Image(systemName: draftIsEmpty ? "mic.fill" : "arrow.up")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                    .id(draftIsEmpty)
                    .transition(.scale(scale: 0.3).combined(with: .opacity))
            }
            .frame(width: 44, height: 44)
            .overlay(Circle().strokeBorder(Color.white.opacity(0.25), lineWidth: 1))
            .neonShadow(.glow(.neonIndigo))
        }
        .buttonStyle(PressableStyle(scale: 0.86))
        .disabled(isOffline)
        .opacity(isOffline ? 0.5 : 1)
        .accessibilityLabel(draftIsEmpty ? L("Voice message") : L("Send"))
        .animation(NeonMotion.resolved(NeonMotion.bouncy), value: draftIsEmpty)
    }

    // MARK: Around the row

    private var quickReplies: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(chatQuickReplies) { reply in
                    Button { onQuickReply(reply.text) } label: {
                        // The kit's chip, with the reply's glyph in its own
                        // colour — the words go out with the website's emoji.
                        HStack(spacing: 6) {
                            Image(systemName: reply.symbol)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(reply.hue.deep)
                            Text(reply.title)
                                .lineLimit(1)
                        }
                        .font(.system(.subheadline, weight: .medium))
                        .foregroundStyle(Color.neonInk.opacity(0.82))
                        .padding(.horizontal, 14)
                        .frame(minHeight: 36)
                        .background(Capsule().fill(Color.white.opacity(0.96)))
                        .overlay(Capsule().strokeBorder(Color.neonLine, lineWidth: 1))
                        .neonShadow(.low)
                        // A 44-point target around a 36-point chip.
                        .padding(.vertical, (NeonSize.touch - 36) / 2)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(PressableStyle(scale: 0.92))
                    .disabled(isOffline)
                    .accessibilityLabel(reply.title)
                }
            }
            // Inset like the page, bled to the screen's edges, so the row reads
            // as one that scrolls rather than one that was cut off.
            .padding(.horizontal, NeonSpace.gutter)
        }
        .padding(.vertical, -4)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    private func projectChip(_ project: ChatMessage.ProjectTag) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "folder.fill").font(.system(size: 11, weight: .semibold))
            Text(verbatim: project.name)
                .font(.system(.caption, weight: .semibold))
                .lineLimit(1)
            Button { onTag(nil) } label: {
                Image(systemName: "xmark.circle.fill").font(.system(size: 14))
                    .foregroundStyle(NeonHue.blue.deep.opacity(0.7))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L("No project"))
        }
        .foregroundStyle(NeonHue.blue.deep)
        .padding(.leading, 10)
        .padding(.trailing, 6)
        .padding(.vertical, 5)
        .background(Capsule().fill(NeonHue.blue.wash))
        .overlay(Capsule().strokeBorder(Color.neonBlue.opacity(0.18), lineWidth: 1))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(L("Project: %@", project.name))
    }

    private func errorNote(_ text: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12, weight: .semibold))
            Text(text)
                .font(.system(.footnote, weight: .medium))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Button(action: onDismissError) {
                Image(systemName: "xmark.circle.fill").font(.system(size: 16))
                    .foregroundStyle(NeonHue.red.deep.opacity(0.6))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L("Close"))
        }
        .foregroundStyle(Color.neonDangerStrong)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous).fill(NeonHue.red.wash))
        .overlay(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous).strokeBorder(Color.neonDanger.opacity(0.18), lineWidth: 1))
        .padding(.horizontal, 12)
    }

    // MARK: Recording

    private var recordingRow: some View {
        HStack(spacing: 8) {
            Button {
                Haptic.tap()
                recorder.cancel()
            } label: {
                Image(systemName: "trash.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(NeonHue.red.deep)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(NeonHue.red.wash))
                    .overlay(Circle().strokeBorder(Color.neonDanger.opacity(0.18), lineWidth: 1))
            }
            .buttonStyle(PressableStyle(scale: 0.86))
            .accessibilityLabel(L("Delete recording"))

            HStack(spacing: 10) {
                Circle().fill(Color.neonDanger).frame(width: 9, height: 9).neonPulse(true)
                Text(chatDuration(recorder.elapsed))
                    .font(.system(.subheadline, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(Color.neonInk)
                ChatLiveLevels(levels: recorder.levels)
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(Capsule().fill(Color.white))
            .overlay(Capsule().strokeBorder(Color.neonDanger.opacity(0.25), lineWidth: 1))
            .neonShadow(.low)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(L("Recording"))

            Button {
                guard let taken = recorder.stopAndTake() else { Haptic.warning(); return }
                onVoice(taken.url, taken.seconds)
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(LinearGradient.neonAction))
                    .neonShadow(.glow(.neonIndigo))
            }
            .buttonStyle(PressableStyle(scale: 0.86))
            .accessibilityLabel(L("Send"))
        }
        .padding(.horizontal, 12)
    }
}

/// The microphone's level while recording: the newest bar at the trailing
/// end, older ones drifting away from it.
struct ChatLiveLevels: View {
    let levels: [CGFloat]

    var body: some View {
        let padded = Array(repeating: CGFloat(0), count: max(0, ChatVoiceRecorder.levelCount - levels.count)) + levels
        HStack(alignment: .center, spacing: 2) {
            ForEach(Array(padded.enumerated()), id: \.offset) { _, level in
                Capsule()
                    .fill(level > 0 ? Color.neonDanger.opacity(0.75) : Color.neonLineStrong)
                    .frame(width: 2.5, height: max(3, 24 * level))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: 24, alignment: .trailing)
        .clipped()
        .animation(NeonMotion.resolved(NeonMotion.quick), value: levels)
        .accessibilityHidden(true)
    }
}
