import SwiftUI

// The pieces every call screen is drawn with: the dark stage, the round
// controls, the big avatar with its rings, the name tag on a tile and the
// connection bars. Built from the kit's tokens; the call screens are the one
// place the app goes dark, the way a phone call does, with the brand's sky and
// violet glowing through (the Home hero's colours, at night).

// MARK: - The stage

/// Deep ink with the brand's glows. `hue` warms it towards one person;
/// `animated` lets the glows drift (the ringing screen), Reduce Motion permitting.
struct CallBackdrop: View {
    var hue: NeonHue?
    var animated = false

    @State private var drift = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// How strongly the person's own colour glows. Orange, amber and green
    /// over the ink turn brown and olive, so they stay a tint and the brand's
    /// violet and indigo carry the stage — it never goes muddy.
    static func glow(_ hue: NeonHue?) -> Double {
        guard let hue else { return 0.55 }
        switch hue {
        case .orange, .amber, .green, .red: return 0.28
        default: return 0.55
        }
    }

    var body: some View {
        GeometryReader { geo in
            let side = max(geo.size.width, geo.size.height)
            ZStack {
                LinearGradient.neonInkHero
                Color.neonInk.opacity(0.4)
                Circle()
                    .fill((hue?.color ?? .neonBlue).opacity(Self.glow(hue)))
                    .frame(width: side * 0.75, height: side * 0.75)
                    .blur(radius: 90)
                    .offset(x: -geo.size.width * 0.38 + (drift ? 36 : 0), y: -geo.size.height * 0.34 + (drift ? 24 : 0))
                Circle()
                    .fill(Color.neonPurple.opacity(0.5))
                    .frame(width: side * 0.7, height: side * 0.7)
                    .blur(radius: 100)
                    .offset(x: geo.size.width * 0.42 - (drift ? 30 : 0), y: geo.size.height * 0.36 - (drift ? 40 : 0))
                Circle()
                    .fill(Color.neonIndigo.opacity(0.32))
                    .frame(width: side * 0.5, height: side * 0.5)
                    .blur(radius: 80)
                    .offset(x: drift ? -20 : 20, y: geo.size.height * 0.05)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .onAppear {
            guard animated, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 5).repeatForever(autoreverses: true)) { drift = true }
        }
    }
}

/// A frosted dark surface for anything sitting on the stage or on video.
struct CallGlass<S: InsettableShape>: View {
    let shape: S
    var strength: Double = 0.3

    var body: some View {
        shape.fill(.ultraThinMaterial)
            .environment(\.colorScheme, .dark)
            .overlay(shape.fill(Color.black.opacity(strength)))
            .overlay(shape.strokeBorder(Color.white.opacity(0.14), lineWidth: 1))
    }
}

// MARK: - Round controls

enum CallButtonLook {
    /// Frosted dark disc, white glyph: sending, or a control at rest.
    case glass
    /// White disc, ink glyph: kept for "you are not sending this" alone —
    /// muted, camera off, no microphone — on every call screen alike.
    case active
    /// Red: hang up, decline.
    case danger
    /// Green: answer.
    case accept
}

/// A small mark on a round control: an indigo dot for "switched on" where
/// the disc itself must not change (the speaker), or an orange warning for a
/// control that cannot work until something is allowed in Settings.
enum CallButtonMark {
    case on
    case warning
}

/// A round call control with its name under it — the controls bar, the
/// ringing screen's answer and decline.
struct CallRoundButton: View {
    let symbol: String
    let title: String
    var look: CallButtonLook = .glass
    var size: CGFloat = 58
    /// Said by VoiceOver after the name ("On", "Off"), for a toggle.
    var value: String?
    var mark: CallButtonMark?
    var showsTitle = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 7) {
                Image(systemName: symbol)
                    .font(.system(size: size * 0.36, weight: .semibold))
                    .foregroundStyle(look == .active ? Color.neonInk : Color.white)
                    .frame(width: size, height: size)
                    .background { disc }
                    .overlay(alignment: mark == .on ? .bottom : .topTrailing) { markView }
                    .contentShape(Circle())
                if showsTitle {
                    Text(title)
                        .font(.neonCaption)
                        .foregroundStyle(.white.opacity(0.88))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
                }
            }
        }
        .buttonStyle(PressableStyle(scale: 0.9))
        .accessibilityLabel(Text(title))
        .accessibilityValue(Text(value ?? ""))
    }

    @ViewBuilder
    private var markView: some View {
        switch mark {
        case .on:
            Circle()
                .fill(Color.neonIndigo)
                .frame(width: 7, height: 7)
                .overlay(Circle().strokeBorder(Color.white.opacity(0.9), lineWidth: 1))
                .shadow(color: .neonIndigo.opacity(0.8), radius: 4)
                .offset(y: -size * 0.12)
                .transition(.neonPop)
        case .warning:
            Image(systemName: "exclamationmark")
                .font(.system(size: 10, weight: .heavy))
                .foregroundStyle(.white)
                .frame(width: 18, height: 18)
                .background(Circle().fill(NeonHue.orange.fill))
                .overlay(Circle().strokeBorder(Color.neonInk.opacity(0.6), lineWidth: 1.5))
                .offset(x: 2, y: -2)
                .transition(.neonPop)
        case nil:
            EmptyView()
        }
    }

    @ViewBuilder
    private var disc: some View {
        switch look {
        case .glass:
            CallGlass(shape: Circle(), strength: 0.22)
        case .active:
            Circle()
                .fill(Color.white)
                .shadow(color: .white.opacity(0.25), radius: 10, x: 0, y: 0)
        case .danger:
            Circle()
                .fill(NeonHue.red.fill)
                .shadow(color: .neonDanger.opacity(0.5), radius: 14, x: 0, y: 6)
        case .accept:
            Circle()
                .fill(NeonHue.green.fill)
                .shadow(color: .neonSuccess.opacity(0.5), radius: 14, x: 0, y: 6)
        }
    }
}

