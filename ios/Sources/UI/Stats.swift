import SwiftUI

// MARK: - Figures

/// How a figure is written.
enum StatFormat {
    case integer
    case decimal(Int)
    /// The value is 0…100.
    case percent
    /// JOD, whole numbers, as the web writes prices.
    case money
    /// JOD with this many decimals (payroll uses 2).
    case moneyDecimals(Int)
    /// Minutes, written "2h 15m".
    case minutes
    case custom((Double) -> String)

    func string(_ value: Double) -> String {
        switch self {
        case .integer: return NeonFormat.number(value.rounded())
        case .decimal(let digits): return NeonFormat.number(value, decimals: digits)
        case .percent: return NeonFormat.percent(value)
        case .money: return NeonFormat.money(value)
        case .moneyDecimals(let digits): return NeonFormat.money(value, decimals: digits)
        case .minutes: return describeMinutes(value)
        case .custom(let format): return format(value)
        }
    }

    /// Shorter, for chart axes.
    func axis(_ value: Double) -> String {
        switch self {
        case .percent: return NeonFormat.percent(value)
        case .minutes: return describeMinutes(value)
        case .custom(let format): return format(value)
        default: return NeonFormat.compact(value)
        }
    }
}

/// A number that counts to its value instead of jumping there. Animate the
/// value (`withAnimation { value = … }`) and every frame is written out.
struct CountingText: View, Animatable {
    var value: Double
    var format: StatFormat

    var animatableData: Double {
        get { value }
        set { value = newValue }
    }

    var body: some View {
        Text(format.string(value))
            .monospacedDigit()
    }
}

/// A change under a figure: "↗ +2 this month" in green, "— No change" in grey.
struct StatTrend {
    let text: String
    var tone: BadgeTone = .success
    /// true ↑, false ↓, nil no arrow.
    var up: Bool?
    /// Grey words after the change: "this month", "vs last month".
    var detail: String? = nil

    static func rising(_ text: String, _ detail: String? = nil, tone: BadgeTone = .success) -> StatTrend {
        StatTrend(text: text, tone: tone, up: true, detail: detail)
    }

    static func falling(_ text: String, _ detail: String? = nil, tone: BadgeTone = .danger) -> StatTrend {
        StatTrend(text: text, tone: tone, up: false, detail: detail)
    }

    /// "— No change": nothing moved. A KPI card draws its bars pale for it.
    static func steady(_ text: String = L("No change"), _ detail: String? = nil) -> StatTrend {
        StatTrend(text: text, tone: .neutral, up: nil, detail: detail)
    }

    var isSteady: Bool { up == nil && tone == .neutral }
}

/// A trend as one run of text: the arrow and the change in the tone, then
/// the detail in grey. It wraps at a word, so a narrow KPI card keeps all of
/// it. The arrow points the reading way in Arabic.
struct TrendLabel: View {
    let trend: StatTrend
    var font: Font
    var lineLimit: Int

    @Environment(\.layoutDirection) private var direction

    init(_ trend: StatTrend, font: Font = .system(.footnote), lineLimit: Int = 1) {
        self.trend = trend
        self.font = font
        self.lineLimit = lineLimit
    }

    var body: some View {
        let steady = trend.tone == .neutral
        var line = Text(verbatim: "")
        if let up = trend.up {
            let arrow: String = switch (up, direction == .rightToLeft) {
            case (true, false): "arrow.up.right"
            case (true, true): "arrow.up.left"
            case (false, false): "arrow.down.right"
            case (false, true): "arrow.down.left"
            }
            line = Text(Image(systemName: arrow)).fontWeight(.bold).foregroundColor(trend.tone.color) + Text(verbatim: "\u{00A0}\u{00A0}")
        } else if steady {
            line = Text(Image(systemName: "minus")).fontWeight(.bold).foregroundColor(.neonTextTertiary) + Text(verbatim: "\u{00A0}\u{00A0}")
        }
        line = line + Text(trend.text.replacingOccurrences(of: " ", with: "\u{00A0}"))
            .fontWeight(steady ? .regular : .semibold)
            .foregroundColor(steady ? .neonTextSecondary : trend.tone.foreground)
        if let detail = trend.detail {
            line = line + Text(verbatim: " ") + Text(detail).foregroundColor(.neonTextSecondary)
        }
        return line
            .font(font)
            .lineLimit(lineLimit)
            .minimumScaleFactor(0.8)
            .fixedSize(horizontal: false, vertical: true)
    }
}

