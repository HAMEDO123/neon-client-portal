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
    /// A wash of the tint behind a glyph in the tint. Pass a strong colour.
    case soft
    /// The tint as a gradient fill, with a white glyph and a glow.
    case filled
    /// White glass, glyph in the tint.
    case glass
}

/// A rounded square holding a symbol — the leading mark of rows and tiles.
struct IconTile: View {
    let symbol: String
    var tint: Color
    var size: CGFloat
    var style: IconTileStyle

    init(_ symbol: String, tint: Color = .neonPurpleStrong, size: CGFloat = NeonSize.iconTile, style: IconTileStyle = .soft) {
        self.symbol = symbol
        self.tint = tint
        self.size = size
        self.style = style
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
        Image(systemName: symbol)
            .font(.system(size: size * 0.44, weight: .semibold))
            .foregroundStyle(style == .filled ? Color.white : tint)
            .frame(width: size, height: size)
            .background {
                switch style {
                case .soft:
                    shape.fill(tint.opacity(0.13))
                case .filled:
                    shape.fill(LinearGradient.neonTint(tint))
                        .shadow(color: tint.opacity(0.35), radius: size * 0.22, x: 0, y: size * 0.1)
                case .glass:
                    shape.fill(LinearGradient.neonGlassStrong)
                        .overlay(shape.strokeBorder(LinearGradient.neonGlassEdge, lineWidth: 1))
                }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Rows

/// What sits at the leading edge of a `ListRow`.
enum RowLeading {
    case plain
    case icon(_ symbol: String, tint: Color = .neonPurpleStrong)
    case avatar(url: URL?, name: String, online: Bool = false)
    case thumbnail(url: URL?)
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
            leadingView
            VStack(alignment: .leading, spacing: 3) {
                DirText(title, font: .system(size: 15.5, weight: .semibold), color: .neonInk, fill: false, lineLimit: titleLines)
                if let subtitle, !subtitle.isEmpty {
                    DirText(subtitle, font: .system(size: 13), color: .neonTextSecondary, fill: false, lineLimit: 2)
                }
                if let meta, !meta.isEmpty {
                    Text(meta)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.neonTextTertiary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if value != nil || badge != nil {
                VStack(alignment: .trailing, spacing: 5) {
                    if let value {
                        Text(value)
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(Color.neonInk.opacity(0.8))
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
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.neonTextFaint)
            }
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 14)
        .contentShape(Rectangle())
        // One spoken element, unless the trailing side holds its own control.
        .accessibilityElement(children: Trailing.self == EmptyView.self ? .combine : .contain)
    }

    @ViewBuilder
    private var leadingView: some View {
        switch leading {
        case .plain:
            EmptyView()
        case .icon(let symbol, let tint):
            IconTile(symbol, tint: tint)
        case .avatar(let url, let name, let online):
            AvatarView(url: url, name: name, size: 42, online: online)
        case .thumbnail(let url):
            RemoteImage(url: url)
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
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

/// A small count in a capsule, for headers and tabs. Nothing at zero.
struct CountBadge: View {
    let count: Int
    var tone: BadgeTone

    init(_ count: Int, tone: BadgeTone = .pink) {
        self.count = count
        self.tone = tone
    }

    var body: some View {
        if count > 0 {
            Text(count > 99 ? "99+" : NeonFormat.integer(count))
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(tone == .neutral ? Color.neonInk.opacity(0.7) : .white)
                .padding(.horizontal, 6)
                .frame(minWidth: 20, minHeight: 20)
                .background(Capsule().fill(tone == .neutral ? Color.neonInk.opacity(0.08) : tone.color))
                .transition(.neonPop)
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
                        .font(.system(size: 19, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.neonInk)
                    if let count {
                        CountBadge(count, tone: .neutral)
                    }
                }
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.neonTextTertiary)
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
    /// With a text button on the trailing side ("See all", "Add").
    init(_ title: String, subtitle: String? = nil, count: Int? = nil, actionTitle: String, action: @escaping () -> Void) {
        self.init(title, subtitle: subtitle, count: count) {
            AnyView(
                Button {
                    Haptic.tap()
                    action()
                } label: {
                    Text(actionTitle)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.neonPurpleStrong)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(Color.neonPurple.opacity(0.1)))
                }
                .buttonStyle(.pressable)
            )
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
