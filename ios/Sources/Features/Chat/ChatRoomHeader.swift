import SwiftUI

/// What the line under the conversation's name says.
enum ChatRoomStatus: Equatable {
    /// "typing…", or who is, in a group.
    case typing(String)
    /// The other person has the app or the website open right now.
    case online
    /// Last seen, how many are in the group, or the list's own subtitle.
    case line(String)
    /// A way in: "Group info".
    case hint(String)
}

/// The top of a conversation, drawn by the screen itself rather than the
/// system bar, so nothing floats over the messages: back, the picture and
/// name with the line under it, and the round white buttons on the trailing
/// side. A group the manager made opens its info from the name.
struct ChatRoomHeader<Trailing: View>: View {
    let title: String
    let avatarURL: URL?
    /// The team: the studio's own mark.
    let studioMark: Bool
    /// A group: without a photo of its own, a group glyph on its colour.
    var isGroup = false
    let online: Bool
    let status: ChatRoomStatus?
    var onOpenInfo: (() -> Void)?
    let onBack: () -> Void
    @ViewBuilder let trailing: Trailing

    var body: some View {
        HStack(spacing: 8) {
            IconButton("chevron.backward", label: L("Back"), size: NeonSize.circleButton, action: onBack)

            if let onOpenInfo {
                Button {
                    Haptic.tap()
                    onOpenInfo()
                } label: {
                    identity(showsChevron: true)
                }
                .buttonStyle(PressableStyle(scale: 0.97))
                .accessibilityHint(L("Group info"))
            } else {
                identity(showsChevron: false)
            }

            Spacer(minLength: 4)

            HStack(spacing: 6) {
                trailing
            }
            .layoutPriority(1)
        }
        .padding(.leading, NeonSpace.gutter - 4)
        .padding(.trailing, NeonSpace.gutter - 4)
        .padding(.vertical, 4)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    private func identity(showsChevron: Bool) -> some View {
        HStack(spacing: 8) {
            Group {
                if studioMark {
                    ChatStudioMark(size: 40)
                } else {
                    // The chat list's own face for this conversation, so a
                    // person wears the same colour in both.
                    ChatAvatar(
                        url: isGroup && ChatFace.isStudioIcon(avatarURL) ? nil : avatarURL,
                        name: title,
                        size: 40,
                        online: online,
                        isGroup: isGroup
                    )
                }
            }
            .animation(NeonMotion.resolved(NeonMotion.bouncy), value: online)

            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    DirText(title, font: .system(.headline, weight: .bold), color: .neonInk, fill: false, lineLimit: 1)
                    if showsChevron {
                        Image(systemName: "chevron.forward")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Color.neonTextFaint)
                    }
                }
                statusLine
            }
            .contentShape(Rectangle())
        }
    }

    @ViewBuilder
    private var statusLine: some View {
        ZStack(alignment: .leading) {
            switch status {
            case .typing(let text):
                HStack(spacing: 5) {
                    ChatTypingDots(tint: .neonSuccessStrong, size: 4)
                    Text(verbatim: text)
                }
                .foregroundStyle(Color.neonSuccessStrong)
                .transition(.opacity.combined(with: .offset(y: 4)))
            case .online:
                HStack(spacing: 5) {
                    Circle().fill(Color.neonSuccess).frame(width: 6, height: 6)
                    Text(L("online now"))
                }
                .foregroundStyle(Color.neonSuccessStrong)
                .transition(.opacity.combined(with: .offset(y: 4)))
            case .line(let text):
                DirText(text, font: .neonSubtitle, color: .neonTextSecondary, fill: false, lineLimit: 1)
                    .transition(.opacity.combined(with: .offset(y: 4)))
            case .hint(let text):
                Text(text)
                    .foregroundStyle(Color.neonAccent)
                    .transition(.opacity.combined(with: .offset(y: 4)))
            case nil:
                EmptyView()
            }
        }
        .font(.neonSubtitle)
        .lineLimit(1)
        .minimumScaleFactor(0.85)
        .animation(NeonMotion.resolved(NeonMotion.snappy), value: status)
    }
}