enum KPIDensity {
    /// Two to a row.
    case regular
    /// Four to a row, as on the mockup's Home.
    case compact
}

/// The dashboard's figure: a pastel icon tile (and an optional ⋮ menu), the
/// number counting up, what it counts, how it moved, and a few bars of its
/// recent history in the tile's colour.
///
///     KPICard(L("Total Projects"), value: 4, symbol: "folder.fill", hue: .blue,
///             trend: .rising("+2", L("this month")), bars: [2, 3, 5, 6, 6, 8])
///     KPICard(L("Pending Approvals"), value: 0, symbol: "clock.fill", hue: .orange,
///             trend: .steady(), bars: history) { Button(L("Open")) { … } }
struct KPICard<MenuContent: View>: View {
    let title: String
    let value: Double?
    let text: String?
    var format: StatFormat
    var symbol: String?
    var hue: NeonHue
    var caption: String?
    var trend: StatTrend?
    var bars: [Double]?
    var density: KPIDensity
    let menu: MenuContent

    @State private var shown: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(
        _ title: String,
        value: Double,
        format: StatFormat = .integer,
        symbol: String? = nil,
        hue: NeonHue = .blue,
        caption: String? = nil,
        trend: StatTrend? = nil,
        bars: [Double]? = nil,
        density: KPIDensity = .regular,
        @ViewBuilder menu: () -> MenuContent
    ) {
        self.title = title
        self.value = value
        self.text = nil
        self.format = format
        self.symbol = symbol
        self.hue = hue
        self.caption = caption
        self.trend = trend
        self.bars = bars
        self.density = density
        self.menu = menu()
    }

    /// A figure that isn't a single number: "3 / 5", "Sep 30".
    init(
        _ title: String,
        text: String,
        symbol: String? = nil,
        hue: NeonHue = .blue,
        caption: String? = nil,
        trend: StatTrend? = nil,
        bars: [Double]? = nil,
        density: KPIDensity = .regular,
        @ViewBuilder menu: () -> MenuContent
    ) {
        self.title = title
        self.value = nil
        self.text = text
        self.format = .integer
        self.symbol = symbol
        self.hue = hue
        self.caption = caption
        self.trend = trend
        self.bars = bars
        self.density = density
        self.menu = menu()
    }

