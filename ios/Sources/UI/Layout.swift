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
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(tone.foreground)
                .frame(width: 32, height: 32)
                .background(Circle().fill(Color.white.opacity(0.7)))
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.neonInk)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail {
                    Text(detail)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.neonTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.top, 5)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(tone.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(tone.foreground.opacity(0.14), lineWidth: 1)
        )
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
