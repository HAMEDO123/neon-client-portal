import SwiftUI

// Fullscreen viewer: swipe between images, pinch to zoom, double-tap to
// toggle zoom, drag to pan while zoomed, tap to hide the chrome. Shared with
// Chat, which passes photos only; the gallery adds before/after pairs,
// hotspots, a strip of thumbnails and actions on the photo shown.
struct ImageViewerItem: Identifiable {
    let id: String
    let url: URL?
    let caption: String?
    /// The "before" half of a before/after pair.
    var beforeURL: URL? = nil
    var hotspots: [ImageViewerHotspot] = []
}

/// A hotspot on a photo, at a fraction (0…1) of its width and height.
struct ImageViewerHotspot: Identifiable {
    let id: String
    let x: Double
    let y: Double
    let label: String
    var category: String? = nil
}

/// Something to do with the photo on screen. The viewer closes first and the
/// presenter acts once it has gone.
struct ImageViewerAction: Identifiable {
    let id: String
    let title: String
    let symbol: String
    var isDestructive = false
    let perform: (ImageViewerItem) -> Void
}

struct ImageViewerPayload: Identifiable {
    let id = UUID()
    let items: [ImageViewerItem]
    let startIndex: Int
    var title: String? = nil
    var actions: [ImageViewerAction] = []
}

struct ImageViewerView: View {
    let payload: ImageViewerPayload

    @Environment(\.dismiss) private var dismiss
    @State private var index: Int
    @State private var chromeHidden = false
    @State private var showBefore = false
    @State private var showHotspots = true

    init(payload: ImageViewerPayload) {
        self.payload = payload
        _index = State(initialValue: min(max(payload.startIndex, 0), max(payload.items.count - 1, 0)))
    }

    private var current: ImageViewerItem? { payload.items[safe: index] }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            TabView(selection: $index) {
                ForEach(Array(payload.items.enumerated()), id: \.element.id) { i, item in
                    ZoomableImageView(
                        url: i == index && showBefore ? (item.beforeURL ?? item.url) : item.url,
                        hotspots: i == index && showBefore ? [] : (showHotspots ? item.hotspots : []),
                        onTap: {
                            withNeonAnimation(NeonMotion.quick) { chromeHidden.toggle() }
                        }
                    )
                    .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()

            if !chromeHidden {
                chrome
                    .transition(.opacity)
            }
        }
        .statusBarHidden(chromeHidden)
        // The app is light; on this black page the status bar's glyphs must
        // be white. Applies to the viewer's own presentation only.
        .preferredColorScheme(.dark)
        .onChange(of: index) { _ in
            showBefore = false
            Haptic.selection()
        }
        .animation(NeonMotion.resolved(NeonMotion.quick), value: index)
    }

    // MARK: - Chrome