    private var compact: Bool { density == .compact }
    private var hasMenu: Bool { MenuContent.self != EmptyView.self }
    private var radius: CGFloat { compact ? NeonRadius.md + 2 : NeonRadius.lg }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 4) {
                if let symbol {
                    IconTile(symbol, hue: hue, size: compact ? 32 : NeonSize.iconTileLarge)
                }
                Spacer(minLength: 0)
                if hasMenu {
                    Menu { menu } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 15, weight: .bold))
                            .rotationEffect(.degrees(90))
                            .foregroundStyle(Color.neonTextTertiary)
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                    .padding(.top, -4)
                    .padding(.trailing, -8)
                    .accessibilityLabel(L("More"))
                }
            }
            .padding(.bottom, compact ? 12 : 14)

            Group {
                if let text {
                    Text(text)
                } else {
                    CountingText(value: shown, format: format)
                }
            }
            .font(compact ? .system(.title, weight: .bold).monospacedDigit() : .neonKPI)
            .foregroundStyle(Color.neonInk)
            .lineLimit(1)
            .minimumScaleFactor(0.5)

            Text(title)
                .font(.system(compact ? .caption : .subheadline, weight: .medium))
                .foregroundStyle(Color.neonInk.opacity(0.74))
                .lineLimit(compact ? 3 : 2)
                .minimumScaleFactor(0.85)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)

            if let caption {
                Text(caption)
                    .font(.system(.caption))
                    .foregroundStyle(Color.neonTextTertiary)
                    .lineLimit(2)
                    .padding(.top, 2)
            }

            if let trend {
                TrendLabel(trend, font: .system(compact ? .caption2 : .footnote), lineLimit: compact ? 2 : 1)
                    .padding(.top, compact ? 8 : 10)
            }

            if let bars, !bars.isEmpty {
                Spacer(minLength: compact ? 12 : 16)
                MiniBars(
                    bars,
                    hue: hue,
                    muted: trend?.isSteady == true,
                    height: compact ? 28 : 36,
                    maxBarWidth: compact ? 9 : 13
                )
            }
        }
        .padding(compact ? 11 : NeonSpace.card)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .neonSurface(.glass, radius: radius)
        .neonContextShape(radius: radius)
        // Four to a row has no room to grow; `StatGrid` drops to two past this size.
        .dynamicTypeSize(...(compact ? DynamicTypeSize.xLarge : DynamicTypeSize.accessibility3))
        .onAppear { count(to: value ?? 0) }
        .onChange(of: value ?? 0) { count(to: $0) }
        .accessibilityElement(children: hasMenu ? .contain : .ignore)
        .accessibilityLabel(Text(title))
        .accessibilityValue(Text([text ?? format.string(value ?? 0), trend.map { [$0.text, $0.detail ?? ""].joined(separator: " ") } ?? ""].joined(separator: ", ")))
    }

    private func count(to target: Double) {
        if reduceMotion {
            shown = target
        } else {
            withAnimation(NeonMotion.fill) { shown = target }
        }
    }
}

extension KPICard where MenuContent == EmptyView {
    init(
        _ title: String,
        value: Double,
        format: StatFormat = .integer,
        symbol: String? = nil,
        hue: NeonHue = .blue,
        caption: String? = nil,
        trend: StatTrend? = nil,
        bars: [Double]? = nil,
        density: KPIDensity = .regular
    ) {
        self.init(title, value: value, format: format, symbol: symbol, hue: hue, caption: caption, trend: trend, bars: bars, density: density) { EmptyView() }
    }

    init(
        _ title: String,
        text: String,
        symbol: String? = nil,
        hue: NeonHue = .blue,
        caption: String? = nil,
        trend: StatTrend? = nil,
        bars: [Double]? = nil,
        density: KPIDensity = .regular
    ) {
        self.init(title, text: text, symbol: symbol, hue: hue, caption: caption, trend: trend, bars: bars, density: density) { EmptyView() }
    }
}

/// The older name for a KPI card with no menu or bars. It is drawn as a
/// `KPICard`, its `tint` read as a hue.
struct StatTile: View {
    let title: String
    let value: Double?
    let text: String?
    var format: StatFormat
    var symbol: String?
    var tint: Color
    var caption: String?
    var trend: StatTrend?

    init(
        _ title: String,
        value: Double,
        format: StatFormat = .integer,
        symbol: String? = nil,
        tint: Color = .neonPurpleStrong,
        caption: String? = nil,
        trend: StatTrend? = nil
    ) {
        self.title = title
        self.value = value
        self.text = nil
        self.format = format
        self.symbol = symbol
        self.tint = tint
        self.caption = caption
        self.trend = trend
    }

    /// A figure that isn't a single number: "3 / 5", "Sep 30".
    init(
        _ title: String,
        text: String,
        symbol: String? = nil,
        tint: Color = .neonPurpleStrong,
        caption: String? = nil,
        trend: StatTrend? = nil
    ) {
        self.title = title
        self.value = nil
        self.text = text
        self.format = .integer
        self.symbol = symbol
        self.tint = tint
        self.caption = caption
        self.trend = trend
    }

