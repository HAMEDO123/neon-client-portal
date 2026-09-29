import SwiftUI

// MARK: - Small pieces

/// A notice with a tone: a warning, a refusal, a pinned note. Not dismissible
/// on purpose — the studio's warnings stay until the manager removes them.
struct StatusNote: View {
    let symbol: String
    let tone: BadgeTone
    let title: String
    var detail: String?

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.md + 2, style: .continuous)
        HStack(alignment: .top, spacing: 12) {
            IconTile(symbol, hue: tone.hue, size: 34, style: .glass)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(.subheadline, weight: .semibold))
                    .foregroundStyle(Color.neonInk)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail {
                    Text(detail)
                        .font(.neonSubtitle)
                        .foregroundStyle(Color.neonTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.top, 2)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(shape.fill(tone.hue.wash))
        .overlay(shape.strokeBorder(tone.hue.color.opacity(0.18), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// A titled glass card: a labelled block of detail.
struct DetailCard<Content: View>: View {
    let title: String
    let symbol: String
    var tint: Color = .neonCyanStrong
    var footnote: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(tint)
            content
            if let footnote {
                Text(footnote)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.neonTextTertiary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(radius: 16)
    }
}

/// Lines somebody wrote, one bullet each, each in its own direction.
struct BulletList: View {
    let lines: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                let direction = naturalDirection(line) ?? AppLanguage.current.layoutDirection
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Circle()
                        .fill(Color.neonPurple.opacity(0.6))
                        .frame(width: 5, height: 5)
                        .alignmentGuide(.firstTextBaseline) { $0[.bottom] + 1 }
                    Text(verbatim: line)
                        .font(.system(size: 14))
                        .foregroundStyle(Color.neonInk)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .environment(\.layoutDirection, direction)
            }
        }
    }
}

/// Badges that wrap onto a second line instead of running off the screen.
struct FlowRow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += line + spacing
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
        }
        return CGSize(width: width.isFinite ? width : x, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += line + spacing
                line = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

/// A hairline between rows.
struct NeonDivider: View {
    var body: some View {
        Rectangle()
            .fill(Color.neonLine)
            .frame(height: 0.75)
    }
}

// MARK: - Screens

/// The standard screen body: a scroll view over the ambient page, with the
/// gutter, the section rhythm and keyboard dismissal already set. Add
/// `.refreshable` to it for pull to refresh.
struct NeonScroll<Content: View>: View {
    var spacing: CGFloat
    var padding: CGFloat
    let content: Content

    init(spacing: CGFloat = NeonSpace.lg, padding: CGFloat = NeonSpace.gutter, @ViewBuilder content: () -> Content) {
        self.spacing = spacing
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: spacing) {
                content
            }
            .padding(padding)
            .padding(.bottom, NeonSpace.xxl)
        }
        .scrollDismissesKeyboard(.interactively)
        .neonAmbientBackground()
    }
}

/// The top of a tab's page, in place of a navigation bar: the studio's logo
/// or a picture and a big title on the leading side, round white buttons on
/// the trailing side. Put it first in the `NeonScroll` and hide the bar
/// (`.toolbar(.hidden, for: .navigationBar)`), so it scrolls with the page.
///
///     ScreenHeader(L("Chat"), leading: { ChatStudioMark(size: 40) }) {
///         IconButton("magnifyingglass", label: L("Search"), size: NeonSize.circleButton) { … }
///         IconButton("bell", label: L("Alerts"), size: NeonSize.circleButton, dot: unread > 0) { … }
///     }
///     ScreenHeader.brand { … }            // the NEON logo instead of a title
struct ScreenHeader<Leading: View, Trailing: View>: View {
    let title: String?
    var subtitle: String?
    let leading: Leading
    let trailing: Trailing

    init(
        _ title: String? = nil,
        subtitle: String? = nil,
        @ViewBuilder leading: () -> Leading,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.title = title
        self.subtitle = subtitle
        self.leading = leading()
        self.trailing = trailing()
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            leading
            if let title {
                VStack(alignment: .leading, spacing: 0) {
                    Text(title)
                        .font(.neonTitle)
                        .foregroundStyle(Color.neonInk)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    if let subtitle {
                        Text(subtitle)
                            .font(.neonSubtitle)
                            .foregroundStyle(Color.neonTextSecondary)
                            .lineLimit(1)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: 8)
            HStack(spacing: 10) {
                trailing
            }
        }
        .frame(minHeight: NeonSize.circleButton + 4)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }
}

extension ScreenHeader where Leading == EmptyView {
    init(_ title: String, subtitle: String? = nil, @ViewBuilder trailing: () -> Trailing) {
        self.init(title, subtitle: subtitle, leading: { EmptyView() }, trailing: trailing)
    }
}

extension ScreenHeader where Leading == NeonLogo {
    /// The NEON logo on the leading side, as on Home.
    static func brand(@ViewBuilder trailing: () -> Trailing) -> ScreenHeader<NeonLogo, Trailing> {
        ScreenHeader(nil, leading: { NeonLogo() }, trailing: trailing)
    }
}

/// The studio's logo for a header: a gradient "N" and the word NEON in ink.
struct NeonLogo: View {
    var size: CGFloat = 26

