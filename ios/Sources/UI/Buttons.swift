import SwiftUI

// MARK: - Buttons

enum NeonButtonKind {
    /// Solid indigo blue, white text — the default call to action.
    case primary
    /// The brand gradient (sky → violet) — the one hero action on a screen.
    case brand
    /// White glass with a hairline — the second choice beside a primary.
    case secondary
    /// A wash of a colour with the colour as text. Pass a strong colour.
    case tinted(Color)
    /// Solid red: removing, deleting, signing out. Confirm first.
    case destructive
    /// Just the text, in purple: low-emphasis actions, toolbars.
    case ghost
}

enum NeonButtonSize {
    case small, medium, large

    var height: CGFloat {
        switch self {
        case .small: return 34
        case .medium: return 44
        case .large: return 52
        }
    }

    var font: Font {
        switch self {
        case .small: return .system(size: 13, weight: .semibold)
        case .medium: return .system(size: 15, weight: .semibold)
        case .large: return .system(size: 16, weight: .semibold)
        }
    }

    var horizontalPadding: CGFloat {
        switch self {
        case .small: return 12
        case .medium: return 18
        case .large: return 22
        }
    }

    var radius: CGFloat {
        switch self {
        case .small: return 17
        case .medium: return 22
        case .large: return 18
        }
    }
}

/// The kit's button look, for any `Button`, `ShareLink`, `PhotosPicker` or
/// `NavigationLink`: `.buttonStyle(.neon(.secondary, size: .medium))`.
struct NeonButtonStyle: ButtonStyle {
    var kind: NeonButtonKind = .primary
    var size: NeonButtonSize = .large
    var fullWidth = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        let shape = RoundedRectangle(cornerRadius: size.radius, style: .continuous)
        return configuration.label
            .font(size.font)
            .lineLimit(1)
            .minimumScaleFactor(0.85)
            .padding(.horizontal, size.horizontalPadding)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .frame(height: size.height)
            .foregroundStyle(foreground)
            .background { background(shape, pressed: pressed) }
            .overlay { border(shape) }
            .contentShape(shape)
            .scaleEffect(pressed ? 0.97 : 1)
            .brightness(pressed && isFilled ? 0.06 : 0)
            .opacity(isEnabled ? 1 : 0.42)
            .animation(NeonMotion.snappy, value: pressed)
            .animation(NeonMotion.gentle, value: isEnabled)
    }

    private var isFilled: Bool {
        switch kind {
        case .primary, .brand, .destructive: return true
        default: return false
        }
    }

    private var foreground: Color {
        switch kind {
        case .primary, .brand, .destructive: return .white
        case .secondary: return .neonInk
        case .tinted(let color): return color
        case .ghost: return .neonPurpleStrong
        }
    }

    @ViewBuilder
    private func background(_ shape: RoundedRectangle, pressed: Bool) -> some View {
        switch kind {
        case .primary:
            shape.fill(LinearGradient.neonAccent)
                .shadow(color: .neonIndigo.opacity(isEnabled ? 0.3 : 0), radius: pressed ? 4 : 12, x: 0, y: pressed ? 2 : 6)
        case .brand:
            shape.fill(LinearGradient(colors: [Color(hex: 0x3AA3F5), .neonIndigo, .neonPurple], startPoint: .leading, endPoint: .trailing))
                .shadow(color: .neonIndigo.opacity(isEnabled ? 0.34 : 0), radius: pressed ? 6 : 14, x: 0, y: pressed ? 3 : 8)
        case .secondary:
            shape.fill(Color.white.opacity(pressed ? 0.75 : 0.96))
                .neonShadow(.low)
        case .tinted(let color):
            shape.fill(NeonHue(color).map { pressed ? $0.pastel : $0.wash } ?? color.opacity(pressed ? 0.18 : 0.11))
        case .destructive:
            shape.fill(LinearGradient(colors: [.neonDanger, .neonDangerStrong], startPoint: .top, endPoint: .bottom))
                .shadow(color: .neonDanger.opacity(isEnabled ? 0.3 : 0), radius: pressed ? 4 : 10, x: 0, y: pressed ? 2 : 6)
        case .ghost:
            shape.fill(Color.neonPurple.opacity(pressed ? 0.1 : 0))
        }
    }

    @ViewBuilder
    private func border(_ shape: RoundedRectangle) -> some View {
        switch kind {
        case .secondary:
            shape.strokeBorder(Color.neonLine, lineWidth: 1)
        case .primary, .brand, .destructive:
            shape.strokeBorder(Color.white.opacity(0.16), lineWidth: 1)
        case .tinted(let color):
            shape.strokeBorder(color.opacity(0.14), lineWidth: 1)
        case .ghost:
            EmptyView()
        }
    }
}