/// A small round button on the stage (minimise, close, the layout switch):
/// the same dark glass as the controls, so nothing on a call reads as a
/// light sticker on a dark screen.
struct CallGlassIconButton: View {
    let symbol: String
    let label: String
    var size: CGFloat = NeonSize.circleButton
    let action: () -> Void

    var body: some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            Image(systemName: symbol)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: size, height: size)
                .background(CallGlass(shape: Circle(), strength: 0.22))
                .contentShape(Circle())
        }
        .buttonStyle(PressableStyle(scale: 0.88))
        .accessibilityLabel(Text(label))
    }
}

// MARK: - People

/// A person, large: their avatar in their colour, a soft glow of it behind,
/// rings spreading out while the call rings, and the brand ring while they
/// speak.
struct CallHalo: View {
    let face: CallFace
    var size: CGFloat = 128
    var ringing = false
    var speaking = false

    @State private var wave = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let glow = face.hue?.color ?? .neonPurple
        ZStack {
            Circle()
                .fill(glow.opacity(CallBackdrop.glow(face.hue) < 0.5 ? 0.32 : 0.5))
                .frame(width: size * 1.3, height: size * 1.3)
                .blur(radius: 34)

            if ringing {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .strokeBorder(Color.white.opacity(0.32), lineWidth: 1.5)
                        .frame(width: size, height: size)
                        .scaleEffect(wave && !reduceMotion ? 1.9 : 1.12 + CGFloat(index) * 0.16)
                        .opacity(wave && !reduceMotion ? 0 : 0.7 - Double(index) * 0.2)
                        .animation(
                            reduceMotion ? nil : .easeOut(duration: 2.4).repeatForever(autoreverses: false).delay(Double(index) * 0.8),
                            value: wave
                        )
                }
            }

            if speaking {
                Circle()
                    .strokeBorder(AngularGradient.neonStory, lineWidth: 4)
                    .frame(width: size + 14, height: size + 14)
                    .shadow(color: .neonPurple.opacity(0.6), radius: 12)
                    .transition(.neonPop)
            }

            CallFaceView(face: face, size: size)
                .overlay(Circle().strokeBorder(Color.white.opacity(0.85), lineWidth: max(2, size * 0.025)))
                .shadow(color: .black.opacity(0.35), radius: 18, x: 0, y: 10)
        }
        .frame(width: size + 24, height: size + 24)
        .animation(NeonMotion.snappy, value: speaking)
        .onAppear { if ringing { wave = true } }
        .onChange(of: ringing) { if $0 { wave = true } }
        .accessibilityHidden(true)
    }
}

/// How good a connection is, as three bars: green, amber, red; grey when
/// there are no numbers yet.
struct CallQualityBars: View {
    let quality: CallQuality

    var body: some View {
        let lit: Int
        let color: Color
        switch quality {
        case .good: lit = 3; color = .neonSuccess
        case .fair: lit = 2; color = .neonAmber
        case .poor: lit = 1; color = .neonDanger
        case .unknown: lit = 0; color = .white
        }
        return HStack(alignment: .bottom, spacing: 2) {
            ForEach(0..<3, id: \.self) { index in
                RoundedRectangle(cornerRadius: 1, style: .continuous)
                    .fill(index < lit ? color : Color.white.opacity(0.35))
                    .frame(width: 3, height: 5 + CGFloat(index) * 3.5)
            }
        }
        // Signal bars rise left to right in either language, as the
        // status bar's do.
        .environment(\.layoutDirection, .leftToRight)
        .accessibilityElement()
        .accessibilityLabel(Text(Self.label(quality)))
    }

