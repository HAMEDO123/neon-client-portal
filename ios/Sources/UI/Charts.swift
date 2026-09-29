import Charts
import SwiftUI

// Swift Charts, dressed in the brand: gradient bars, soft gridlines, values
// on the marks, and every chart growing into place when it appears.

/// One value: a bar, a point, a slice.
struct ChartPoint: Identifiable, Equatable {
    let id: String
    let label: String
    let value: Double
    var tint: Color?

    /// `id` defaults to the label; give one when labels repeat (two "Sun"s).
    init(_ label: String, _ value: Double, id: String? = nil, tint: Color? = nil) {
        self.id = id ?? label
        self.label = label
        self.value = value
        self.tint = tint
    }
}

/// One line on a line chart.
struct ChartSeries: Identifiable {
    let id: String
    let name: String
    let points: [ChartPoint]
    var color: Color

    init(_ name: String, points: [ChartPoint], color: Color = .neonPurple, id: String? = nil) {
        self.id = id ?? name
        self.name = name
        self.points = points
        self.color = color
    }
}

// MARK: - Bars

/// Vertical bars, one per point, with the value above each and an optional
/// dashed target line. For many bars, labels thin out so they stay readable.
struct NeonBarChart: View {
    let points: [ChartPoint]
    var tint: Color
    var height: CGFloat
    var format: StatFormat
    var target: Double?
    var targetLabel: String?
    var showsValues: Bool

    @State private var grown: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(
        _ points: [ChartPoint],
        tint: Color = .neonPurple,
        height: CGFloat = 200,
        format: StatFormat = .integer,
        target: Double? = nil,
        targetLabel: String? = nil,
        showsValues: Bool = true
    ) {
        self.points = points
        self.tint = tint
        self.height = height
        self.format = format
        self.target = target
        self.targetLabel = targetLabel
        self.showsValues = showsValues
    }

    private var ceiling: Double {
        let top = max(points.map(\.value).max() ?? 0, target ?? 0)
        return top <= 0 ? 1 : top * 1.18
    }

    private var labelStride: Int { max(1, Int((Double(points.count) / 7).rounded(.up))) }

    var body: some View {
        if points.isEmpty {
            ChartEmpty(height: height)
        } else {
            Chart {
                ForEach(points) { point in
                    let color = point.tint ?? tint
                    BarMark(
                        x: .value("Label", point.id),
                        y: .value("Value", point.value * grown),
                        width: .ratio(0.62)
                    )
                    .foregroundStyle(LinearGradient(colors: [color.opacity(0.6), color], startPoint: .top, endPoint: .bottom))
                    .cornerRadius(6)
                    .annotation(position: .top, alignment: .center, spacing: 4) {
                        if showsValues && points.count <= 12 {
                            Text(format.axis(point.value))
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(Color.neonTextSecondary)
                                .opacity(grown > 0.95 ? 1 : 0)
                        }
                    }
                    .accessibilityLabel(Text(point.label))
                    .accessibilityValue(Text(format.string(point.value)))
                }
                if let target {
                    RuleMark(y: .value("Target", target))
                        .lineStyle(StrokeStyle(lineWidth: 1.2, dash: [4, 4]))
                        .foregroundStyle(Color.neonPinkStrong.opacity(0.75))
                        .annotation(position: .overlay, alignment: .leading) {
                            Text(targetLabel ?? format.axis(target))
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(Color.neonPinkStrong)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Capsule().fill(Color.white))
                                .overlay(Capsule().strokeBorder(Color.neonPink.opacity(0.35), lineWidth: 1))
                        }
                }
            }
            .chartYScale(domain: 0...ceiling)
            .chartXAxis {
                AxisMarks { value in
                    AxisValueLabel {
                        if let id = value.as(String.self) {
                            Text(label(for: id))
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(Color.neonTextTertiary)
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0.6, dash: [3, 4]))
                        .foregroundStyle(Color.neonInk.opacity(0.08))
                    AxisValueLabel {
                        if !showsValues, let number = value.as(Double.self) {
                            Text(format.axis(number))
                                .font(.system(size: 10))
                                .foregroundStyle(Color.neonTextTertiary)
                        }
                    }
                }
            }
            .frame(height: height)
            .onAppear { grow() }
            .onChange(of: points) { _ in grow() }
        }
    }

    private func label(for id: String) -> String {
        guard let index = points.firstIndex(where: { $0.id == id }) else { return "" }
        return index % labelStride == 0 ? points[index].label : ""
    }

    private func grow() {
        if reduceMotion {
            grown = 1
        } else {
            grown = 0
            withAnimation(.spring(response: 0.75, dampingFraction: 0.86).delay(0.08)) { grown = 1 }
        }
    }
}

