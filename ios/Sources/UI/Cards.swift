import SwiftUI

// MARK: - Cards

/// A card on one of the kit's surfaces, padded and full width.
/// Tappable? Wrap it: `Button { … } label: { NeonCard { … } }.buttonStyle(.pressableCard)`.
struct NeonCard<Content: View>: View {
    var surface: NeonSurface
    var padding: CGFloat
    var radius: CGFloat
    var spacing: CGFloat
    let content: Content

    init(
        _ surface: NeonSurface = .glass,
        padding: CGFloat = NeonSpace.lg,
        radius: CGFloat = NeonRadius.lg,
        spacing: CGFloat = NeonSpace.md,
        @ViewBuilder content: () -> Content
    ) {
        self.surface = surface
        self.padding = padding
        self.radius = radius
        self.spacing = spacing
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            content
        }
        .padding(padding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(surface, radius: radius)
        .neonContextShape(radius: radius)
    }
}

enum IconTileStyle {
    /// A pastel tile with the glyph in the hue's deep colour — the mockups' tile.
    case soft
    /// The hue as a gradient fill, with a white glyph and a glow.
    case filled
    /// White, glyph in the hue.
    case glass
}

/// A rounded square holding a symbol — the leading mark of rows, cards and
/// KPI tiles. Give it a hue (`hue: .blue`); a kit colour (`tint: .neonCyanStrong`)
/// is read as its hue, so older call sites get the same pastel tile.
struct IconTile: View {
    let symbol: String
    var tint: Color
    var size: CGFloat
    var style: IconTileStyle
    private var hue: NeonHue?

    init(_ symbol: String, tint: Color = .neonPurpleStrong, size: CGFloat = NeonSize.iconTile, style: IconTileStyle = .soft) {
        self.symbol = symbol
        self.tint = tint
        self.size = size
        self.style = style
        self.hue = NeonHue(tint)
    }

    init(_ symbol: String, hue: NeonHue, size: CGFloat = NeonSize.iconTile, style: IconTileStyle = .soft) {
        self.symbol = symbol
        self.tint = hue.deep
        self.size = size
        self.style = style
        self.hue = hue
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.tile(size), style: .continuous)
        Image(systemName: symbol)
            .font(.system(size: size * 0.46, weight: .semibold))
            .foregroundStyle(style == .filled ? Color.white : (hue?.deep ?? tint))
            .frame(width: size, height: size)
            .background {
                switch style {
                case .soft:
                    if let hue {
                        shape.fill(LinearGradient(colors: [hue.wash, hue.pastel], startPoint: .topLeading, endPoint: .bottomTrailing))
                            .overlay(shape.strokeBorder(Color.white.opacity(0.55), lineWidth: 1))
                    } else {
                        shape.fill(tint.opacity(0.13))
                    }
                case .filled:
                    shape.fill(hue?.fill ?? LinearGradient.neonTint(tint))
                        .overlay(shape.strokeBorder(Color.white.opacity(0.22), lineWidth: 1))
                        .shadow(color: (hue?.color ?? tint).opacity(0.32), radius: size * 0.2, x: 0, y: size * 0.1)
                case .glass:
                    shape.fill(Color.white)
                        .overlay(shape.strokeBorder(Color.neonLine, lineWidth: 1))
                        .neonShadow(.low)
                }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Rows

/// What sits at the leading edge of a `ListRow` or a `ListCardRow`.
enum RowLeading {
    case plain
    case icon(_ symbol: String, tint: Color = .neonPurpleStrong)
    case avatar(url: URL?, name: String, online: Bool = false)
    case thumbnail(url: URL?)
    /// A picture already in hand: a photo just taken, a render on disk.
    case image(Image)
}

/// A `RowLeading` drawn at a size.
struct RowLeadingView: View {
    let leading: RowLeading
    var size: CGFloat = 42
    var avatarStyle: AvatarStyle = .soft

    var body: some View {
        switch leading {
        case .plain:
            EmptyView()
        case .icon(let symbol, let tint):
            IconTile(symbol, tint: tint, size: size - 2)
        case .avatar(let url, let name, let online):
            AvatarView(url: url, name: name, size: size, online: online, style: avatarStyle)
        case .thumbnail(let url):
            RemoteImage(url: url)
                .frame(width: size + 4, height: size + 4)
                .clipShape(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous))
        case .image(let image):
            image
                .resizable()
                .scaledToFill()
                .frame(width: size + 4, height: size + 4)
                .clipShape(RoundedRectangle(cornerRadius: NeonRadius.sm, style: .continuous))
        }
    }
}

/// The kit's list row: a leading mark, a title and subtitle in their own
/// direction, and on the trailing side a value, a badge, anything else, and
/// a chevron. It draws no background — put it in a `CardList`, a `NeonCard`,
/// or give it `.neonSurface()`; in a `List` add `.neonListRow()`.
struct ListRow<Trailing: View>: View {
    let title: String
    var subtitle: String?
    var meta: String?
    var leading: RowLeading
    var value: String?
    var badge: String?
    var badgeTone: BadgeTone
    var chevron: Bool
    var titleLines: Int
    let trailing: Trailing