extension ButtonStyle where Self == NeonButtonStyle {
    static func neon(_ kind: NeonButtonKind = .primary, size: NeonButtonSize = .large, fullWidth: Bool = false) -> NeonButtonStyle {
        NeonButtonStyle(kind: kind, size: size, fullWidth: fullWidth)
    }
}

/// The kit's button. The action is async: while it runs the button holds a
/// spinner (after a beat, so quick actions don't flicker) and ignores taps.
/// `confirm:` asks first — use it for anything that can't be undone.
///
///     NeonButton(L("Save"), symbol: "checkmark") { await save() }
///     NeonButton(L("Delete"), kind: .destructive, confirm: L("Delete this file?")) { await delete() }
struct NeonButton: View {
    let title: String
    var symbol: String?
    var kind: NeonButtonKind
    var size: NeonButtonSize
    var fullWidth: Bool
    var isLoading: Bool
    var confirm: String?
    var confirmMessage: String?
    let action: () async -> Void

    @State private var running = false
    @State private var spinner = false
    @State private var confirming = false

    init(
        _ title: String,
        symbol: String? = nil,
        kind: NeonButtonKind = .primary,
        size: NeonButtonSize = .large,
        fullWidth: Bool? = nil,
        isLoading: Bool = false,
        confirm: String? = nil,
        confirmMessage: String? = nil,
        action: @escaping () async -> Void
    ) {
        self.title = title
        self.symbol = symbol
        self.kind = kind
        self.size = size
        self.fullWidth = fullWidth ?? (size == .large)
        self.isLoading = isLoading
        self.confirm = confirm
        self.confirmMessage = confirmMessage
        self.action = action
    }

    private var busy: Bool { running || isLoading }
    private var showsSpinner: Bool { spinner || isLoading }

    var body: some View {
        Button {
            guard !busy else { return }
            if confirm != nil {
                Haptic.warning()
                confirming = true
            } else {
                run()
            }
        } label: {
            ZStack {
                HStack(spacing: 8) {
                    if let symbol {
                        Image(systemName: symbol)
                            .font(.system(size: size == .small ? 12 : 15, weight: .semibold))
                    }
                    Text(title)
                }
                .opacity(showsSpinner ? 0 : 1)
                if showsSpinner {
                    ProgressView()
                        .tint(spinnerTint)
                        .controlSize(size == .small ? .small : .regular)
                        .transition(.opacity)
                }
            }
        }
        .buttonStyle(NeonButtonStyle(kind: kind, size: size, fullWidth: fullWidth))
        .allowsHitTesting(!busy)
        .animation(NeonMotion.quick, value: showsSpinner)
        .confirmationDialog(confirm ?? "", isPresented: $confirming, titleVisibility: .visible) {
            Button(title, role: .destructive) { run() }
            Button(L("Cancel"), role: .cancel) {}
        } message: {
            if let confirmMessage { Text(confirmMessage) }
        }
        .accessibilityLabel(Text(title))
        .accessibilityValue(showsSpinner ? Text(L("Loading")) : Text(""))
    }

    private var spinnerTint: Color {
        switch kind {
        case .primary, .brand, .destructive: return .white
        case .secondary: return .neonInk
        case .tinted(let color): return color
        case .ghost: return .neonPurpleStrong
        }
    }

    private func run() {
        guard !running else { return }
        Haptic.tap()
        running = true
        Task {
            let reveal = Task {
                try? await Task.sleep(nanoseconds: 160_000_000)
                if !Task.isCancelled { spinner = true }
            }
            await action()
            reveal.cancel()
            spinner = false
            running = false
        }
    }
}

// MARK: - Icon buttons

enum IconButtonLook {
    /// A white disc with a soft shadow — the header's round buttons. With a
    /// white glyph (on a photo or a call) it is a dark frosted disc instead.
    case glass
    /// Solid tint, white glyph — the one action in a header.
    case filled
    /// A wash of the tint.
    case tinted
    /// The glyph alone.
    case plain
}