    var body: some View {
        let hue = NeonHue(tint) ?? .purple
        if let text {
            KPICard(title, text: text, symbol: symbol, hue: hue, caption: caption, trend: trend)
        } else {
            KPICard(title, value: value ?? 0, format: format, symbol: symbol, hue: hue, caption: caption, trend: trend)
        }
    }
}

/// Stat tiles two (or n) to a row, equal heights per row. Four to a row
/// wants `KPICard(…, density: .compact)`.
struct StatGrid<Content: View>: View {
    var columns: Int
    let content: Content

    @Environment(\.dynamicTypeSize) private var typeSize

    init(columns: Int = 2, @ViewBuilder content: () -> Content) {
        self.columns = columns
        self.content = content()
    }

    var body: some View {
        // Large text gets two to a row, however many were asked for.
        let count = typeSize > .xLarge ? min(columns, 2) : columns
        let gap = count > 2 ? NeonSpace.sm : NeonSpace.stack
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: gap, alignment: .top), count: max(1, count)),
            spacing: gap
        ) {
            content
        }
    }
}

// MARK: - Progress

/// A ring filling to `progress` (0…1), in the brand gradient or one colour.
/// The default label counts up the percentage in the middle.
struct ProgressRing<Label: View>: View {
    let progress: Double
    var size: CGFloat
    var lineWidth: CGFloat
    var tint: Color?
    let label: Label

    @State private var shown: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(progress: Double, size: CGFloat = 64, lineWidth: CGFloat = 8, tint: Color? = nil, @ViewBuilder label: () -> Label) {
        self.progress = progress
        self.size = size
        self.lineWidth = lineWidth
        self.tint = tint
        self.label = label()
    }

    var body: some View {
        let clamped = min(max(shown, 0), 1)
        ZStack {
            Circle()
                .stroke(Color.neonInk.opacity(0.07), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: clamped)
                .stroke(stroke(clamped), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            label
        }
        .frame(width: size, height: size)
        .padding(lineWidth / 2)
        .onAppear { fill(to: progress) }
        .onChange(of: progress) { fill(to: $0) }
        .accessibilityElement(children: .ignore)
        .accessibilityValue(Text(NeonFormat.percent(min(max(progress, 0), 1) * 100)))
    }

    private func stroke(_ amount: Double) -> AnyShapeStyle {
        if let tint { return AnyShapeStyle(tint) }
        return AnyShapeStyle(AngularGradient(
            colors: [.neonBlue, .neonIndigo, .neonPurple],
            center: .center,
            startAngle: .degrees(0),
            endAngle: .degrees(max(360 * amount, 1))
        ))
    }

    private func fill(to target: Double) {
        if reduceMotion {
            shown = target
        } else {
            withAnimation(NeonMotion.fill) { shown = target }
        }
    }
}

extension ProgressRing where Label == RingPercent {
    init(progress: Double, size: CGFloat = 64, lineWidth: CGFloat = 8, tint: Color? = nil) {
        self.init(progress: progress, size: size, lineWidth: lineWidth, tint: tint) {
            RingPercent(progress: progress, size: size)
        }
    }
}

/// The percentage in the middle of a `ProgressRing`, counting up.
struct RingPercent: View {
    let progress: Double
    let size: CGFloat
    @State private var shown: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        CountingText(value: shown, format: .percent)
            .font(.system(size: max(11, size * 0.24), weight: .bold))
            .foregroundStyle(Color.neonInk)
            .minimumScaleFactor(0.6)
            .lineLimit(1)
            .padding(.horizontal, size * 0.12)
            .onAppear { update(progress) }
            .onChange(of: progress) { update($0) }
    }

    private func update(_ value: Double) {
        let target = min(max(value, 0), 1) * 100
        if reduceMotion {
            shown = target
        } else {
            withAnimation(NeonMotion.fill) { shown = target }
        }
    }
}

/// A bar filling to `progress` (0…1). Fills from the leading edge, so it runs
/// right to left in Arabic.
struct ProgressBar: View {
    let progress: Double
    var tint: Color?
    var height: CGFloat