    init(
        _ title: String,
        subtitle: String? = nil,
        meta: String? = nil,
        leading: RowLeading = .plain,
        value: String? = nil,
        badge: String? = nil,
        badgeTone: BadgeTone = .neutral,
        chevron: Bool = false,
        titleLines: Int = 2,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.title = title
        self.subtitle = subtitle
        self.meta = meta
        self.leading = leading
        self.value = value
        self.badge = badge
        self.badgeTone = badgeTone
        self.chevron = chevron
        self.titleLines = titleLines
        self.trailing = trailing()
    }

    var body: some View {
        HStack(spacing: 12) {
            RowLeadingView(leading: leading)
            VStack(alignment: .leading, spacing: 3) {
                DirText(title, font: .system(.callout, weight: .semibold), color: .neonInk, fill: false, lineLimit: titleLines)
                if let subtitle, !subtitle.isEmpty {
                    DirText(subtitle, font: .system(.footnote), color: .neonTextSecondary, fill: false, lineLimit: 2)
                }
                if let meta, !meta.isEmpty {
                    Text(meta)
                        .font(.system(.caption, weight: .medium))
                        .foregroundStyle(Color.neonTextTertiary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if value != nil || badge != nil {
                VStack(alignment: .trailing, spacing: 5) {
                    if let value {
                        Text(value)
                            .font(.system(.subheadline, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(Color.neonInk.opacity(0.82))
                            .lineLimit(1)
                    }
                    if let badge {
                        BadgeView(text: badge, tone: badgeTone)
                    }
                }
                .fixedSize()
            }
            trailing
            if chevron {
                Image(systemName: "chevron.forward")
                    .font(.system(.footnote, weight: .semibold))
                    .foregroundStyle(Color.neonTextFaint)
            }
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 14)
        .contentShape(Rectangle())
        // One spoken element, unless the trailing side holds its own control.
        .accessibilityElement(children: Trailing.self == EmptyView.self ? .combine : .contain)
    }
}

extension ListRow where Trailing == EmptyView {
    init(
        _ title: String,
        subtitle: String? = nil,
        meta: String? = nil,
        leading: RowLeading = .plain,
        value: String? = nil,
        badge: String? = nil,
        badgeTone: BadgeTone = .neutral,
        chevron: Bool = false,
        titleLines: Int = 2
    ) {
        self.init(
            title, subtitle: subtitle, meta: meta, leading: leading, value: value,
            badge: badge, badgeTone: badgeTone, chevron: chevron, titleLines: titleLines
        ) { EmptyView() }
    }
}

/// A label and its value on one line, for detail pages. `userText` lays the
/// value out in its own direction (an address, a note, a name).
struct KeyValueRow: View {
    let label: String
    let value: String
    var symbol: String?
    var userText: Bool
    var selectable: Bool

    init(_ label: String, value: String, symbol: String? = nil, userText: Bool = false, selectable: Bool = false) {
        self.label = label
        self.value = value
        self.symbol = symbol
        self.userText = userText
        self.selectable = selectable
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            HStack(spacing: 6) {
                if let symbol {
                    Image(systemName: symbol)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.neonTextTertiary)
                        .frame(width: 16)
                }
                Text(label)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.neonTextSecondary)
            }
            .layoutPriority(1)
            Spacer(minLength: 12)
            valueText
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.neonInk)
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
                .environment(\.layoutDirection, valueDirection)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }

    private var valueDirection: LayoutDirection {
        let app = AppLanguage.current.layoutDirection
        return userText ? (naturalDirection(value) ?? app) : app
    }

    @ViewBuilder
    private var valueText: some View {
        let text = Text(verbatim: value)
        if selectable {
            text.textSelection(.enabled)
        } else {
            text
        }
    }
}

/// A small symbol and a few words: a date, a count, a place.
struct MetaLabel: View {
    let text: String
    let symbol: String
    var tint: Color

    init(_ text: String, symbol: String, tint: Color = .neonTextTertiary) {
        self.text = text
        self.symbol = symbol
        self.tint = tint
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .semibold))
            Text(text)
                .lineLimit(1)
        }
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(tint)
    }
}

