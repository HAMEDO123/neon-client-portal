import SwiftUI

// MARK: - Pictures

/// A picture from the server that fades in, with a soft branded placeholder
/// (shimmering while it loads, a symbol if it can't). It fills whatever frame
/// it is given and clips to it — set the frame and the corner shape outside.
/// Loads through `ImagePipeline`, at the size it is drawn.
struct RemoteImage: View {
    let url: URL?
    var contentMode: ContentMode
    var placeholderSymbol: String

    @Environment(\.displayScale) private var displayScale
    @State private var loaded: UIImage?
    @State private var failed = false

    init(url: URL?, contentMode: ContentMode = .fill, placeholderSymbol: String = "photo") {
        self.url = url
        self.contentMode = contentMode
        self.placeholderSymbol = placeholderSymbol
    }

    var body: some View {
        GeometryReader { geo in
            let pixels = max(geo.size.width, geo.size.height * (contentMode == .fill ? 1 : 0)) * displayScale
            let shown = loaded ?? ImagePipeline.shared.cached(url, pixels: pixels)
            ZStack {
                if let shown {
                    Image(uiImage: shown)
                        .resizable()
                        .aspectRatio(contentMode: contentMode)
                        .frame(width: geo.size.width, height: geo.size.height)
                        .transition(.opacity)
                } else {
                    placeholder(loading: url != nil && !failed)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .task(id: RemoteImageKey(url: url, width: ImagePipeline.bucket(pixels))) {
                guard let url, pixels > 0 else { return }
                if ImagePipeline.shared.cached(url, pixels: pixels) != nil { return }
                failed = false
                let image = await ImagePipeline.shared.image(url, pixels: pixels)
                guard !Task.isCancelled else { return }
                withAnimation(.easeOut(duration: 0.3)) {
                    loaded = image
                    failed = image == nil
                }
            }
        }
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

private struct RemoteImageKey: Equatable {
    let url: URL?
    let width: Int?
}

/// A server picture drawn into a fixed round or square slot (avatars):
/// nothing while it loads, so the initials underneath show through.
struct PipelineImage: View {
    let url: URL?
    let points: CGFloat

    @Environment(\.displayScale) private var displayScale
    @State private var loaded: UIImage?

    var body: some View {
        let pixels = points * displayScale
        let shown = loaded ?? ImagePipeline.shared.cached(url, pixels: pixels)
        ZStack {
            if let shown {
                Image(uiImage: shown).resizable().scaledToFill().transition(.opacity)
            } else {
                Color.clear
            }
        }
        .task(id: url) {
            guard let url, ImagePipeline.shared.cached(url, pixels: pixels) == nil else { return }
            let image = await ImagePipeline.shared.image(url, pixels: pixels)
            guard !Task.isCancelled, let image else { return }
            withAnimation(.easeOut(duration: 0.25)) { loaded = image }
        }
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
                    .font(.system(size: size * 0.36, weight: .bold))
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

// MARK: - Presence and stories

/// The green "here right now" dot, ringed in white so it reads on any picture.
struct OnlineDot: View {
    var size: CGFloat = 12

    var body: some View {
        Circle()
            .fill(Color.neonSuccess)
            .frame(width: size, height: size)
            .overlay(Circle().strokeBorder(Color.white, lineWidth: max(1.5, size * 0.2)))
            .transition(.neonPop)
            .accessibilityLabel(L("Online now"))
    }
}

enum StoryRingStyle {
    /// No ring.
    case none
    /// Something new to watch: the brand's colours all the way round.
    case unseen
    /// Watched already: a quiet grey ring.
    case seen
}

/// Somebody in the stories row: their picture inside a gradient ring, the
/// green dot when they are here, a "+" on your own to add one, and their
/// name under it.
///
///     StoryAvatar(name: L("My Story"), url: me.avatarURL, ring: .none, showsAdd: true)
///     StoryAvatar(name: person.name, url: person.avatarURL, online: person.online)
struct StoryAvatar: View {
    let name: String
    var url: URL?
    var size: CGFloat
    var ring: StoryRingStyle
    var online: Bool
    var showsAdd: Bool
    var showsName: Bool

    init(
        name: String,
        url: URL? = nil,
        size: CGFloat = 58,
        ring: StoryRingStyle = .unseen,
        online: Bool = false,
        showsAdd: Bool = false,
        showsName: Bool = true
    ) {
        self.name = name
        self.url = url
        self.size = size
        self.ring = ring
        self.online = online
        self.showsAdd = showsAdd
        self.showsName = showsName
    }

    var body: some View {
        let ringWidth = max(2, size * 0.04)
        let inner = size - ringWidth * 2 - size * 0.08
        VStack(spacing: 6) {
            ZStack {
                switch ring {
                case .none:
                    Circle().fill(Color.white)
                        .neonShadow(.low)
                case .unseen:
                    Circle().strokeBorder(AngularGradient.neonStory, lineWidth: ringWidth)
                case .seen:
                    Circle().strokeBorder(Color.neonLineStrong, lineWidth: ringWidth)
                }
                AvatarView(url: url, name: name, size: inner, style: .solid)
            }
            .frame(width: size, height: size)
            .overlay(alignment: .bottomTrailing) {
                if showsAdd {
                    Image(systemName: "plus")
                        .font(.system(size: size * 0.17, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: size * 0.34, height: size * 0.34)
                        .background(Circle().fill(LinearGradient.neonAction))
                        .overlay(Circle().strokeBorder(Color.white, lineWidth: max(2, size * 0.04)))
                        .offset(x: size * 0.02, y: size * 0.02)
                } else if online {
                    OnlineDot(size: size * 0.26)
                        .offset(x: -size * 0.02, y: -size * 0.02)
                }
            }
            if showsName {
                DirText(name, font: .system(.footnote, weight: .medium), color: .neonInk.opacity(0.85), fill: false, lineLimit: 1)
                    .frame(maxWidth: size + 14)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: name))
        .accessibilityValue(online ? Text(L("Online now")) : Text(""))
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