    @State private var shown: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(progress: Double, tint: Color? = nil, height: CGFloat = 8) {
        self.progress = progress
        self.tint = tint
        self.height = height
    }

    var body: some View {
        GeometryReader { proxy in
            let amount = min(max(shown, 0), 1)
            ZStack(alignment: .leading) {
                Capsule().fill(Color.neonInk.opacity(0.07))
                Capsule()
                    .fill(tint.map { AnyShapeStyle($0) } ?? AnyShapeStyle(LinearGradient(colors: [.neonBlue, .neonIndigo, .neonPurple], startPoint: .leading, endPoint: .trailing)))
                    .frame(width: max(height, proxy.size.width * amount))
                    .opacity(amount > 0.001 ? 1 : 0)
            }
        }
        .frame(height: height)
        .onAppear { fill(to: progress) }
        .onChange(of: progress) { fill(to: $0) }
        .accessibilityElement(children: .ignore)
        .accessibilityValue(Text(NeonFormat.percent(min(max(progress, 0), 1) * 100)))
    }

    private func fill(to target: Double) {
        if reduceMotion {
            shown = target
        } else {
            withAnimation(NeonMotion.fill) { shown = target }
        }
    }
}

// MARK: - Small charts

/// A handful of bars in a hue — a KPI's recent history — each a gradient from
/// light at the top to vivid at the bottom. `muted` draws them pale, for a
/// figure that didn't move. With `comparison` every value gets a lighter bar
/// beside it (last period), and `labels` go under the groups ("W1"…).
/// Bars run from the leading edge, so the newest is on the left in Arabic.
struct MiniBars: View {
    let values: [Double]
    var comparison: [Double]?
    var labels: [String]?
    var hue: NeonHue
    var muted: Bool
    var height: CGFloat
    var maxBarWidth: CGFloat?

    @State private var grown: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(
        _ values: [Double],
        comparison: [Double]? = nil,
        labels: [String]? = nil,
        hue: NeonHue = .blue,
        muted: Bool = false,
        height: CGFloat = 36,
        maxBarWidth: CGFloat? = 13
    ) {
        self.values = values
        self.comparison = comparison
        self.labels = labels
        self.hue = hue
        self.muted = muted
        self.height = height
        self.maxBarWidth = maxBarWidth
    }

    private var ceiling: Double {
        let top = (values + (comparison ?? [])).max() ?? 0
        return top > 0 ? top : 1
    }

    var body: some View {
        let paired = comparison != nil
        let gap = paired ? 14 : (maxBarWidth.map { $0 * 0.45 } ?? 5)
        VStack(spacing: 6) {
            HStack(alignment: .bottom, spacing: gap) {
                ForEach(values.indices, id: \.self) { index in
                    if let comparison {
                        HStack(alignment: .bottom, spacing: 3) {
                            bar(values[index], light: false)
                            bar(comparison.indices.contains(index) ? comparison[index] : 0, light: true)
                        }
                        .frame(maxWidth: .infinity)
                    } else {
                        bar(values[index], light: false)
                    }
                }
            }
            .frame(height: height, alignment: .bottom)
            .frame(maxWidth: .infinity, alignment: .leading)
            if let labels {
                HStack(spacing: gap) {
                    ForEach(labels.indices, id: \.self) { index in
                        Text(labels[index])
                            .font(.system(.caption2, weight: .medium))
                            .foregroundStyle(Color.neonTextTertiary)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
        }
        .onAppear(perform: grow)
        .onChange(of: values) { _ in grow() }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(values.map { NeonFormat.number($0) }.joined(separator: ", ")))
    }

    private func bar(_ value: Double, light: Bool) -> some View {
        let colors = light ? [hue.gradient[0].opacity(0.55), hue.color.opacity(0.55)] : [hue.gradient[0], hue.color]
        let amount = CGFloat(max(value, 0) / ceiling)
        return RoundedRectangle(cornerRadius: 3.5, style: .continuous)
            .fill(LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom))
            .opacity(muted ? 0.38 : 1)
            .frame(maxWidth: paired ? 16 : (maxBarWidth ?? .infinity))
            .frame(height: max(5, height * amount * grown))
    }

    private var paired: Bool { comparison != nil }

    private func grow() {
        if reduceMotion {
            grown = 1
        } else {
            grown = 0
            withAnimation(.spring(response: 0.7, dampingFraction: 0.86).delay(0.1)) { grown = 1 }
        }
    }
}

/// A small smoothed line in a hue, with a soft area under it and a dot on the
/// latest value. Runs from the leading edge, so it mirrors in Arabic.
struct Sparkline: View {
    let values: [Double]
    var hue: NeonHue
    var height: CGFloat
    var lineWidth: CGFloat
    var showsArea: Bool
    var showsEndDot: Bool