/// What an `IconButton` looks like, for the label of a `Menu`, a
/// `NavigationLink` or a `ShareLink`:
///
///     Menu { … } label: { IconButtonLabel("ellipsis") }
struct IconButtonLabel: View {
    let symbol: String
    var look: IconButtonLook
    var tint: Color
    var size: CGFloat
    var badge: Int?
    var dot: Bool

    init(_ symbol: String, look: IconButtonLook = .glass, tint: Color = .neonInk, size: CGFloat = NeonSize.circleButton, badge: Int? = nil, dot: Bool = false) {
        self.symbol = symbol
        self.look = look
        self.tint = tint
        self.size = size
        self.badge = badge
        self.dot = dot
    }

    private var onDark: Bool { tint == .white }

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.42, weight: look == .glass && !onDark ? .medium : .semibold))
            .foregroundStyle(look == .filled ? Color.white : tint)
            .frame(width: size, height: size)
            .background { disc }
            .overlay(alignment: .topTrailing) {
                if let badge, badge > 0 {
                    CountBadge(badge)
                        .scaleEffect(0.85)
                        .offset(x: 6, y: -6)
                } else if dot {
                    Circle()
                        .fill(Color.neonDanger)
                        .frame(width: size * 0.24, height: size * 0.24)
                        .overlay(Circle().strokeBorder(Color.white, lineWidth: max(1.5, size * 0.045)))
                        .offset(x: -size * 0.1, y: size * 0.08)
                        .transition(.neonPop)
                }
            }
            .contentShape(Circle())
    }

    @ViewBuilder
    private var disc: some View {
        switch look {
        case .glass:
            if onDark {
                Circle()
                    .fill(.ultraThinMaterial)
                    .overlay(Circle().fill(Color.black.opacity(0.18)))
                    .overlay(Circle().strokeBorder(Color.white.opacity(0.22), lineWidth: 1))
            } else {
                Circle()
                    .fill(Color.white.opacity(0.96))
                    .overlay(Circle().strokeBorder(Color.white, lineWidth: 1))
                    .shadow(color: .neonShadowTint.opacity(0.1), radius: 10, x: 0, y: 4)
            }
        case .filled:
            Circle()
                .fill(NeonHue(tint)?.fill ?? LinearGradient.neonTint(tint))
                .shadow(color: tint.opacity(0.32), radius: 8, x: 0, y: 4)
        case .tinted:
            Circle().fill(NeonHue(tint)?.wash ?? tint.opacity(0.12))
        case .plain:
            Color.clear
        }
    }
}

/// A round button holding one symbol — search, the bell (with `dot: true`
/// for something new), more. Always give it a spoken `label`.
struct IconButton: View {
    let symbol: String
    let label: String
    var look: IconButtonLook
    var tint: Color
    var size: CGFloat
    var badge: Int?
    var dot: Bool
    let action: () -> Void

    init(
        _ symbol: String,
        label: String,
        look: IconButtonLook = .glass,
        tint: Color = .neonInk,
        size: CGFloat = 40,
        badge: Int? = nil,
        dot: Bool = false,
        action: @escaping () -> Void
    ) {
        self.symbol = symbol
        self.label = label
        self.look = look
        self.tint = tint
        self.size = size
        self.badge = badge
        self.dot = dot
        self.action = action
    }

    var body: some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            IconButtonLabel(symbol, look: look, tint: tint, size: size, badge: badge, dot: dot)
        }
        .buttonStyle(PressableStyle(scale: 0.88))
        .accessibilityLabel(Text(label))
        .accessibilityValue(dot ? Text(L("New")) : Text(""))
    }
}

// MARK: - Floating action button

/// The round gradient button for a screen's main "add". With `title` it is
/// the extended pill. Place it with `.floatingActionButton(…)`.
struct FloatingActionButton: View {
    let symbol: String
    let label: String
    var title: String?
    let action: () -> Void

    @State private var appeared = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(_ symbol: String = "plus", label: String, title: String? = nil, action: @escaping () -> Void) {
        self.symbol = symbol
        self.label = label
        self.title = title
        self.action = action
    }