    var body: some View {
        HStack(spacing: size * 0.32) {
            Text(verbatim: "N")
                .font(.system(size: size * 1.35, weight: .black))
                .foregroundStyle(LinearGradient(
                    colors: [Color(hex: 0xEC4899), Color(hex: 0x8B5CF6), Color(hex: 0x3B82F6)],
                    startPoint: .bottomLeading,
                    endPoint: .topTrailing
                ))
            Text(verbatim: "NEON")
                .font(.system(size: size, weight: .heavy))
                .tracking(size * 0.04)
                .foregroundStyle(Color.neonInk)
        }
        .environment(\.layoutDirection, .leftToRight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "NEON"))
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Row cards

extension View {
    /// Sets a row on a white card of its own — the chat list's look — with a
    /// thin accent bar on the leading edge when `pinned`. `highlighted` (an
    /// unread row) brightens it a touch.
    func rowCard(pinned: Bool = false, highlighted: Bool = false, radius: CGFloat = NeonRadius.lg) -> some View {
        modifier(RowCardStyle(pinned: pinned, highlighted: highlighted, radius: radius))
    }
}

struct RowCardStyle: ViewModifier {
    var pinned: Bool
    var highlighted: Bool
    var radius: CGFloat

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(shape.fill(Color.white.opacity(highlighted ? 1 : 0.92)))
            .overlay(shape.strokeBorder(LinearGradient.neonGlassEdge, lineWidth: 1))
            .overlay(alignment: .leading) {
                if pinned {
                    Capsule()
                        .fill(LinearGradient.neonAccent)
                        .frame(width: 4)
                        .padding(.vertical, 18)
                        .offset(x: -1)
                        .transition(.opacity)
                }
            }
            .neonShadow(.low)
            .contentShape(shape)
            .neonContextShape(radius: radius)
    }
}

/// A list row on its own white card — a conversation, a client, a project:
/// a big leading picture, the title in bold with an optional mark after it,
/// a grey line under it; the time and a chevron on the trailing side, and
/// under them a red count or a muted bell. `pinned` adds the accent bar.
///
///     ListCardRow(chat.title, subtitle: chat.preview,
///                 leading: .avatar(url: chat.avatarURL, name: chat.title, online: chat.online),
///                 time: "9:16 PM", count: chat.unread, pinned: chat.pinned, muted: chat.muted)
struct ListCardRow<Leading: View>: View {
    let title: String
    var subtitle: String?
    var titleSymbol: String?
    var time: String?
    var count: Int
    var muted: Bool
    var pinned: Bool
    var badge: String?
    var badgeTone: BadgeTone
    var chevron: Bool
    let leading: Leading

    init(
        _ title: String,
        subtitle: String? = nil,
        titleSymbol: String? = nil,
        time: String? = nil,
        count: Int = 0,
        pinned: Bool = false,
        muted: Bool = false,
        badge: String? = nil,
        badgeTone: BadgeTone = .neutral,
        chevron: Bool = true,
        @ViewBuilder leading: () -> Leading
    ) {
        self.title = title
        self.subtitle = subtitle
        self.titleSymbol = titleSymbol
        self.time = time
        self.count = count
        self.muted = muted
        self.pinned = pinned
        self.badge = badge
        self.badgeTone = badgeTone
        self.chevron = chevron
        self.leading = leading()
    }

    var body: some View {
        let unread = count > 0
        HStack(spacing: 14) {
            leading
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    DirText(title, font: .system(.body, weight: .bold), fill: false, lineLimit: 1)
                        .layoutPriority(1)
                    if let titleSymbol {
                        Image(systemName: titleSymbol)
                            .font(.system(.footnote, weight: .semibold))
                            .foregroundStyle(Color.neonTextTertiary)
                    }
                    Spacer(minLength: 6)
                    if let time {
                        Text(time)
                            .font(.system(.footnote))
                            .foregroundStyle(Color.neonTextTertiary)
                            .lineLimit(1)
                            .fixedSize()
                    }
                    if chevron {
                        Image(systemName: "chevron.forward")
                            .font(.system(.caption, weight: .semibold))
                            .foregroundStyle(Color.neonTextFaint)
                    }
                }
                HStack(spacing: 8) {
                    if let subtitle {
                        DirText(
                            subtitle,
                            font: .system(.subheadline, weight: unread ? .medium : .regular),
                            color: unread ? Color.neonInk.opacity(0.8) : Color.neonTextSecondary,
                            fill: false,
                            lineLimit: 1
                        )
                    }
                    Spacer(minLength: 0)
                    if let badge {
                        BadgeView(text: badge, tone: badgeTone)
                    }
                    if muted {
                        Image(systemName: "bell.slash")
                            .font(.system(.footnote, weight: .semibold))
                            .foregroundStyle(Color.neonTextTertiary)
                            .accessibilityLabel(L("Muted"))
                    }
                    if unread {
                        CountBadge(count, tone: muted ? .neutral : .danger, size: 22)
                    }
                }
            }
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 14)
        .rowCard(pinned: pinned, highlighted: unread)
        .accessibilityElement(children: .combine)
        .accessibilityValue(pinned ? Text(L("Pinned")) : Text(""))
    }
}