    @State private var drawn: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(_ values: [Double], hue: NeonHue = .blue, height: CGFloat = 40, lineWidth: CGFloat = 2.4, showsArea: Bool = true, showsEndDot: Bool = true) {
        self.values = values
        self.hue = hue
        self.height = height
        self.lineWidth = lineWidth
        self.showsArea = showsArea
        self.showsEndDot = showsEndDot
    }

    var body: some View {
        GeometryReader { proxy in
            let points = plot(in: proxy.size)
            ZStack {
                if showsArea {
                    SparkPath(points: points, closed: true)
                        .fill(LinearGradient(colors: [hue.color.opacity(0.26), hue.color.opacity(0)], startPoint: .top, endPoint: .bottom))
                        .opacity(Double(drawn))
                }
                SparkPath(points: points, closed: false)
                    .trim(from: 0, to: drawn)
                    .stroke(hue.color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
                if showsEndDot, let last = points.last {
                    Circle()
                        .fill(Color.white)
                        .frame(width: lineWidth * 3.4, height: lineWidth * 3.4)
                        .overlay(Circle().strokeBorder(hue.color, lineWidth: lineWidth))
                        .position(last)
                        .opacity(drawn > 0.95 ? 1 : 0)
                }
            }
        }
        .frame(height: height)
        .flipsForRightToLeftLayoutDirection(true)
        .onAppear {
            if reduceMotion {
                drawn = 1
            } else {
                drawn = 0
                withAnimation(.easeOut(duration: 0.9).delay(0.1)) { drawn = 1 }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(values.map { NeonFormat.number($0) }.joined(separator: ", ")))
    }

    private func plot(in size: CGSize) -> [CGPoint] {
        guard values.count > 1 else { return [] }
        let low = values.min() ?? 0, high = values.max() ?? 0
        let span = high - low > 0 ? high - low : 1
        let inset = lineWidth * 2
        let width = size.width - inset * 2, usable = size.height - inset * 2
        return values.enumerated().map { index, value in
            CGPoint(
                x: inset + width * CGFloat(index) / CGFloat(values.count - 1),
                y: inset + usable * (1 - CGFloat((value - low) / span))
            )
        }
    }
}

/// A curve through the points, smoothed with midpoint quadratics; `closed`
/// runs it down to the bottom edge for an area fill.
struct SparkPath: Shape {
    let points: [CGPoint]
    var closed: Bool

    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard let first = points.first, points.count > 1 else { return path }
        path.move(to: first)
        for index in 1..<points.count {
            let previous = points[index - 1], point = points[index]
            let mid = CGPoint(x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2)
            path.addQuadCurve(to: mid, control: CGPoint(x: (previous.x + mid.x) / 2, y: previous.y))
            path.addQuadCurve(to: point, control: CGPoint(x: (mid.x + point.x) / 2, y: point.y))
        }
        if closed, let last = points.last {
            path.addLine(to: CGPoint(x: last.x, y: rect.maxY))
            path.addLine(to: CGPoint(x: first.x, y: rect.maxY))
            path.closeSubpath()
        }
        return path
    }
}

// MARK: - Segmented progress

/// One part of a whole: "Planning 2", in a hue.
struct ProgressSegment: Identifiable, Equatable {
    let id: String
    let label: String
    let value: Double
    var hue: NeonHue

