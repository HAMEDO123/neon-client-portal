import SwiftUI
import UIKit

// MARK: - Hero header

/// The top of a detail page: a cover photo with the title over it, or — with
/// no photo — the brand's ambient wash with a large icon. Pulling the page
/// down zooms the photo. `accessory` holds badges or a stage track.
struct HeroHeader<Accessory: View>: View {
    let title: String
    var subtitle: String?
    var eyebrow: String?
    var imageURL: URL?
    var symbol: String
    var tint: Color
    var height: CGFloat
    let accessory: Accessory
    /// Drawn instead of the icon tile on a page without a photo — a person's
    /// face, say. Set with `.heroLeading { … }`.
    var leading: AnyView?

    @State private var baseline: CGFloat?
    @State private var pull: CGFloat = 0

    init(
        _ title: String,
        subtitle: String? = nil,
        eyebrow: String? = nil,
        imageURL: URL? = nil,
        symbol: String = "square.grid.2x2",
        tint: Color = .neonPurpleStrong,
        height: CGFloat = 250,
        @ViewBuilder accessory: () -> Accessory
    ) {
        self.title = title
        self.subtitle = subtitle
        self.eyebrow = eyebrow
        self.imageURL = imageURL
        self.symbol = symbol
        self.tint = tint
        self.height = height
        self.accessory = accessory()
    }

    var body: some View {
        Group {
            if imageURL != nil {
                photoHero
            } else {
                plainHero
            }
        }
        .background(
            GeometryReader { proxy in
                Color.clear.preference(key: HeroOffsetKey.self, value: proxy.frame(in: .global).minY)
            }
        )
        .onPreferenceChange(HeroOffsetKey.self) { y in
            if baseline == nil { baseline = y }
            pull = max(0, y - (baseline ?? y))
        }
        .neonAppear(distance: 8)
    }

    private var photoHero: some View {
        ZStack(alignment: .bottomLeading) {
            RemoteImage(url: imageURL)
                .scaleEffect(1 + min(pull, 200) / height, anchor: .bottom)
            LinearGradient(
                colors: [.black.opacity(0), .black.opacity(0.18), .black.opacity(0.72)],
                startPoint: .top,
                endPoint: .bottom
            )
            VStack(alignment: .leading, spacing: 6) {
                if let eyebrow {
                    Text(eyebrow.uppercased())
                        .font(.system(size: 11, weight: .bold))
                        .tracking(0.8)
                        .foregroundStyle(.white.opacity(0.8))
                }
                DirText(title, font: .system(size: 27, weight: .bold), color: .white)
                if let subtitle {
                    DirText(subtitle, font: .system(size: 14, weight: .medium), color: .white.opacity(0.85))
                }
                accessory
                    .padding(.top, 4)
            }
            .padding(20)
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: NeonRadius.xxl, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: NeonRadius.xxl, style: .continuous)
                .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
        )
        .neonShadow(.raised)
    }

    private var plainHero: some View {
        VStack(alignment: .leading, spacing: 10) {
            Group {
                if let leading {
                    leading
                } else {
                    IconTile(symbol, tint: tint, size: 52, style: .filled)
                }
            }
            .padding(.bottom, 4)
            if let eyebrow {
                Text(eyebrow.uppercased())
                    .font(.system(size: 11, weight: .bold))
                    .tracking(0.8)
                    .foregroundStyle(tint)
            }
            DirText(title, font: .system(size: 27, weight: .bold))
            if let subtitle {
                DirText(subtitle, font: .system(size: 14, weight: .medium), color: .neonTextSecondary)
            }
            accessory
                .padding(.top, 2)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            ZStack {
                LinearGradient.neonAmbient
                Circle()
                    .fill(tint.opacity(0.16))
                    .frame(width: 220, height: 220)
                    .blur(radius: 50)
                    .offset(x: 120, y: -70)
            }
            .clipShape(RoundedRectangle(cornerRadius: NeonRadius.xxl, style: .continuous))
        )
        .neonSurface(.strong, radius: NeonRadius.xxl)
    }
}

extension HeroHeader {
    /// A view of your own where the icon tile goes, on a header without a
    /// cover photo: `HeroHeader(name, …) { badges }.heroLeading { FacePicker(…) }`.
    func heroLeading<Leading: View>(@ViewBuilder _ content: () -> Leading) -> HeroHeader {
        var copy = self
        copy.leading = AnyView(content())
        return copy
    }
}

