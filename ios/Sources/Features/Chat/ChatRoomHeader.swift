import SwiftUI

/// What the line under the conversation's name says.
enum ChatRoomStatus: Equatable {
    /// "typing…", or who is, in a group.
    case typing(String)
    /// The other person has the app or the website open right now.
    case online
    /// Last seen, the group's people, or the list's own subtitle.
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
    /// The team, or a group with no picture: the studio's own mark.
    let studioMark: Bool
    let online: Bool
    let status: ChatRoomStatus?
    var onOpenInfo: (() -> Void)?
    let onBack: () -> Void
    @ViewBuilder let trailing: Trailing

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onBack) {
                Image(systemName: "chevron.backward")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Color.neonInk)
                    .frame(width: 26, height: NeonSize.touch)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle(scale: 0.82))
            .accessibilityLabel(L("Back"))

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
        .padding(.leading, 8)
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
                    AvatarView(url: avatarURL, name: title, size: 40, online: online, style: .solid)
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
                DirText(text, font: .system(.caption, weight: .medium), color: .neonTextSecondary, fill: false, lineLimit: 1)
                    .transition(.opacity.combined(with: .offset(y: 4)))
            case .hint(let text):
                Text(text)
                    .foregroundStyle(Color.neonAccent)
                    .transition(.opacity.combined(with: .offset(y: 4)))
            case nil:
                EmptyView()
            }
        }
        .font(.system(.caption, weight: .medium))
        .lineLimit(1)
        .minimumScaleFactor(0.85)
        .animation(NeonMotion.resolved(NeonMotion.snappy), value: status)
    }
}