    /// `id` defaults to the label.
    init(_ label: String, value: Double, hue: NeonHue, id: String? = nil) {
        self.id = id ?? label
        self.label = label
        self.value = value
        self.hue = hue
    }

    /// The segment's band, leading to trailing; grey stays a quiet grey.
    fileprivate var band: [Color] { hue == .grey ? hue.gradient : [hue.color, hue.deep.opacity(0.88)] }
    fileprivate var dot: Color { hue == .grey ? hue.gradient[1] : hue.color }
}

/// A bar split into coloured parts by share — where every project stands.
/// Empty parts are left out; with nothing at all it is a grey track.
struct SegmentedProgressBar: View {
    let segments: [ProgressSegment]
    var height: CGFloat
    var gap: CGFloat

    @State private var grown: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(_ segments: [ProgressSegment], height: CGFloat = 10, gap: CGFloat = 3) {
        self.segments = segments
        self.height = height
        self.gap = gap
    }

    var body: some View {
        let shown = segments.filter { $0.value > 0 }
        let total = shown.map(\.value).reduce(0, +)
        GeometryReader { proxy in
            let room = proxy.size.width - gap * CGFloat(max(shown.count - 1, 0))
            ZStack(alignment: .leading) {
                Capsule().fill(NeonHue.grey.wash)
                HStack(spacing: gap) {
                    ForEach(shown) { segment in
                        Capsule()
                            .fill(LinearGradient(colors: segment.band, startPoint: .leading, endPoint: .trailing))
                            .frame(width: max(height, room * CGFloat(segment.value / max(total, 1))))
                    }
                }
                .frame(width: proxy.size.width, alignment: .leading)
                .mask(alignment: .leading) {
                    Rectangle().frame(width: proxy.size.width * grown)
                }
            }
        }
        .frame(height: height)
        .onAppear(perform: grow)
        .onChange(of: segments) { _ in grow() }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(segments.map { "\($0.label) \(NeonFormat.number($0.value))" }.joined(separator: ", ")))
    }

    private func grow() {
        if reduceMotion {
            grown = 1
        } else {
            grown = 0
            withAnimation(.easeInOut(duration: 0.8).delay(0.1)) { grown = 1 }
        }
    }
}

/// The key under a segmented bar: a dot, the figure in bold, the label under it.
struct ProgressLegend: View {
    let segments: [ProgressSegment]
    var format: StatFormat

    init(_ segments: [ProgressSegment], format: StatFormat = .integer) {
        self.segments = segments
        self.format = format
    }

    var body: some View {
        HStack(alignment: .top, spacing: NeonSpace.xs) {
            ForEach(segments) { segment in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(segment.dot)
                            .frame(width: 8, height: 8)
                        Text(format.string(segment.value))
                            .font(.system(.headline, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(Color.neonInk)
                    }
                    Text(segment.label)
                        .font(.neonSubtitle)
                        .foregroundStyle(Color.neonTextSecondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .padding(.leading, 14)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
            }
        }
    }
}

/// A segmented bar with its legend under it.
///
///     SegmentedProgress([
///         ProgressSegment(L("Planning"), value: 2, hue: .green),
///         ProgressSegment(L("Active"), value: 1, hue: .blue),
///         ProgressSegment(L("On Hold"), value: 0, hue: .purple),
///         ProgressSegment(L("Completed"), value: 1, hue: .grey),
///     ])
struct SegmentedProgress: View {
    let segments: [ProgressSegment]
    var format: StatFormat
    var showsLegend: Bool

    init(_ segments: [ProgressSegment], format: StatFormat = .integer, showsLegend: Bool = true) {
        self.segments = segments
        self.format = format
        self.showsLegend = showsLegend
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SegmentedProgressBar(segments)
            if showsLegend {
                ProgressLegend(segments, format: format)
            }
        }
    }
}
