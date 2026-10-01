import SwiftUI

// The pieces the camera, the photo editor and the video review share: the
// dark translucent round buttons laid over a picture (the one place in the
// app where the dark look is right), and the caption bar with the chat's name
// and the green send button.

/// The kit's round button on a picture: a dark frosted disc, white glyph.
struct ChatCameraButton: View {
    let symbol: String
    let label: String
    var size: CGFloat = 40
    var isOn = false
    let action: () -> Void

    init(_ symbol: String, label: String, size: CGFloat = 40, isOn: Bool = false, action: @escaping () -> Void) {
        self.symbol = symbol
        self.label = label
        self.size = size
        self.isOn = isOn
        self.action = action
    }

    var body: some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            Image(systemName: symbol)
                .font(.system(size: size * 0.42, weight: .semibold))
                .foregroundStyle(isOn ? Color.black : Color.white)
                .frame(width: size, height: size)
                .background(ChatCameraDisc(isOn: isOn))
                .contentShape(Circle())
        }
        .buttonStyle(PressableStyle(scale: 0.88))
        .accessibilityLabel(Text(label))
    }
}

/// The same disc around a word rather than a symbol: "HD", "Aa", "1×".
struct ChatCameraWordButton: View {
    let word: String
    let label: String
    var size: CGFloat = 40
    var isOn = false
    var tint: Color = .white
    let action: () -> Void

    var body: some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            Text(verbatim: word)
                .font(.system(size: size * 0.36, weight: .bold))
                .monospacedDigit()
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .foregroundStyle(isOn ? Color.black : tint)
                .frame(width: size, height: size)
                .background(ChatCameraDisc(isOn: isOn))
                .contentShape(Circle())
                .environment(\.layoutDirection, .leftToRight)
        }
        .buttonStyle(PressableStyle(scale: 0.88))
        .accessibilityLabel(Text(label))
    }
}

/// A dark frosted disc (white when switched on), as the kit draws its round
/// buttons over a photo or a call.
struct ChatCameraDisc: View {
    var isOn = false

    var body: some View {
        if isOn {
            Circle().fill(Color.white)
        } else {
            Circle()
                .fill(.ultraThinMaterial)
                .overlay(Circle().fill(Color.black.opacity(0.32)))
                .overlay(Circle().strokeBorder(Color.white.opacity(0.18), lineWidth: 1))
        }
    }
}

/// The foot of the editor and the video review: the caption box (with the
/// camera, to take another, on its leading side), then the chat it goes to
/// and the green send button.
struct ChatCameraCaptionBar: View {
    @Binding var caption: String
    let chatName: String
    var isSending = false
    /// 0…1 while a video is being made ready; nil otherwise.
    var progress: Double?
    var focused: FocusState<Bool>.Binding
    let onRetake: () -> Void
    let onSend: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            HStack(alignment: .bottom, spacing: 4) {
                Button {
                    Haptic.tap()
                    onRetake()
                } label: {
                    Image(systemName: "camera.fill")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(.white.opacity(0.9))
                        .frame(width: 40, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressableStyle(scale: 0.85))
                .accessibilityLabel(L("Take another"))

                TextField("", text: $caption, prompt: Text(L("Add a caption…")).foregroundColor(.white.opacity(0.55)), axis: .vertical)
                    .font(.neonCallout)
                    .foregroundStyle(.white)
                    .tint(.neonAmber)
                    .lineLimit(1...5)
                    .focused(focused)
                    .padding(.vertical, 11)
                    .padding(.trailing, 14)
                    .environment(\.layoutDirection, naturalDirection(caption) ?? AppLanguage.current.layoutDirection)
            }
            .padding(.leading, 4)
            .frame(minHeight: 46)
            .background(
                RoundedRectangle(cornerRadius: 23, style: .continuous)
                    .fill(Color(white: 0.16).opacity(0.92))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 23, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
            )

            HStack(spacing: 12) {
                HStack(spacing: 6) {
                    Image(systemName: "bubble.left.fill").font(.system(size: 11, weight: .semibold))
                    DirText(chatName, font: .system(.subheadline, weight: .semibold), color: .white, fill: false, lineLimit: 1)
                }
                .padding(.horizontal, 14)
                .frame(minHeight: 34)
                .foregroundStyle(.white)
                .background(Capsule().fill(Color(white: 0.16).opacity(0.92)))
                .accessibilityElement(children: .combine)
                .accessibilityLabel(L("To %@", chatName))

                Spacer(minLength: 8)

                ChatCameraSendButton(isSending: isSending, progress: progress, action: onSend)
            }
        }
        .padding(.horizontal, 12)
    }
}

/// The big round green send button (a paper plane); a ring fills around it
/// while a video is being made ready.
struct ChatCameraSendButton: View {
    var isSending = false
    var progress: Double?
    let action: () -> Void

    var body: some View {
        Button {
            Haptic.impact(.medium)
            action()
        } label: {
            ZStack {
                Circle().fill(Color.neonSuccess)
                if isSending {
                    if let progress {
                        Circle()
                            .trim(from: 0, to: max(0.02, progress))
                            .stroke(Color.white, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                            .padding(5)
                            .animation(NeonMotion.resolved(NeonMotion.quick), value: progress)
                    }
                    ProgressView().tint(.white)
                } else {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 21, weight: .semibold))
                        .foregroundStyle(.white)
                        // A plane points the way the words go.
                        .flipsForRightToLeftLayoutDirection(true)
                }
            }
            .frame(width: 56, height: 56)
            .neonShadow(.glow(.neonSuccess))
        }
        .buttonStyle(PressableStyle(scale: 0.88))
        .disabled(isSending)
        .accessibilityLabel(isSending ? L("Sending") : L("Send"))
    }
}