    var body: some View {
        Button {
            Haptic.impact(.medium)
            action()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 22, weight: .semibold))
                    .rotationEffect(.degrees(appeared || reduceMotion ? 0 : -90))
                if let title {
                    Text(title)
                        .font(.system(size: 16, weight: .semibold))
                        .lineLimit(1)
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, title == nil ? 0 : 22)
            .frame(width: title == nil ? NeonSize.fab : nil, height: NeonSize.fab)
            .background(Capsule().fill(LinearGradient.neonAction))
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.25), lineWidth: 1))
            .shadow(color: .neonIndigo.opacity(0.4), radius: 16, x: 0, y: 9)
            .contentShape(Capsule())
        }
        .buttonStyle(PressableStyle(scale: 0.9))
        .scaleEffect(appeared || reduceMotion ? 1 : 0.3)
        .opacity(appeared || reduceMotion ? 1 : 0)
        .onAppear {
            withAnimation(NeonMotion.bouncy.delay(0.12)) { appeared = true }
        }
        .accessibilityLabel(Text(label))
    }
}

extension View {
    /// Floats the screen's main action over its bottom trailing corner.
    func floatingActionButton(
        _ symbol: String = "plus",
        label: String,
        title: String? = nil,
        isVisible: Bool = true,
        action: @escaping () -> Void
    ) -> some View {
        overlay(alignment: .bottomTrailing) {
            if isVisible {
                FloatingActionButton(symbol, label: label, title: title, action: action)
                    .padding(.trailing, 20)
                    .padding(.bottom, 18)
                    .transition(.neonPop)
            }
        }
        .animation(NeonMotion.bouncy, value: isVisible)
    }
}

// MARK: - Quick actions

/// One shortcut: a coloured icon on a pastel tile, its name under it.
struct QuickAction: Identifiable {
    let id: String
    let title: String
    let symbol: String
    var hue: NeonHue
    var badge: Int?
    let action: () -> Void

    init(_ title: String, symbol: String, hue: NeonHue, id: String? = nil, badge: Int? = nil, action: @escaping () -> Void) {
        self.id = id ?? title
        self.title = title
        self.symbol = symbol
        self.hue = hue
        self.badge = badge
        self.action = action
    }
}

/// A quick action's tile: the hue's wash, a filled icon tile, the label.
struct QuickActionTile: View {
    let item: QuickAction
    var compact: Bool

    init(_ item: QuickAction, compact: Bool = false) {
        self.item = item
        self.compact = compact
    }

    var body: some View {
        Button {
            Haptic.tap()
            item.action()
        } label: {
            VStack(spacing: compact ? 7 : 9) {
                IconTile(item.symbol, hue: item.hue, size: compact ? 36 : 42, style: .filled)
                    .overlay(alignment: .topTrailing) {
                        if let badge = item.badge, badge > 0 {
                            CountBadge(badge, size: 18).offset(x: 7, y: -7)
                        }
                    }
                Text(item.title)
                    .font(.system(compact ? .caption : .footnote, weight: .semibold))
                    .foregroundStyle(Color.neonInk.opacity(0.88))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, compact ? 10 : 14)
            .frame(maxWidth: .infinity, minHeight: compact ? 88 : 104)
            .background {
                let shape = RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
                shape.fill(LinearGradient(colors: [item.hue.wash.opacity(0.7), item.hue.wash], startPoint: .top, endPoint: .bottom))
                    .overlay(shape.strokeBorder(item.hue.color.opacity(0.08), lineWidth: 1))
            }
            .contentShape(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))
        }
        .buttonStyle(.pressable)
        .accessibilityLabel(Text(item.title))
    }
}

/// Quick actions as a grid (three to a row by default), or as one row that
/// scrolls sideways (`columns: nil`), as on the mockup's Home. A row inside a
/// card bleeds to its edges: `QuickActionGrid(actions, columns: nil,
/// inset: NeonSpace.card).padding(.horizontal, -NeonSpace.card)`.
struct QuickActionGrid: View {
    let actions: [QuickAction]
    var columns: Int?
    var inset: CGFloat

    init(_ actions: [QuickAction], columns: Int? = 3, inset: CGFloat = 0) {
        self.actions = actions
        self.columns = columns
        self.inset = inset
    }

    var body: some View {
        if let columns {
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: NeonSpace.sm, alignment: .top), count: max(1, columns)),
                spacing: NeonSpace.sm
            ) {
                ForEach(actions) { QuickActionTile($0, compact: columns > 3) }
            }
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: NeonSpace.sm) {
                    ForEach(actions) { QuickActionTile($0, compact: true).frame(width: 82) }
                }
                .padding(.horizontal, inset)
                .padding(.vertical, 2)
            }
        }
    }
}