    private var chrome: some View {
        VStack(spacing: 0) {
            topBar
            Spacer(minLength: 0)
            bottomBar
        }
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            IconButton("xmark", label: L("Close"), tint: .white, size: 40) {
                dismiss()
            }
            VStack(alignment: .leading, spacing: 1) {
                if let title = payload.title, !title.isEmpty {
                    DirText(title, font: .system(.subheadline, weight: .semibold), color: .white, fill: false, lineLimit: 1)
                }
                if payload.items.count > 1 {
                    Text(L("%d of %d", index + 1, payload.items.count))
                        .font(.system(.caption, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(.white.opacity(0.7))
                }
            }
            Spacer(minLength: 8)
            if let current, !current.hotspots.isEmpty, !showBefore {
                IconButton(
                    showHotspots ? "mappin.circle.fill" : "mappin.slash.circle",
                    label: showHotspots ? L("Hide hotspots") : L("Show hotspots"),
                    tint: .white,
                    size: 40
                ) {
                    withNeonAnimation(NeonMotion.snappy) { showHotspots.toggle() }
                }
            }
        }
        .padding(.horizontal, NeonSpace.gutter)
        .padding(.top, 8)
    }

    private var bottomBar: some View {
        VStack(spacing: 12) {
            if let current, current.beforeURL != nil {
                ViewerBeforeAfterSwitch(showBefore: $showBefore)
            }

            if let caption = current?.caption, !caption.isEmpty {
                DirText(caption, font: .system(.footnote, weight: .medium), color: .white.opacity(0.9), lineLimit: 3)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 20)
                    .id(current?.id)
                    .transition(.opacity)
            }

            if payload.items.count > 1 {
                thumbnails
            }

            if !payload.actions.isEmpty, let current {
                HStack(spacing: NeonSpace.sm) {
                    ForEach(payload.actions) { action in
                        Button {
                            Haptic.tap()
                            action.perform(current)
                            dismiss()
                        } label: {
                            VStack(spacing: 5) {
                                Image(systemName: action.symbol)
                                    .font(.system(.body, weight: .semibold))
                                Text(action.title)
                                    .font(.system(.caption2, weight: .semibold))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.8)
                            }
                            .foregroundStyle(action.isDestructive ? Color.neonDanger : Color.white)
                            .frame(maxWidth: .infinity, minHeight: 52)
                            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))
                            .environment(\.colorScheme, .dark)
                            .contentShape(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))
                        }
                        .buttonStyle(.pressable)
                    }
                }
                .padding(.horizontal, NeonSpace.gutter)
                .dynamicTypeSize(...DynamicTypeSize.xxLarge)
            }
        }
        .padding(.bottom, 10)
        .padding(.top, 24)
        .background(
            LinearGradient(colors: [.black.opacity(0), .black.opacity(0.6)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
                .allowsHitTesting(false)
        )
    }

    private var thumbnails: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(payload.items.enumerated()), id: \.element.id) { i, item in
                        Button {
                            withNeonAnimation(NeonMotion.snappy) { index = i }
                        } label: {
                            RemoteImage(url: item.url, contentMode: .fill)
                                .frame(width: i == index ? 52 : 42, height: 52)
                                .clipShape(RoundedRectangle(cornerRadius: NeonRadius.xs, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: NeonRadius.xs, style: .continuous)
                                        .strokeBorder(Color.white, lineWidth: i == index ? 2 : 0)
                                )
                                .opacity(i == index ? 1 : 0.55)
                        }
                        .buttonStyle(.pressable)
                        .id(i)
                        .accessibilityLabel(Text(L("%d of %d", i + 1, payload.items.count)))
                    }
                }
                .padding(.horizontal, NeonSpace.gutter)
            }
            .onAppear { proxy.scrollTo(index, anchor: .center) }
            .onChange(of: index) { newValue in
                withNeonAnimation(NeonMotion.smooth) { proxy.scrollTo(newValue, anchor: .center) }
            }
        }
        .frame(height: 56)
    }
}

/// "Before | After" on the dark viewer: a frosted capsule with a sliding pill.
private struct ViewerBeforeAfterSwitch: View {
    @Binding var showBefore: Bool
    @Namespace private var namespace

    var body: some View {
        HStack(spacing: 2) {
            option(L("Before"), isOn: showBefore) { showBefore = true }
            option(L("After"), isOn: !showBefore) { showBefore = false }
        }
        .padding(3)
        .background(.ultraThinMaterial, in: Capsule())
        .environment(\.colorScheme, .dark)
    }

