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

/// A change beside a figure: "+12%" up in green, "3 late" in pink.
struct StatTrend {
    let text: String
    var tone: BadgeTone = .success
    /// true ↑, false ↓, nil no arrow.
    var up: Bool?
}

/// A figure on a glass tile, counting up when it appears: the dashboard's unit.
struct StatTile: View {
    let title: String
    let value: Double?
    let text: String?
    var format: StatFormat
    var symbol: String?
    var tint: Color
    var caption: String?
    var trend: StatTrend?

    @State private var shown: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                if let symbol {
                    IconTile(symbol, tint: tint, size: 34)
                }
                Spacer(minLength: 4)
                if let trend {
                    HStack(spacing: 3) {
                        if let up = trend.up {
                            Image(systemName: up ? "arrow.up.right" : "arrow.down.right")
                                .font(.system(size: 9, weight: .heavy))
                        }
                        Text(trend.text).lineLimit(1)
                    }
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(trend.tone.foreground)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .background(trend.tone.background, in: Capsule())
                }
            }
            Group {
                if let text {
                    Text(text)
                } else {
                    CountingText(value: shown, format: format)
                }
            }
            .font(.system(size: 26, weight: .bold, design: .rounded))
            .foregroundStyle(Color.neonInk)
            .lineLimit(1)
            .minimumScaleFactor(0.55)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.neonTextSecondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                if let caption {
                    Text(caption)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.neonTextTertiary)
                        .lineLimit(2)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 128, maxHeight: .infinity, alignment: .topLeading)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .neonContextShape()
        .onAppear { count(to: value ?? 0) }
        .onChange(of: value ?? 0) { count(to: $0) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(title))
        .accessibilityValue(Text(text ?? format.string(value ?? 0)))
    }

    private func count(to target: Double) {
        if reduceMotion {
            shown = target
        } else {
            withAnimation(NeonMotion.fill) { shown = target }
        }
    }
}

/// Stat tiles two (or n) to a row.
struct StatGrid<Content: View>: View {
    var columns: Int
    let content: Content

    init(columns: Int = 2, @ViewBuilder content: () -> Content) {
        self.columns = columns
        self.content = content()
    }

    var body: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: NeonSpace.md, alignment: .top), count: max(1, columns)),
            spacing: NeonSpace.md
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
            colors: [.neonCyan, .neonPurple, .neonPink],
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
            .font(.system(size: max(11, size * 0.24), weight: .bold, design: .rounded))
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
                    .fill(tint.map { AnyShapeStyle($0) } ?? AnyShapeStyle(LinearGradient.neonWordmark))
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