extension ListCardRow where Leading == RowLeadingView {
    /// With a kit leading mark; avatars are drawn solid, as in the chat list.
    init(
        _ title: String,
        subtitle: String? = nil,
        leading: RowLeading = .plain,
        titleSymbol: String? = nil,
        time: String? = nil,
        count: Int = 0,
        pinned: Bool = false,
        muted: Bool = false,
        badge: String? = nil,
        badgeTone: BadgeTone = .neutral,
        chevron: Bool = true
    ) {
        self.init(
            title, subtitle: subtitle, titleSymbol: titleSymbol, time: time, count: count, pinned: pinned,
            muted: muted, badge: badge, badgeTone: badgeTone, chevron: chevron
        ) {
            RowLeadingView(leading: leading, size: 50, avatarStyle: .solid)
        }
    }
}

/// Rows grouped in one glass card with inset hairlines between them — the
/// kit's version of an inset grouped list, for use inside a scroll view.
struct CardList<Data: RandomAccessCollection, ID: Hashable, Row: View>: View {
    let data: Data
    let id: KeyPath<Data.Element, ID>
    var dividerInset: CGFloat
    let row: (Data.Element) -> Row

    init(_ data: Data, id: KeyPath<Data.Element, ID>, dividerInset: CGFloat = 64, @ViewBuilder row: @escaping (Data.Element) -> Row) {
        self.data = data
        self.id = id
        self.dividerInset = dividerInset
        self.row = row
    }

    var body: some View {
        let first = data.first.map { $0[keyPath: id] }
        VStack(spacing: 0) {
            ForEach(data, id: id) { element in
                if element[keyPath: id] != first {
                    NeonDivider().padding(.leading, dividerInset)
                }
                row(element)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous))
        .neonSurface(.glass, radius: NeonRadius.lg)
    }
}

extension CardList where Data.Element: Identifiable, ID == Data.Element.ID {
    init(_ data: Data, dividerInset: CGFloat = 64, @ViewBuilder row: @escaping (Data.Element) -> Row) {
        self.init(data, id: \.id, dividerInset: dividerInset, row: row)
    }
}

extension View {
    /// A row of a `List` drawn as the kit draws it: no system background or
    /// separator, the gutter as inset. Lists get swipe actions for free.
    func neonListRow(top: CGFloat = 5, bottom: CGFloat = 5, horizontal: CGFloat = NeonSpace.gutter) -> some View {
        listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: top, leading: horizontal, bottom: bottom, trailing: horizontal))
    }

    /// A `List` on the ambient page instead of grey grouped chrome.
    func neonListStyle() -> some View {
        listStyle(.plain)
            .scrollContentBackground(.hidden)
            .neonAmbientBackground()
    }
}

/// The three states of a read in one place: the placeholder while nothing has
/// arrived, the server's refusal with Retry, and the content — under the
/// Offline banner when it is a saved copy.
struct LoadStateView<Value, Content: View, Placeholder: View>: View {
    let value: Value?
    let error: String?
    var cachedAt: Date?
    let retry: () async -> Void
    let placeholder: Placeholder
    let content: (Value) -> Content

    init(
        value: Value?,
        error: String?,
        cachedAt: Date? = nil,
        retry: @escaping () async -> Void,
        @ViewBuilder placeholder: () -> Placeholder,
        @ViewBuilder content: @escaping (Value) -> Content
    ) {
        self.value = value
        self.error = error
        self.cachedAt = cachedAt
        self.retry = retry
        self.placeholder = placeholder()
        self.content = content
    }

    var body: some View {
        Group {
            if let value {
                VStack(alignment: .leading, spacing: NeonSpace.lg) {
                    if let cachedAt { OfflineBanner(savedAt: cachedAt) }
                    content(value)
                }
                .transition(.opacity)
            } else if let error {
                ErrorState(message: error, retry: retry)
                    .transition(.opacity)
            } else {
                placeholder
                    .transition(.opacity)
            }
        }
        .animation(NeonMotion.gentle, value: phase)
    }

    private var phase: Int {
        if value != nil { return 2 }
        return error == nil ? 0 : 1
    }
}

extension LoadStateView where Placeholder == SkeletonRows {
    init(
        value: Value?,
        error: String?,
        cachedAt: Date? = nil,
        retry: @escaping () async -> Void,
        @ViewBuilder content: @escaping (Value) -> Content
    ) {
        self.init(value: value, error: error, cachedAt: cachedAt, retry: retry, placeholder: { SkeletonRows(count: 5) }, content: content)
    }
}