    static func label(_ quality: CallQuality) -> String {
        switch quality {
        case .good: return L("Good connection")
        case .fair: return L("Fair connection")
        case .poor: return L("Poor connection")
        case .unknown: return L("Connection not measured yet")
        }
    }
}

/// The name on a tile, frosted, with a red slashed microphone when muted and
/// the connection's bars.
struct CallNameTag: View {
    let name: String
    var muted = false
    var quality: CallQuality?
    /// For the small tiles of the speaker view's strip.
    var compact = false

    var body: some View {
        HStack(spacing: compact ? 4 : 6) {
            if muted {
                Image(systemName: "mic.slash.fill")
                    .font(.system(size: compact ? 8 : 9, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: compact ? 15 : 18, height: compact ? 15 : 18)
                    .background(Circle().fill(Color.neonDanger))
                    .accessibilityLabel(L("Muted"))
            }
            DirText(name, font: .system(compact ? .caption2 : .footnote, weight: .semibold), color: .white, fill: false, lineLimit: 1)
            if let quality {
                CallQualityBars(quality: quality)
            }
        }
        .padding(.leading, muted ? 3 : (compact ? 7 : 10))
        .padding(.trailing, compact ? 7 : 10)
        .padding(.vertical, compact ? 3 : 5)
        .background(CallGlass(shape: Capsule(), strength: 0.35))
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
    }
}

/// A green dot that breathes while the call is live, amber while it
/// reconnects.
struct CallLiveDot: View {
    let phase: CallSessionPhase

    var body: some View {
        let color: Color = phase == .live ? .neonSuccess : phase == .reconnecting ? .neonAmber : .white.opacity(0.6)
        ZStack {
            Circle().fill(color.opacity(0.45)).frame(width: 12, height: 12).neonPulse(phase != .ended)
            Circle().fill(color).frame(width: 7, height: 7)
        }
        .frame(width: 12, height: 12)
        .accessibilityHidden(true)
    }
}

// MARK: - Notices

/// A notice on the stage: the reason something did not work, what to do,
/// and a way to close it. Stays until closed, like the kit's notes.
struct CallNoticeBanner: View {
    let text: String
    var symbol = "exclamationmark.triangle.fill"
    var actionTitle: String?
    var action: (() -> Void)?
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: NeonSpace.md) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(Circle().fill(NeonHue.orange.fill))
            VStack(alignment: .leading, spacing: NeonSpace.sm) {
                Text(text)
                    .font(.neonFootnote)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                if let actionTitle, let action {
                    NeonButton(actionTitle, kind: .secondary, size: .medium) { action() }
                }
            }
            .padding(.top, 5)
            Spacer(minLength: 0)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white.opacity(0.75))
                    .frame(width: NeonSize.touch, height: NeonSize.touch)
                    .contentShape(Rectangle())
            }
            .padding(.top, -8)
            .padding(.trailing, -8)
            .accessibilityLabel(L("Close"))
        }
        .padding(NeonSpace.md)
        .background(CallGlass(shape: RoundedRectangle(cornerRadius: NeonRadius.lg, style: .continuous), strength: 0.45))
        .neonShadow(.floating)
    }
}

// MARK: - The microphone's level

/// What the microphone is hearing right now, as a row of bars that rise with
/// the voice — real levels (0…1, newest last), never an animation standing in
/// for them. Flat bars mean it hears nothing.
struct CallMicMeter: View {
    let levels: [Double]
    /// False while the microphone is off: the bars go quiet and grey.
    var live = true
    var bars = CallMicLevelMonitor.count

    var body: some View {
        let shown = Array((Array(repeating: 0, count: max(0, bars - levels.count)) + levels).suffix(bars))
        HStack(alignment: .center, spacing: 4) {
            ForEach(shown.indices, id: \.self) { index in
                Capsule()
                    .fill(live ? AnyShapeStyle(NeonHue.green.fill) : AnyShapeStyle(Color.white.opacity(0.28)))
                    .frame(width: 4, height: 4 + 22 * CGFloat(live ? min(1, max(0, shown[index])) : 0))
            }
        }
        .frame(height: 26)
        .animation(.linear(duration: 0.08), value: shown)
        .accessibilityElement()
        .accessibilityLabel(Text(L("Microphone level")))
        .accessibilityValue(Text(live && (levels.last ?? 0) > 0.08 ? L("Hearing you") : L("Quiet")))
    }
}