extension HeroHeader where Accessory == EmptyView {
    init(
        _ title: String,
        subtitle: String? = nil,
        eyebrow: String? = nil,
        imageURL: URL? = nil,
        symbol: String = "square.grid.2x2",
        tint: Color = .neonPurpleStrong,
        height: CGFloat = 250
    ) {
        self.init(title, subtitle: subtitle, eyebrow: eyebrow, imageURL: imageURL, symbol: symbol, tint: tint, height: height) {
            EmptyView()
        }
    }
}

private struct HeroOffsetKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

// MARK: - Hero card

/// The picture behind a `HeroCard`.
enum HeroPhoto {
    case none
    /// A picture from the server, through `RemoteImage`.
    case url(URL?)
    /// A picture already in hand.
    case image(Image)
}

/// The vivid card at the top of Home: the brand gradient (sky blue into
/// violet) with a photo melting into it from the trailing side, a greeting
/// line with a symbol, a big name, a date, a line of text, an accessory at
/// the top trailing corner (the weather) and a round chevron at the bottom
/// trailing corner. Text sits on the gradient, never on the photo.
///
///     HeroCard(L("Hamed"), eyebrow: L("Good evening,"), eyebrowSymbol: "sun.max.fill",
///              subtitle: dateLine, footnote: L("An overview of every client project delivery."),
///              photo: .url(latestRender), action: { openProjects() }) {
///         WeatherBadge(…)
///     }
struct HeroCard<Accessory: View>: View {
    let title: String
    var eyebrow: String?
    var eyebrowSymbol: String?
    var subtitle: String?
    var footnote: String?
    var photo: HeroPhoto
    var minHeight: CGFloat
    var actionLabel: String
    var action: (() -> Void)?
    let accessory: Accessory

