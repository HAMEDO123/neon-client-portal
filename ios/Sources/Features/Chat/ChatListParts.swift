import SwiftUI

// The pieces the conversation list is drawn from: the colourful avatars, the
// header's round buttons, the filter pill bar, a conversation's card and its
// loading placeholder.

// MARK: - Colour

/// A person's two-tone fill: the colour the studio gave them (`color` on the
/// server: "cyan", "purple"…) when there is one, else a stable one for their name.
enum ChatTint {
    static let pairs: [(Color, Color)] = [
        (.neonPurple, .neonPurpleStrong),
        (.neonPink, .neonPinkStrong),
        (.neonCyan, .neonCyanStrong),
        (.neonOrange, .neonPinkStrong),
        (.neonSuccess, .neonCyanStrong),
        (Color(hex: 0x6366F1), .neonPurpleStrong),
    ]

    static func pair(name: String, color: String? = nil) -> (Color, Color) {
        switch color?.lowercased() {
        case "purple", "violet": return pairs[0]
        case "pink", "rose", "fuchsia": return pairs[1]
        case "cyan", "sky", "teal": return pairs[2]
        case "orange", "amber", "yellow": return pairs[3]
        case "green", "emerald", "lime": return pairs[4]
        case "blue", "indigo": return pairs[5]
        default:
            let seed = name.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0x7FFF_FFFF }
            return pairs[seed % pairs.count]
        }
    }

    static func gradient(name: String, color: String? = nil) -> LinearGradient {
        let (light, deep) = pair(name: name, color: color)
        return LinearGradient(colors: [light, deep], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    /// The selection and accent fill of the chat screens.
    static let accent = LinearGradient(colors: [Color(hex: 0x6366F1), .neonPurple], startPoint: .leading, endPoint: .trailing)
    static let unread = LinearGradient(colors: [.neonPink, Color(hex: 0xF43F5E)], startPoint: .topLeading, endPoint: .bottomTrailing)
    /// An unseen story: the brand's colours all the way round.
    static let storyRing = AngularGradient(
        colors: [.neonCyan, Color(hex: 0x6366F1), .neonPurple, .neonPink, .neonOrange, .neonCyan],
        center: .center
    )
}

// MARK: - Avatars

/// A picture, or bold white initials on the person's own two-tone colour —
/// with the green dot when they are here right now.
struct ChatAvatar: View {
    let url: URL?
    let name: String
    var size: CGFloat = 54
    var color: String?
    var online = false
    var isGroup = false

    var body: some View {
        ZStack {
            ChatTint.gradient(name: name, color: color)
            if isGroup && url == nil {
                Image(systemName: "person.3.fill")
                    .font(.system(size: size * 0.32, weight: .semibold))
                    .foregroundStyle(.white)
            } else {
                Text(AvatarView.initials(name, size: size))
                    .font(.system(size: size * 0.4, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
            }
            if let url {
                PipelineImage(url: url, points: size)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(Color.white.opacity(0.9), lineWidth: 1))
        .overlay(alignment: .bottomTrailing) {
            if online {
                Circle()
                    .fill(Color.neonSuccess)
                    .frame(width: size * 0.26, height: size * 0.26)
                    .overlay(Circle().strokeBorder(Color.white, lineWidth: max(2, size * 0.05)))
                    .offset(x: size * 0.02, y: size * 0.02)
                    .transition(.neonPop)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: name))
        .accessibilityValue(online ? Text(L("Online")) : Text(""))
    }
}

/// The studio's own mark, round: the app icon, or the website's icon.
struct ChatStudioMark: View {
    var size: CGFloat = 48
    private static let icon = UIImage(named: "AppIcon60x60")

    var body: some View {
        ZStack {
            Color.white
            if let icon = Self.icon {
                Image(uiImage: icon).resizable().interpolation(.high).scaledToFill()
            } else {
                AsyncImage(url: resolvedMediaURL("/admin-icon-192.png")) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() } else { Color.clear }
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(Color.white, lineWidth: 2))
        .neonShadow(.low)
        .accessibilityLabel(Text(verbatim: "NEON"))
    }
}

// MARK: - Header buttons

/// The header's round white buttons (search, new chat, more).
struct ChatHeaderButtonLabel: View {
    let symbol: String
    var isActive = false

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(isActive ? Color.white : Color.neonInk)
            .frame(width: 46, height: 46)
            .background {
                if isActive {
                    Circle().fill(ChatTint.accent)
                } else {
                    Circle().fill(Color.white.opacity(0.92))
                }
            }
            .overlay(Circle().strokeBorder(Color.white, lineWidth: 1))
            .neonShadow(isActive ? .glow(.neonPurple) : .low)
            .contentShape(Circle())
    }
}

// MARK: - Filters

enum ChatListFilter: String, CaseIterable, Hashable {
    case all, unread, groups, tasks, favorites

    var label: String {
        switch self {
        case .all: return L("All")
        case .unread: return L("Unread")
        case .groups: return L("Groups")
        case .tasks: return L("Tasks")
        case .favorites: return L("Favorites")
        }
    }
}

/// The pill bar under the stories: the selection slides between the chips.
struct ChatFilterBar: View {
    @Binding var selection: ChatListFilter
    let unreadCount: Int

    @Namespace private var namespace

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    ForEach(ChatListFilter.allCases, id: \.self) { filter in
                        chip(filter, proxy: proxy)
                    }
                }
                .padding(5)
            }
        }
        .background(
            Capsule()
                .fill(Color.white.opacity(0.9))
                .overlay(Capsule().strokeBorder(Color.white, lineWidth: 1))
        )
        .clipShape(Capsule())
        .neonShadow(.low)
    }

    private func chip(_ filter: ChatListFilter, proxy: ScrollViewProxy) -> some View {
        let selected = filter == selection
        return Button {
            guard !selected else { return }
            Haptic.selection()
            withNeonAnimation(NeonMotion.snappy) { selection = filter }
            withAnimation(NeonMotion.smooth) { proxy.scrollTo(filter, anchor: .center) }
        } label: {
            HStack(spacing: 6) {
                Text(filter.label)
                    .lineLimit(1)
                if filter == .unread && unreadCount > 0 {
                    Text(unreadCount > 99 ? "99+" : "\(unreadCount)")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 20, minHeight: 20)
                        .background(Capsule().fill(selected ? AnyShapeStyle(Color.white.opacity(0.28)) : AnyShapeStyle(ChatTint.unread)))
                        .transition(.neonPop)
                }
            }
            .font(.system(size: 15, weight: selected ? .semibold : .medium))
            .foregroundStyle(selected ? Color.white : Color.neonInk.opacity(0.78))
            .padding(.horizontal, 17)
            .frame(height: 40)
            .background {
                if selected {
                    Capsule()
                        .fill(ChatTint.accent)
                        .shadow(color: Color(hex: 0x6366F1).opacity(0.35), radius: 8, y: 4)
                        .matchedGeometryEffect(id: "chat-filter", in: namespace)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(PressableStyle(scale: 0.95))
        .id(filter)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - A conversation

struct ChatConversationCard: View {
    let conversation: ConversationSummary

    var body: some View {
        let hasUnread = conversation.unread > 0
        HStack(spacing: 13) {
            if conversation.isGroup && conversation.avatarURL == nil {
                // The team's chat and a group with no photo wear the studio's mark.
                ChatStudioMark(size: 56)
            } else {
                ChatAvatar(
                    url: conversation.avatarURL,
                    name: conversation.title,
                    size: 56,
                    online: conversation.online == true,
                    isGroup: conversation.isGroup
                )
            }

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    DirText(conversation.title, font: .system(size: 17, weight: hasUnread ? .bold : .semibold), fill: false, lineLimit: 1)
                        .layoutPriority(1)
                    if conversation.pinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 11, weight: .semibold))
                            .rotationEffect(.degrees(40))
                            .foregroundStyle(Color.neonPurple)
                            .accessibilityLabel(L("Pinned"))
                    }
                    if let streak = conversation.streak, streak.count > 0 {
                        ChatStreakBadge(streak: streak)
                    }
                    Spacer(minLength: 4)
                    if let time = shortTime(conversation.last?.createdAt) {
                        Text(time)
                            .font(.system(size: 13, weight: hasUnread ? .semibold : .regular))
                            .foregroundStyle(hasUnread ? Color.neonPinkStrong : Color.neonTextTertiary)
                            .lineLimit(1)
                            .fixedSize()
                    }
                    Image(systemName: "chevron.forward")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.neonTextFaint)
                }

                HStack(spacing: 8) {
                    DirText(
                        preview,
                        font: .system(size: 15, weight: hasUnread ? .medium : .regular),
                        color: hasUnread ? Color.neonInk.opacity(0.82) : Color.neonTextSecondary,
                        lineLimit: 1
                    )
                    if conversation.muted {
                        Image(systemName: "bell.slash.fill")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color.neonTextTertiary)
                            .accessibilityLabel(L("Muted"))
                    }
                    if hasUnread {
                        Text(conversation.unread > 99 ? "99+" : "\(conversation.unread)")
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 7)
                            .frame(minWidth: 24, minHeight: 24)
                            .background(
                                Capsule().fill(conversation.muted ? AnyShapeStyle(Color.neonInk.opacity(0.3)) : AnyShapeStyle(ChatTint.unread))
                            )
                            .shadow(color: conversation.muted ? .clear : Color.neonPink.opacity(0.35), radius: 6, y: 3)
                            .transition(.neonPop)
                            .accessibilityLabel(L("%d unread", conversation.unread))
                    }
                }
            }
        }
        .padding(.vertical, 14)
        .padding(.leading, 14)
        .padding(.trailing, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color.white.opacity(hasUnread ? 0.97 : 0.88))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(hasUnread ? AnyShapeStyle(LinearGradient(colors: [.neonPink.opacity(0.35), .neonPurple.opacity(0.2)], startPoint: .leading, endPoint: .trailing)) : AnyShapeStyle(Color.white), lineWidth: 1)
        )
        .overlay(alignment: .leading) {
            if conversation.pinned {
                Capsule()
                    .fill(ChatTint.accent)
                    .frame(width: 4)
                    .padding(.vertical, 16)
                    .offset(x: 1)
                    .transition(.opacity)
            }
        }
        .neonShadow(.low)
        .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var preview: String {
        if let last = conversation.last { return last.preview(isGroup: conversation.isGroup) }
        if conversation.isGroup, let count = conversation.memberCount { return L("%d members", count) }
        return conversation.subtitle ?? L("No messages yet")
    }
}