/// A small count in a capsule — red by default, as unread counts are in the
/// mockups — for tabs, filters and rows. Nothing at zero.
struct CountBadge: View {
    let count: Int
    var tone: BadgeTone
    var size: CGFloat

    init(_ count: Int, tone: BadgeTone = .danger, size: CGFloat = 20) {
        self.count = count
        self.tone = tone
        self.size = size
    }

    var body: some View {
        if count > 0 {
            Text(count > 99 ? "99+" : NeonFormat.integer(count))
                .font(.system(size: size * 0.58, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(tone == .neutral ? Color.neonInk.opacity(0.7) : .white)
                .padding(.horizontal, size * 0.3)
                .frame(minWidth: size, minHeight: size)
                .background(Capsule().fill(tone == .neutral ? Color.neonInk.opacity(0.08) : tone.color))
                .transition(.neonPop)
                .accessibilityLabel(Text(NeonFormat.integer(count)))
        }
    }
}

// MARK: - Section headers

/// A section's heading, with an optional count, subtitle and action.
struct SectionHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    var count: Int?
    let trailing: Trailing

    init(_ title: String, subtitle: String? = nil, count: Int? = nil, @ViewBuilder trailing: () -> Trailing) {
        self.title = title
        self.subtitle = subtitle
        self.count = count
        self.trailing = trailing()
    }

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text(title)
                        .font(.system(.title3, weight: .bold))
                        .foregroundStyle(Color.neonInk)
                    if let count {
                        CountBadge(count, tone: .neutral)
                    }
                }
                if let subtitle {
                    Text(subtitle)
                        .font(.neonSubtitle)
                        .foregroundStyle(Color.neonTextSecondary)
                }
            }
            Spacer(minLength: 8)
            trailing
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isHeader)
    }
}

extension SectionHeader where Trailing == AnyView {
    /// With a "View All ›" capsule on the trailing side.
    init(_ title: String, subtitle: String? = nil, count: Int? = nil, actionTitle: String, action: @escaping () -> Void) {
        self.init(title, subtitle: subtitle, count: count) {
            AnyView(ViewAllButton(actionTitle, action: action))
        }
    }
}

// MARK: - Section cards

/// The pale capsule link at the head of a card: "View All ›", "Edit".
struct ViewAllButton: View {
    let title: String
    var hue: NeonHue
    var chevron: Bool
    let action: () -> Void

    init(_ title: String = L("View All"), hue: NeonHue = .blue, chevron: Bool = true, action: @escaping () -> Void) {
        self.title = title
        self.hue = hue
        self.chevron = chevron
        self.action = action
    }

    var body: some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            HStack(spacing: 5) {
                Text(title)
                    .lineLimit(1)
                if chevron {
                    Image(systemName: "chevron.forward")
                        .font(.system(.caption, weight: .bold))
                }
            }
            .font(.system(.footnote, weight: .semibold))
            .foregroundStyle(hue == .blue ? Color.neonBlueStrong : hue.deep)
            .padding(.horizontal, 12)
            .frame(minHeight: 30)
            .background(Capsule().fill(hue.wash))
            .overlay(Capsule().strokeBorder(hue.color.opacity(0.08), lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.pressable)
        .fixedSize()
    }
}