    private func option(_ title: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button {
            guard !isOn else { return }
            Haptic.selection()
            withNeonAnimation(NeonMotion.snappy) { action() }
        } label: {
            Text(title)
                .font(.system(.footnote, weight: .semibold))
                .foregroundStyle(isOn ? Color.neonInk : Color.white.opacity(0.85))
                .padding(.horizontal, 18)
                .frame(minHeight: 34)
                .background {
                    if isOn {
                        Capsule().fill(Color.white)
                            .matchedGeometryEffect(id: "pill", in: namespace)
                    }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

private struct ZoomableImageView: View {
    let url: URL?
    var hotspots: [ImageViewerHotspot] = []
    var onTap: () -> Void = {}

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geo in
            Group {
                if let url {
                    ZoomSource(url: url, hotspots: hotspots)
                } else {
                    Image(systemName: "photo")
                        .font(.system(size: 28))
                        .foregroundStyle(.white.opacity(0.5))
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .scaleEffect(scale)
            .offset(offset)
            .gesture(magnification.simultaneously(with: scale > 1 ? panning : nil))
            .onTapGesture(count: 2) {
                withNeonAnimation(NeonMotion.smooth) {
                    if scale > 1 {
                        reset()
                    } else {
                        scale = 2.5
                        lastScale = 2.5
                    }
                }
            }
            .onTapGesture(count: 1) { onTap() }
        }
        .onChange(of: url) { _ in reset() }
    }

    private var magnification: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                scale = max(1, min(5, lastScale * value))
            }
            .onEnded { _ in
                lastScale = scale
                if scale <= 1.02 {
                    withNeonAnimation(NeonMotion.smooth) { reset() }
                }
            }
    }

    private var panning: some Gesture {
        DragGesture()
            .onChanged { value in
                offset = CGSize(
                    width: lastOffset.width + value.translation.width,
                    height: lastOffset.height + value.translation.height
                )
            }
            .onEnded { _ in
                lastOffset = offset
            }
    }

    private func reset() {
        scale = 1
        lastScale = 1
        offset = .zero
        lastOffset = .zero
    }
}

/// The full-screen picture: the largest size the server keeps (1600 wide),
/// which stays sharp when zoomed on a phone without decoding the original.
/// Hotspots are laid on the fitted picture itself, so they zoom with it.
private struct ZoomSource: View {
    let url: URL
    var hotspots: [ImageViewerHotspot] = []
    @State private var image: UIImage?
    @State private var failed = false

    /// The largest smaller copy already in memory (the gallery's tiles, the
    /// strip's thumbnails), to show at once.
    private var smallerCopy: UIImage? {
        for width in ImagePipeline.widths.reversed() where width < 1600 {
            if let copy = ImagePipeline.shared.cached(url, pixels: CGFloat(width)) { return copy }
        }
        return nil
    }

    var body: some View {
        Group {
            if let image = image ?? ImagePipeline.shared.cached(url, pixels: 1600) {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .overlay {
                        if !hotspots.isEmpty {
                            GeometryReader { geo in
                                ForEach(Array(hotspots.enumerated()), id: \.element.id) { index, spot in
                                    ViewerHotspotMarker(number: index + 1, spot: spot)
                                        .position(x: geo.size.width * spot.x, y: geo.size.height * spot.y)
                                }
                            }
                            // Percentages are measured from the photo's left edge, as the website places them.
                            .environment(\.layoutDirection, .leftToRight)
                            .transition(.opacity)
                        }
                    }
                    .transition(.opacity)
            } else if failed {
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 28))
                    Text(L("This photo couldn't be loaded."))
                        .font(.neonSubtitle)
                }
                .foregroundStyle(.white.opacity(0.6))
            } else if let preview = smallerCopy {
                // The copy the gallery already drew, sharpening when the
                // full picture arrives.
                Image(uiImage: preview)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .overlay(alignment: .bottom) {
                        ProgressView()
                            .tint(.white)
                            .padding(10)
                            .background(.ultraThinMaterial, in: Circle())
                            .environment(\.colorScheme, .dark)
                            .padding(.bottom, 16)
                    }
            } else {
                ProgressView()
                    .tint(.white)
                    .controlSize(.large)
            }
        }
        .task(id: url) {
            let loaded = await ImagePipeline.shared.image(url, pixels: 1600)
            guard !Task.isCancelled else { return }
            withNeonAnimation(NeonMotion.gentle) {
                image = loaded
                failed = loaded == nil
            }
        }
    }
}

/// A hotspot on the full-screen photo: its numbered pin and its label.
private struct ViewerHotspotMarker: View {
    let number: Int
    let spot: ImageViewerHotspot

    var body: some View {
        VStack(spacing: 4) {
            ProjectHotspotPin(number: number, category: spot.category, size: 22)
            Text(verbatim: spot.label)
                .font(.system(.caption2, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(.ultraThinMaterial, in: Capsule())
                .environment(\.colorScheme, .dark)
                .fixedSize()
        }
        // The pin, not the label, sits on the point.
        .offset(y: 11)
        .accessibilityElement(children: .combine)
    }
}