/// 🔥 12, and ⏳ when today still needs a message from both.
struct ChatStreakBadge: View {
    let streak: ChatStreak

    var body: some View {
        HStack(spacing: 2) {
            Text(verbatim: "🔥")
            Text(verbatim: "\(streak.count)")
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(Color.neonOrangeStrong)
            if streak.atRisk { Text(verbatim: "⏳") }
        }
        .font(.system(size: 11))
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Capsule().fill(Color.neonOrange.opacity(0.14)))
        .fixedSize()
        .accessibilityElement()
        .accessibilityLabel(streak.atRisk
            ? L("%d-day streak, write today to keep it", streak.count)
            : L("%d-day streak", streak.count))
    }
}

/// The list's loading placeholder, shaped like the cards.
struct ChatCardSkeleton: View {
    let index: Int

    var body: some View {
        HStack(spacing: 13) {
            Circle().fill(Color.neonInk.opacity(0.07)).frame(width: 56, height: 56)
            VStack(alignment: .leading, spacing: 9) {
                SkeletonBlock(width: index.isMultiple(of: 2) ? 150 : 110, height: 13)
                SkeletonBlock(width: index.isMultiple(of: 2) ? 200 : 170, height: 11)
            }
            Spacer(minLength: 0)
            SkeletonBlock(width: 40, height: 11)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Color.white.opacity(0.75)))
        .shimmer()
        .staggered(index)
    }
}