// MARK: - Lines

/// One or several lines over the same labels, smoothed, with a gradient area
/// under a single line and a dot on its last value.
struct NeonLineChart: View {
    let series: [ChartSeries]
    var height: CGFloat
    var format: StatFormat
    var showsArea: Bool

    @State private var grown: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(series: [ChartSeries], height: CGFloat = 200, format: StatFormat = .integer, showsArea: Bool = true) {
        self.series = series
        self.height = height
        self.format = format
        self.showsArea = showsArea
    }

    init(_ points: [ChartPoint], name: String = "", color: Color = .neonPurple, height: CGFloat = 200, format: StatFormat = .integer, showsArea: Bool = true) {
        self.init(series: [ChartSeries(name, points: points, color: color)], height: height, format: format, showsArea: showsArea)
    }

    private var labels: [String] { series.first?.points.map(\.label) ?? [] }
    private var count: Int { series.map(\.points.count).max() ?? 0 }

    private var ceiling: Double {
        let top = series.flatMap(\.points).map(\.value).max() ?? 0
        return top <= 0 ? 1 : top * 1.15
    }

    private var tickIndices: [Int] {
        guard count > 0 else { return [] }
        let step = max(1, Int((Double(count) / 5).rounded(.up)))
        return Array(stride(from: 0, to: count, by: step))
    }

    var body: some View {
        if count < 2 {
            ChartEmpty(height: height)
        } else {
            Chart {
                ForEach(series) { line in
                    ForEach(Array(line.points.enumerated()), id: \.element.id) { index, point in
                        LineMark(
                            x: .value("Index", index),
                            y: .value("Value", point.value * grown),
                            series: .value("Series", line.id)
                        )
                        .foregroundStyle(line.color)
                        .lineStyle(StrokeStyle(lineWidth: 2.6, lineCap: .round, lineJoin: .round))
                        .interpolationMethod(.catmullRom)

                        if showsArea && series.count == 1 {
                            AreaMark(
                                x: .value("Index", index),
                                y: .value("Value", point.value * grown)
                            )
                            .foregroundStyle(LinearGradient(colors: [line.color.opacity(0.26), line.color.opacity(0.01)], startPoint: .top, endPoint: .bottom))
                            .interpolationMethod(.catmullRom)
                        }
                    }
                    if let last = line.points.last {
                        PointMark(
                            x: .value("Index", line.points.count - 1),
                            y: .value("Value", last.value * grown)
                        )
                        .symbolSize(70)
                        .foregroundStyle(line.color)
                        .annotation(position: .top, spacing: 6) {
                            Text(format.axis(last.value))
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(line.color)
                                .opacity(grown > 0.95 ? 1 : 0)
                        }
                    }
                }
            }
            .chartXScale(domain: 0...(count - 1))
            .chartYScale(domain: 0...ceiling)
            .chartXAxis {
                AxisMarks(values: tickIndices) { value in
                    AxisValueLabel {
                        if let index = value.as(Int.self), labels.indices.contains(index) {
                            Text(labels[index])
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(Color.neonTextTertiary)
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0.6, dash: [3, 4]))
                        .foregroundStyle(Color.neonInk.opacity(0.08))
                    AxisValueLabel {
                        if let number = value.as(Double.self) {
                            Text(format.axis(number))
                                .font(.system(size: 10))
                                .foregroundStyle(Color.neonTextTertiary)
                        }
                    }
                }
            }
            .chartLegend(series.count > 1 ? .visible : .hidden)
            .frame(height: height)
            .onAppear { grow() }
        }
    }

    private func grow() {
        if reduceMotion {
            grown = 1
        } else {
            grown = 0
            withAnimation(.spring(response: 0.9, dampingFraction: 0.9).delay(0.08)) { grown = 1 }
        }
    }
}

// MARK: - Donut

/// Shares of a whole as a ring that sweeps in, with the total (or any
/// figure) in the middle and a legend beside it. Drawn natively rather than
/// with `SectorMark`, which needs iOS 17.
struct NeonDonutChart: View {
    let slices: [ChartPoint]
    var size: CGFloat
    var lineWidth: CGFloat
    var centerValue: String?
    var centerTitle: String?
    var format: StatFormat
    var showsLegend: Bool

