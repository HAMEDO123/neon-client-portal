import SwiftUI

// MARK: - Pictures

/// A picture from the server that fades in, with a soft branded placeholder
/// (shimmering while it loads, a symbol if it can't). It fills whatever frame
/// it is given and clips to it — set the frame and the corner shape outside.
struct RemoteImage: View {
    let url: URL?
    var contentMode: ContentMode
    var placeholderSymbol: String

    init(url: URL?, contentMode: ContentMode = .fill, placeholderSymbol: String = "photo") {
        self.url = url
        self.contentMode = contentMode
        self.placeholderSymbol = placeholderSymbol
    }

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: 0.35))) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: contentMode)
                            .transition(.opacity)
                    case .failure:
                        placeholder(loading: false)
                    default:
                        placeholder(loading: true)
                    }
                }
            } else {
                placeholder(loading: false)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    private func placeholder(loading: Bool) -> some View {
        ZStack {
            LinearGradient(
                colors: [Color.neonBgSoft, Color.neonPurple.opacity(0.10), Color.neonCyan.opacity(0.08)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Image(systemName: placeholderSymbol)
                .font(.system(size: 22, weight: .regular))
                .foregroundStyle(Color.neonPurpleStrong.opacity(0.35))
        }
        .shimmer(loading)
    }
}

// MARK: - People

/// Somebody, for the people components.
struct AvatarItem: Identifiable, Hashable {
    let id: String
    let name: String
    var url: URL?
    var online = false

    init(id: String? = nil, name: String, url: URL? = nil, online: Bool = false) {
        self.id = id ?? name
        self.name = name
        self.url = url
        self.online = online
    }
}

/// Overlapping avatars — who is on a task, who is coming — with "+3" for the rest.
struct AvatarStack: View {
    let people: [AvatarItem]
    var size: CGFloat
    var limit: Int

    init(_ people: [AvatarItem], size: CGFloat = 28, limit: Int = 4) {
        self.people = people
        self.size = size
        self.limit = max(1, limit)
    }

    var body: some View {
        let shown = Array(people.prefix(people.count > limit ? limit - 1 : limit))
        let rest = people.count - shown.count
        HStack(spacing: -size * 0.3) {
            ForEach(Array(shown.enumerated()), id: \.element.id) { index, person in
                AvatarView(url: person.url, name: person.name, size: size, ring: true)
                    .zIndex(Double(shown.count - index))
            }
            if rest > 0 {
                Text(verbatim: "+\(NeonFormat.integer(rest))")
                    .font(.system(size: size * 0.36, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.neonInk.opacity(0.7))
                    .frame(width: size, height: size)
                    .background(Circle().fill(Color.neonBgSoft))
                    .overlay(Circle().strokeBorder(Color.white, lineWidth: max(1.5, size * 0.05)))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: people.map(\.name).joined(separator: ", ")))
    }
}

/// A person as a capsule: picture, name, optionally a role and a remove button.
struct PersonChip: View {
    let name: String
    var url: URL?
    var subtitle: String?
    var isSelected: Bool
    var onRemove: (() -> Void)?

    init(name: String, url: URL? = nil, subtitle: String? = nil, isSelected: Bool = false, onRemove: (() -> Void)? = nil) {
        self.name = name
        self.url = url
        self.subtitle = subtitle
        self.isSelected = isSelected
        self.onRemove = onRemove
    }

    var body: some View {
        HStack(spacing: 7) {
            AvatarView(url: url, name: name, size: subtitle == nil ? 24 : 30)
            VStack(alignment: .leading, spacing: 0) {
                DirText(name, font: .system(size: 13.5, weight: .semibold), fill: false, lineLimit: 1)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 11))
                        .foregroundStyle(Color.neonTextTertiary)
                        .lineLimit(1)
                }
            }
            if let onRemove {
                Button {
                    Haptic.tap()
                    onRemove()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.neonInk.opacity(0.3))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L("Remove"))
            }
        }
        .padding(.leading, 4)
        .padding(.trailing, onRemove == nil ? 12 : 7)
        .padding(.vertical, 4)
        .background(Capsule().fill(isSelected ? Color.neonPurple.opacity(0.14) : Color.white.opacity(0.85)))
        .overlay(Capsule().strokeBorder(isSelected ? Color.neonPurple.opacity(0.35) : Color.neonLine, lineWidth: 1))
        .animation(NeonMotion.snappy, value: isSelected)
    }
}

// MARK: - States

/// A state as a soft capsule with a dot or a symbol. `StateBadge(state:)`
/// speaks the board's task states in the studio's words: Pending, In
/// progress (a live dot), Sent for review, Completed, Planned for tomorrow.
struct StateBadge: View {
    let text: String
    let tone: BadgeTone
    var symbol: String?
    var pulsing: Bool

    init(_ text: String, tone: BadgeTone, symbol: String? = nil, pulsing: Bool = false) {
        self.text = text
        self.tone = tone
        self.symbol = symbol
        self.pulsing = pulsing
    }

    /// TODO, IN_PROGRESS, SUBMITTED, DONE, TOMORROW.
    init(state: String) {
        self.init(taskStateLabel(state), tone: taskStateTone(state), symbol: Self.symbol(for: state), pulsing: state == "IN_PROGRESS")
    }

    var body: some View {
        HStack(spacing: 5) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 10, weight: .bold))
            } else {
                Circle()
                    .fill(tone.color)
                    .frame(width: 7, height: 7)
                    .background(
                        Circle()
                            .fill(tone.color.opacity(0.35))
                            .frame(width: 7, height: 7)
                            .neonPulse(pulsing)
                    )
            }
            Text(text)
                .lineLimit(1)
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(tone.foreground)
        .padding(.horizontal, 9)
        .padding(.vertical, 4.5)
        .background(tone.background, in: Capsule())
        .overlay(Capsule().strokeBorder(tone.foreground.opacity(0.14), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    static func symbol(for state: String) -> String? {
        switch state {
        case "TODO": return "circle.dashed"
        case "SUBMITTED": return "paperplane.fill"
        case "DONE": return "checkmark.seal.fill"
        case "TOMORROW": return "moon.stars.fill"
        default: return nil
        }
    }
}