    init(
        _ title: String,
        eyebrow: String? = nil,
        eyebrowSymbol: String? = nil,
        subtitle: String? = nil,
        footnote: String? = nil,
        photo: HeroPhoto = .none,
        minHeight: CGFloat = 164,
        actionLabel: String = L("See more"),
        action: (() -> Void)? = nil,
        @ViewBuilder accessory: () -> Accessory
    ) {
        self.title = title
        self.eyebrow = eyebrow
        self.eyebrowSymbol = eyebrowSymbol
        self.subtitle = subtitle
        self.footnote = footnote
        self.photo = photo
        self.minHeight = minHeight
        self.actionLabel = actionLabel
        self.action = action
        self.accessory = accessory()
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.xl, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    if let eyebrow {
                        HStack(spacing: 8) {
                            if let eyebrowSymbol {
                                Image(systemName: eyebrowSymbol)
                                    .symbolRenderingMode(.multicolor)
                                    .font(.system(.headline, weight: .semibold))
                            }
                            Text(eyebrow)
                                .font(.system(.headline, weight: .medium))
                                .foregroundStyle(.white.opacity(0.95))
                                .lineLimit(2)
                                .minimumScaleFactor(0.85)
                        }
                    }
                    DirText(title, font: .neonDisplay, color: .white, fill: false, lineLimit: 1)
                        .minimumScaleFactor(0.7)
                    if let subtitle {
                        Text(subtitle)
                            .font(.system(.subheadline, weight: .medium))
                            .foregroundStyle(.white.opacity(0.9))
                            .lineLimit(2)
                            .minimumScaleFactor(0.85)
                            .padding(.top, 2)
                    }
                }
                Spacer(minLength: 8)
                accessory
            }
            Spacer(minLength: 14)
            HStack(alignment: .bottom, spacing: 12) {
                if let footnote {
                    Text(footnote)
                        .font(.system(.footnote, weight: .medium))
                        .foregroundStyle(.white.opacity(0.92))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                if let action {
                    Button {
                        Haptic.tap()
                        action()
                    } label: {
                        Image(systemName: "chevron.forward")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Color.neonIndigo)
                            .frame(width: 38, height: 38)
                            .background(Circle().fill(Color.white))
                            .shadow(color: .black.opacity(0.18), radius: 8, x: 0, y: 4)
                            .contentShape(Circle())
                    }
                    .buttonStyle(PressableStyle(scale: 0.88))
                    .accessibilityLabel(Text(actionLabel))
                }
            }
        }
        .shadow(color: .black.opacity(0.12), radius: 6, x: 0, y: 2)
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .topLeading)
        .background { backdrop }
        .clipShape(shape)
        .overlay(shape.strokeBorder(Color.white.opacity(0.28), lineWidth: 1))
        .shadow(color: .neonIndigo.opacity(0.28), radius: 20, x: 0, y: 10)
        .neonContextShape(radius: NeonRadius.xl)
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .neonAppear()
    }

    private var backdrop: some View {
        ZStack {
            LinearGradient.neonBrand
            photoLayer
                .mask(
                    // Clear under the text, the photo's own colours on the far side.
                    LinearGradient(
                        stops: [.init(color: .clear, location: 0.3), .init(color: .black.opacity(0.7), location: 0.62), .init(color: .black, location: 0.9)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .flipsForRightToLeftLayoutDirection(true)
                )
            // Keeps the gradient's hue over the photo's near half, so it reads as one card.
            LinearGradient(
                colors: [Color(hex: 0x3AA3F5).opacity(0.7), Color(hex: 0x6B5CF5).opacity(0.38), Color(hex: 0x6B5CF5).opacity(0.1)],
                startPoint: .leading,
                endPoint: .trailing
            )
            .flipsForRightToLeftLayoutDirection(true)
        }
    }

    @ViewBuilder
    private var photoLayer: some View {
        switch photo {
        case .none:
            // No photo: two soft lights, so the card still has depth.
            ZStack {
                Circle().fill(Color.white.opacity(0.22)).frame(width: 220).blur(radius: 50).offset(x: 110, y: -60)
                Circle().fill(Color.neonPink.opacity(0.35)).frame(width: 180).blur(radius: 60).offset(x: 140, y: 80)
            }
        case .url(let url):
            RemoteImage(url: url, placeholderSymbol: "building.2")
        case .image(let image):
            GeometryReader { proxy in
                image.resizable().scaledToFill().frame(width: proxy.size.width, height: proxy.size.height).clipped()
            }
        }
    }
}

extension HeroCard where Accessory == EmptyView {
    init(
        _ title: String,
        eyebrow: String? = nil,
        eyebrowSymbol: String? = nil,
        subtitle: String? = nil,
        footnote: String? = nil,
        photo: HeroPhoto = .none,
        minHeight: CGFloat = 164,
        actionLabel: String = L("See more"),
        action: (() -> Void)? = nil
    ) {
        self.init(
            title, eyebrow: eyebrow, eyebrowSymbol: eyebrowSymbol, subtitle: subtitle, footnote: footnote,
            photo: photo, minHeight: minHeight, actionLabel: actionLabel, action: action
        ) { EmptyView() }
    }
}

// MARK: - The brand

/// The studio's mark — the app icon on a glass tile, with a slow halo.
struct BrandMark: View {
    var size: CGFloat = 84
    @State private var spin = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let icon = UIImage(named: "AppIcon60x60")

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.26, style: .continuous)
        ZStack {
            // The halo: the brand colours, blurred and turning slowly.
            Circle()
                .fill(AngularGradient(colors: [.neonCyan, .neonPurple, .neonPink, .neonCyan], center: .center))
                .frame(width: size * 1.25, height: size * 1.25)
                .blur(radius: size * 0.28)
                .opacity(0.45)
                .rotationEffect(.degrees(spin ? 360 : 0))

            Group {
                if let icon = Self.icon {
                    Image(uiImage: icon)
                        .resizable()
                        .interpolation(.high)
                        .scaledToFill()
                } else {
                    Text("N")
                        .font(.system(size: size * 0.5, weight: .heavy, design: .rounded))
                        .foregroundStyle(LinearGradient.neonWordmark)
                }
            }
            .frame(width: size, height: size)
            .background(Color.white)
            .clipShape(shape)
            .overlay(shape.strokeBorder(Color.white.opacity(0.9), lineWidth: 1.5))
            .neonShadow(.raised)
        }
        .frame(width: size * 1.3, height: size * 1.3)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 14).repeatForever(autoreverses: false)) { spin = true }
        }
        .accessibilityHidden(true)
    }
}

/// "NEON" in the web's shining gradient (`.text-gradient-neon`).
struct NeonWordmark: View {
    var size: CGFloat = 40
    @State private var phase: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let word = Text(verbatim: "NEON")
            .font(.system(size: size, weight: .heavy, design: .rounded))
            .tracking(size * 0.06)
        word
            .foregroundStyle(.clear)
            .overlay {
                GeometryReader { proxy in
                    let width = proxy.size.width
                    // Periodic over one width, so sliding by exactly one width loops seamlessly.
                    LinearGradient(
                        colors: [.neonCyanStrong, .neonPurple, .neonPink, .neonCyanStrong, .neonPurple, .neonPink, .neonCyanStrong],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(width: width * 2)
                    .offset(x: -width * phase)
                }
                .mask(word)
            }
            .environment(\.layoutDirection, .leftToRight)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 8).repeatForever(autoreverses: false)) { phase = 1 }
            }
            .accessibilityLabel(Text(verbatim: "NEON"))
    }
}