/// A white card that carries its own heading — an icon tile, a title, a grey
/// line under it and, on the trailing side, "View All" or any control — and
/// then its content. The mockups' unit for every block of a page.
///
///     SectionCard(L("Project Progress"), subtitle: L("Live status of all projects"),
///                 symbol: "square.stack.3d.up.fill", hue: .blue, action: { showAll() }) {
///         SegmentedProgress(segments)
///     }
struct SectionCard<Content: View, Trailing: View>: View {
    let title: String
    var subtitle: String?
    var symbol: String?
    var hue: NeonHue
    var tileStyle: IconTileStyle
    var spacing: CGFloat
    let content: Content
    let trailing: Trailing

    init(
        _ title: String,
        subtitle: String? = nil,
        symbol: String? = nil,
        hue: NeonHue = .blue,
        tileStyle: IconTileStyle = .soft,
        spacing: CGFloat = 14,
        @ViewBuilder content: () -> Content,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.title = title
        self.subtitle = subtitle
        self.symbol = symbol
        self.hue = hue
        self.tileStyle = tileStyle
        self.spacing = spacing
        self.content = content()
        self.trailing = trailing()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            HStack(alignment: .center, spacing: 12) {
                if let symbol {
                    IconTile(symbol, hue: hue, size: subtitle == nil ? 32 : NeonSize.iconTileLarge, style: tileStyle)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.neonCardTitle)
                        .foregroundStyle(Color.neonInk)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    if let subtitle {
                        Text(subtitle)
                            .font(.neonSubtitle)
                            .foregroundStyle(Color.neonTextSecondary)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                trailing
            }
            content
        }
        .padding(NeonSpace.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .neonContextShape(radius: NeonRadius.lg)
    }
}

extension SectionCard where Trailing == EmptyView {
    init(
        _ title: String,
        subtitle: String? = nil,
        symbol: String? = nil,
        hue: NeonHue = .blue,
        tileStyle: IconTileStyle = .soft,
        spacing: CGFloat = 14,
        @ViewBuilder content: () -> Content
    ) {
        self.init(title, subtitle: subtitle, symbol: symbol, hue: hue, tileStyle: tileStyle, spacing: spacing, content: content) { EmptyView() }
    }
}

extension SectionCard where Trailing == ViewAllButton {
    /// With the "View All ›" capsule (or `actionTitle`) on the trailing side.
    init(
        _ title: String,
        subtitle: String? = nil,
        symbol: String? = nil,
        hue: NeonHue = .blue,
        tileStyle: IconTileStyle = .soft,
        spacing: CGFloat = 14,
        actionTitle: String = L("View All"),
        action: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) {
        self.init(title, subtitle: subtitle, symbol: symbol, hue: hue, tileStyle: tileStyle, spacing: spacing, content: content) {
            ViewAllButton(actionTitle, action: action)
        }
    }
}

extension SectionHeader where Trailing == EmptyView {
    init(_ title: String, subtitle: String? = nil, count: Int? = nil) {
        self.init(title, subtitle: subtitle, count: count) { EmptyView() }
    }
}

// MARK: - Timelines

/// One event on a vertical timeline: a node on a rail, and whatever content.
/// Set `isFirst`/`isLast` so the rail starts and ends at the right node.
struct TimelineRow<Content: View>: View {
    var symbol: String?
    var tint: Color
    var isFirst: Bool
    var isLast: Bool
    var isCurrent: Bool
    let content: Content