    @State private var swept: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(
        _ slices: [ChartPoint],
        size: CGFloat = 150,
        lineWidth: CGFloat = 22,
        centerValue: String? = nil,
        centerTitle: String? = nil,
        format: StatFormat = .integer,
        showsLegend: Bool = true
    ) {
        self.slices = slices
        self.size = size
        self.lineWidth = lineWidth
        self.centerValue = centerValue
        self.centerTitle = centerTitle
        self.format = format
        self.showsLegend = showsLegend
    }

    private var total: Double { slices.map { max($0.value, 0) }.reduce(0, +) }

    private func color(_ index: Int) -> Color { slices[index].tint ?? NeonPalette.color(at: index) }

    /// Each slice's start and end as fractions of the ring.
    private var segments: [(start: Double, end: Double)] {
        guard total > 0 else { return [] }
        var start = 0.0
        return slices.map { slice in
            let end = start + max(slice.value, 0) / total
            defer { start = end }
            return (start, end)
        }
    }

    var body: some View {
        HStack(alignment: .center, spacing: 20) {
            ring
            if showsLegend && !slices.isEmpty {
                VStack(alignment: .leading, spacing: 9) {
                    ForEach(Array(slices.enumerated()), id: \.element.id) { index, slice in
                        HStack(spacing: 8) {
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(color(index))
                                .frame(width: 10, height: 10)
                            DirText(slice.label, font: .system(size: 13, weight: .medium), color: .neonTextSecondary, fill: false, lineLimit: 1)
                            Spacer(minLength: 6)
                            Text(format.string(slice.value))
                                .font(.system(size: 13, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(Color.neonInk)
                            if total > 0 {
                                Text(NeonFormat.percent(max(slice.value, 0) / total * 100))
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(Color.neonTextTertiary)
                                    .frame(minWidth: 34, alignment: .trailing)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .onAppear { sweep() }
        .onChange(of: slices) { _ in sweep() }
    }

    private var ring: some View {
        let gap = slices.count > 1 ? 0.006 : 0
        return ZStack {
            Circle()
                .stroke(Color.neonInk.opacity(0.06), lineWidth: lineWidth)
            ForEach(Array(segments.enumerated()), id: \.offset) { index, segment in
                let from = segment.start * swept
                let to = max(from, (segment.end - gap) * swept)
                Circle()
                    .trim(from: from, to: to)
                    .stroke(color(index), style: StrokeStyle(lineWidth: lineWidth, lineCap: .butt))
                    .rotationEffect(.degrees(-90))
            }
            VStack(spacing: 1) {
                Text(centerValue ?? format.string(total))
                    .font(.system(size: size * 0.17, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(Color.neonInk)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                Text(centerTitle ?? L("Total"))
                    .font(.system(size: max(10, size * 0.075), weight: .medium))
                    .foregroundStyle(Color.neonTextTertiary)
                    .lineLimit(1)
            }
            .padding(lineWidth + 6)
        }
        .frame(width: size, height: size)
        .padding(lineWidth / 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(slices.map { "\($0.label) \(format.string($0.value))" }.joined(separator: ", ")))
    }

    private func sweep() {
        if reduceMotion {
            swept = 1
        } else {
            swept = 0
            withAnimation(.easeInOut(duration: 0.9).delay(0.1)) { swept = 1 }
        }
    }
}

// MARK: - Around charts

/// A chart's card: title, an optional headline figure and line under it,
/// and the chart.
struct ChartCard<Content: View>: View {
    let title: String
    var subtitle: String?
    var value: String?
    let content: Content

    init(_ title: String, subtitle: String? = nil, value: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.value = value
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.neonCardTitle)
                        .foregroundStyle(Color.neonInk)
                    if let subtitle {
                        Text(subtitle)
                            .font(.neonSubtitle)
                            .foregroundStyle(Color.neonTextSecondary)
                    }
                }
                Spacer(minLength: 8)
                if let value {
                    Text(value)
                        .font(.neonTitle2)
                        .monospacedDigit()
                        .foregroundStyle(Color.neonInk)
                }
            }
            content
        }
        .padding(NeonSpace.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .neonSurface(.glass, radius: NeonRadius.lg)
    }
}

private struct ChartEmpty: View {
    let height: CGFloat

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "chart.bar.xaxis")
                .font(.system(size: 22))
                .foregroundStyle(Color.neonPurpleStrong.opacity(0.35))
            Text(L("No data yet"))
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.neonTextTertiary)
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
    }
}
