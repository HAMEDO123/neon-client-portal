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
                DirText(title, font: .system(size: 27, weight: .bold, design: .rounded), color: .white)
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
            IconTile(symbol, tint: tint, size: 52, style: .filled)
                .padding(.bottom, 4)
            if let eyebrow {
                Text(eyebrow.uppercased())
                    .font(.system(size: 11, weight: .bold))
                    .tracking(0.8)
                    .foregroundStyle(tint)
            }
            DirText(title, font: .system(size: 27, weight: .bold, design: .rounded))
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