    init(
        symbol: String? = nil,
        tint: Color = .neonPurple,
        isFirst: Bool = false,
        isLast: Bool = false,
        isCurrent: Bool = false,
        @ViewBuilder content: () -> Content
    ) {
        self.symbol = symbol
        self.tint = tint
        self.isFirst = isFirst
        self.isLast = isLast
        self.isCurrent = isCurrent
        self.content = content()
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                Rectangle()
                    .fill(isFirst ? Color.clear : Color.neonLineStrong)
                    .frame(width: 2, height: 8)
                node
                Rectangle()
                    .fill(isLast ? Color.clear : Color.neonLineStrong)
                    .frame(width: 2)
                    .frame(maxHeight: .infinity)
            }
            .frame(width: 28)
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 6)
                .padding(.bottom, isLast ? 4 : 18)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var node: some View {
        if let symbol {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(isCurrent ? Color.white : tint)
                .frame(width: 26, height: 26)
                .background(Circle().fill(isCurrent ? AnyShapeStyle(LinearGradient.neonTint(tint)) : AnyShapeStyle(tint.opacity(0.14))))
                .overlay(Circle().strokeBorder(Color.white, lineWidth: 2))
        } else {
            ZStack {
                if isCurrent {
                    Circle().fill(tint.opacity(0.25)).frame(width: 20, height: 20).neonPulse()
                }
                Circle()
                    .fill(tint)
                    .frame(width: 10, height: 10)
                    .overlay(Circle().strokeBorder(Color.white, lineWidth: 2))
            }
            .frame(width: 26, height: 26)
        }
    }
}

extension TimelineRow where Content == TimelineText {
    /// The usual event: what happened, a line under it, and when.
    init(
        _ title: String,
        subtitle: String? = nil,
        time: String? = nil,
        symbol: String? = nil,
        tint: Color = .neonPurple,
        isFirst: Bool = false,
        isLast: Bool = false,
        isCurrent: Bool = false
    ) {
        self.init(symbol: symbol, tint: tint, isFirst: isFirst, isLast: isLast, isCurrent: isCurrent) {
            TimelineText(title: title, subtitle: subtitle, time: time)
        }
    }
}

struct TimelineText: View {
    let title: String
    var subtitle: String?
    var time: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                DirText(title, font: .system(size: 15, weight: .semibold), fill: false)
                Spacer(minLength: 6)
                if let time {
                    Text(time)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.neonTextTertiary)
                        .fixedSize()
                }
            }
            if let subtitle {
                DirText(subtitle, font: .system(size: 13), color: .neonTextSecondary)
            }
        }
    }
}

/// Where something is along a fixed sequence of stages — a project's journey
/// from concept to handover. Scrolls to the current stage.
struct StageTrack: View {
    let stages: [String]
    let current: Int
    var tint: Color

    init(stages: [String], current: Int, tint: Color = .neonPurple) {
        self.stages = stages
        self.current = current
        self.tint = tint
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 0) {
                    ForEach(Array(stages.enumerated()), id: \.offset) { index, stage in
                        VStack(spacing: 8) {
                            HStack(spacing: 0) {
                                Rectangle()
                                    .fill(index == 0 ? Color.clear : (index <= current ? tint : Color.neonLineStrong))
                                    .frame(height: 2)
                                dot(index)
                                Rectangle()
                                    .fill(index == stages.count - 1 ? Color.clear : (index < current ? tint : Color.neonLineStrong))
                                    .frame(height: 2)
                            }
                            Text(stage)
                                .font(.system(size: 11, weight: index == current ? .bold : .medium))
                                .foregroundStyle(index == current ? Color.neonInk : Color.neonTextTertiary)
                                .multilineTextAlignment(.center)
                                .lineLimit(2)
                                .frame(width: 76)
                        }
                        .frame(width: 84)
                        .id(index)
                    }
                }
                .padding(.horizontal, 4)
            }
            .onAppear { proxy.scrollTo(max(0, min(current, stages.count - 1)), anchor: .center) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(stages.indices.contains(current) ? stages[current] : "")
    }

    @ViewBuilder
    private func dot(_ index: Int) -> some View {
        if index < current {
            Image(systemName: "checkmark")
                .font(.system(size: 9, weight: .heavy))
                .foregroundStyle(.white)
                .frame(width: 20, height: 20)
                .background(Circle().fill(tint))
        } else if index == current {
            Circle()
                .fill(LinearGradient.neonBrand)
                .frame(width: 22, height: 22)
                .overlay(Circle().fill(Color.white).frame(width: 8, height: 8))
                .shadow(color: tint.opacity(0.4), radius: 6, x: 0, y: 3)
        } else {
            Circle()
                .strokeBorder(Color.neonLineStrong, lineWidth: 2)
                .background(Circle().fill(Color.white))
                .frame(width: 18, height: 18)
        }
    }
}
