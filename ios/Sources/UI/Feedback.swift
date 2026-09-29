import SwiftUI
import UIKit

// MARK: - Toasts

/// One message on the toast banner.
struct ToastMessage: Identifiable, Equatable {
    enum Style: Equatable {
        case success, error, info, warning
    }

    let id = UUID()
    let style: Style
    let title: String
    var detail: String?
    var duration: Double

    static func == (lhs: ToastMessage, rhs: ToastMessage) -> Bool { lhs.id == rhs.id }
}

/// A banner that drops in from the top of the screen and leaves by itself,
/// from anywhere — a view, a task, an `APIClient` extension:
///
///     Toast.success(L("Saved"))
///     Toast.error(error)                // the server's own sentence
///     Toast.info(L("Copied"), detail: link)
///
/// It floats in its own window, so it shows above sheets and full-screen
/// covers too, and never blocks touches outside itself.
enum Toast {
    static func success(_ title: String, detail: String? = nil) {
        show(ToastMessage(style: .success, title: title, detail: detail, duration: 2.4))
    }

    static func error(_ title: String, detail: String? = nil) {
        show(ToastMessage(style: .error, title: title, detail: detail, duration: 4))
    }

    /// The error's own description — for a refusal, the server's sentence.
    static func error(_ error: Error) {
        show(ToastMessage(style: .error, title: error.localizedDescription, detail: nil, duration: 4))
    }

    static func info(_ title: String, detail: String? = nil) {
        show(ToastMessage(style: .info, title: title, detail: detail, duration: 2.8))
    }

    static func warning(_ title: String, detail: String? = nil) {
        show(ToastMessage(style: .warning, title: title, detail: detail, duration: 3.6))
    }

    static func show(_ message: ToastMessage) {
        Task { @MainActor in ToastCenter.shared.present(message) }
    }

    static func dismiss() {
        Task { @MainActor in ToastCenter.shared.dismiss() }
    }
}

@MainActor
final class ToastCenter: ObservableObject {
    static let shared = ToastCenter()

    @Published fileprivate(set) var current: ToastMessage?
    /// Where the banner is, in window coordinates: the only place the toast
    /// window accepts touches.
    fileprivate var frame: CGRect = .zero

    private var window: ToastWindow?
    private var hideTask: Task<Void, Never>?

    func present(_ message: ToastMessage) {
        installIfNeeded()
        hideTask?.cancel()
        switch message.style {
        case .success: Haptic.success()
        case .error: Haptic.error()
        case .warning: Haptic.warning()
        case .info: Haptic.soft()
        }
        withAnimation(NeonMotion.resolved(NeonMotion.bouncy)) { current = message }
        UIAccessibility.post(notification: .announcement, argument: message.title)
        let id = message.id
        hideTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(message.duration * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.dismiss(id: id)
        }
    }

    func dismiss(id: UUID? = nil) {
        guard let current, id == nil || current.id == id else { return }
        withAnimation(NeonMotion.resolved(NeonMotion.smooth)) { self.current = nil }
    }

    private func installIfNeeded() {
        if let window, window.windowScene != nil { return }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first else { return }
        let window = ToastWindow(windowScene: scene)
        window.toastCenter = self
        window.windowLevel = .alert + 1
        window.backgroundColor = .clear
        let host = ToastHostingController(rootView: ToastOverlay(center: self))
        host.view.backgroundColor = .clear
        window.rootViewController = host
        window.isHidden = false
        self.window = window
    }
}

/// Lets every touch through except the ones on the banner itself.
private final class ToastWindow: UIWindow {
    weak var toastCenter: ToastCenter?

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let toastCenter, toastCenter.current != nil, toastCenter.frame.contains(point) else { return nil }
        return super.hitTest(point, with: event)
    }
}

private final class ToastHostingController: UIHostingController<ToastOverlay> {
    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }
}

private struct ToastOverlay: View {
    @ObservedObject var center: ToastCenter

    var body: some View {
        VStack {
            if let toast = center.current {
                ToastBanner(toast: toast) { center.dismiss() }
                    .background(
                        GeometryReader { proxy in
                            Color.clear
                                .onAppear { center.frame = proxy.frame(in: .global) }
                                .onChange(of: proxy.frame(in: .global)) { center.frame = $0 }
                        }
                    )
                    .transition(.neonDrop)
                    .id(toast.id)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, NeonSpace.gutter)
        .padding(.top, 6)
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
        .neonLanguage()
    }
}

private struct ToastBanner: View {
    let toast: ToastMessage
    let onDismiss: () -> Void
    @State private var drag: CGFloat = 0

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(Circle().fill(LinearGradient.neonTint(tint)))
                .shadow(color: tint.opacity(0.35), radius: 6, x: 0, y: 3)
            VStack(alignment: .leading, spacing: 2) {
                DirText(toast.title, font: .system(size: 15, weight: .semibold), lineLimit: 3)
                if let detail = toast.detail {
                    DirText(detail, font: .system(size: 13), color: .neonTextSecondary, lineLimit: 3)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            // Opaque enough to read over anything: frosted, then near-white.
            let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
            shape.fill(.regularMaterial)
                .overlay(shape.fill(Color.white.opacity(0.78)))
                .overlay(shape.strokeBorder(LinearGradient.neonGlassEdge, lineWidth: 1))
                .shadow(color: .neonInk.opacity(0.16), radius: 24, x: 0, y: 12)
        }
        .offset(y: min(drag, 0))
        .gesture(
            DragGesture(minimumDistance: 4)
                .onChanged { drag = $0.translation.height }
                .onEnded { value in
                    if value.translation.height < -20 {
                        onDismiss()
                    } else {
                        withAnimation(NeonMotion.snappy) { drag = 0 }
                    }
                }
        )
        .onTapGesture { onDismiss() }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(L("Dismiss"))
    }

    private var symbol: String {
        switch toast.style {
        case .success: return "checkmark"
        case .error: return "xmark"
        case .warning: return "exclamationmark"
        case .info: return "info"
        }
    }

    private var tint: Color {
        switch toast.style {
        case .success: return .neonSuccess
        case .error: return .neonDanger
        case .warning: return .neonOrange
        case .info: return .neonPurple
        }
    }
}

// MARK: - Confirming

extension View {
    /// Asks before doing something that can't be undone. The action button
    /// is red and says what will happen ("Delete drawing"), Cancel is beside it.
    func confirmDestructive(
        _ title: String,
        message: String? = nil,
        actionTitle: String,
        isPresented: Binding<Bool>,
        action: @escaping () -> Void
    ) -> some View {
        confirmationDialog(title, isPresented: isPresented, titleVisibility: .visible) {
            Button(actionTitle, role: .destructive) {
                Haptic.warning()
                action()
            }
            Button(L("Cancel"), role: .cancel) {}
        } message: {
            if let message { Text(message) }
        }
    }

    /// The same, for the item about to go: set `item` to ask about it.
    func confirmDestructive<Item>(
        item: Binding<Item?>,
        title: @escaping (Item) -> String,
        message: ((Item) -> String?)? = nil,
        actionTitle: String,
        action: @escaping (Item) -> Void
    ) -> some View {
        confirmationDialog(
            item.wrappedValue.map(title) ?? "",
            isPresented: Binding(get: { item.wrappedValue != nil }, set: { if !$0 { item.wrappedValue = nil } }),
            titleVisibility: .visible,
            presenting: item.wrappedValue
        ) { value in
            Button(actionTitle, role: .destructive) {
                Haptic.warning()
                action(value)
            }
            Button(L("Cancel"), role: .cancel) {}
        } message: { value in
            if let text = message?(value) { Text(text) }
        }
    }

    /// A red swipe action on a `List` row that asks before it acts.
    func destructiveSwipe(
        _ title: String,
        symbol: String = "trash",
        confirm: String,
        message: String? = nil,
        action: @escaping () -> Void
    ) -> some View {
        modifier(DestructiveSwipe(title: title, symbol: symbol, confirm: confirm, message: message, action: action))
    }

    /// A coloured swipe action on a `List` row ("Mark read", "Pin").
    func swipeAction(
        _ title: String,
        symbol: String,
        tint: Color = .neonPurple,
        edge: HorizontalEdge = .leading,
        action: @escaping () -> Void
    ) -> some View {
        swipeActions(edge: edge, allowsFullSwipe: true) {
            Button {
                Haptic.tap()
                action()
            } label: {
                Label(title, systemImage: symbol)
            }
            .tint(tint)
        }
    }
}

struct DestructiveSwipe: ViewModifier {
    let title: String
    let symbol: String
    let confirm: String
    var message: String?
    let action: () -> Void
    @State private var asking = false

    func body(content: Content) -> some View {
        content
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                // Not `role: .destructive`: that removes the row before the
                // answer, and the answer may be Cancel.
                Button {
                    Haptic.warning()
                    asking = true
                } label: {
                    Label(title, systemImage: symbol)
                }
                .tint(.neonDanger)
            }
            .confirmDestructive(confirm, message: message, actionTitle: title, isPresented: $asking, action: action)
    }
}

// MARK: - Sheets

/// The top of a sheet: an optional icon, the title and a line under it, and
/// a close button. Pair with `.neonSheet()`.
struct SheetHeader: View {
    let title: String
    var subtitle: String?
    var symbol: String?
    var tint: Color
    var onClose: (() -> Void)?

    @Environment(\.dismiss) private var dismiss

    init(_ title: String, subtitle: String? = nil, symbol: String? = nil, tint: Color = .neonPurpleStrong, onClose: (() -> Void)? = nil) {
        self.title = title
        self.subtitle = subtitle
        self.symbol = symbol
        self.tint = tint
        self.onClose = onClose
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            if let symbol {
                IconTile(symbol, tint: tint, size: 40, style: .filled)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Color.neonInk)
                    .lineLimit(2)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.neonTextSecondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            IconButton("xmark", label: L("Close"), look: .tinted, tint: .neonInk.opacity(0.6), size: 32) {
                if let onClose { onClose() } else { dismiss() }
            }
        }
        .padding(.horizontal, NeonSpace.gutter)
        .padding(.top, 22)
        .padding(.bottom, 14)
        .accessibilityElement(children: .contain)
    }
}

/// A whole form sheet: header, scrolling fields, and a primary button pinned
/// above the keyboard that shows its own spinner while `onPrimary` runs.
///
///     SheetScaffold(L("New task"), symbol: "checklist", primaryTitle: L("Hand out"),
///                   isPrimaryEnabled: isValid) { await save() } content: { … }
struct SheetScaffold<Content: View>: View {
    let title: String
    var subtitle: String?
    var symbol: String?
    var primaryTitle: String?
    var primaryKind: NeonButtonKind
    var isPrimaryEnabled: Bool
    var onPrimary: (() async -> Void)?
    let content: Content

    init(
        _ title: String,
        subtitle: String? = nil,
        symbol: String? = nil,
        primaryTitle: String? = nil,
        primaryKind: NeonButtonKind = .primary,
        isPrimaryEnabled: Bool = true,
        onPrimary: (() async -> Void)? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.subtitle = subtitle
        self.symbol = symbol
        self.primaryTitle = primaryTitle
        self.primaryKind = primaryKind
        self.isPrimaryEnabled = isPrimaryEnabled
        self.onPrimary = onPrimary
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title, subtitle: subtitle, symbol: symbol)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    content
                }
                .padding(.horizontal, NeonSpace.gutter)
                .padding(.top, 4)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .safeAreaInset(edge: .bottom) {
            if let primaryTitle, let onPrimary {
                NeonButton(primaryTitle, kind: primaryKind) { await onPrimary() }
                    .disabled(!isPrimaryEnabled)
                    .padding(.horizontal, NeonSpace.gutter)
                    .padding(.top, 10)
                    .padding(.bottom, 8)
                    .background(
                        Rectangle()
                            .fill(.ultraThinMaterial)
                            .overlay(alignment: .top) { NeonDivider() }
                            .ignoresSafeArea()
                    )
            }
        }
        .background(NeonAmbient().ignoresSafeArea())
    }
}

extension View {
    /// The kit's sheet presentation: the given heights, a visible grabber,
    /// rounder corners and the ambient page behind (iOS 16.4+ for the last two).
    /// It also carries the app's language into the sheet — a sheet takes its
    /// layout direction from the system, not from the screen that opened it,
    /// so without this an Arabic sheet is laid out left to right.
    func neonSheet(_ detents: Set<PresentationDetent> = [.large]) -> some View {
        modifier(NeonSheetStyle(detents: detents))
    }

    /// The app's language and direction, for anything presented in a new
    /// window: `.fullScreenCover`, `.popover`. (`.neonSheet()` includes it.)
    func neonLanguage() -> some View {
        environment(\.layoutDirection, AppLanguage.current.layoutDirection)
            .environment(\.locale, AppLanguage.current.locale)
    }
}

private struct NeonSheetStyle: ViewModifier {
    let detents: Set<PresentationDetent>

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 16.4, *) {
            content
                .neonLanguage()
                .presentationDetents(detents)
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(NeonRadius.xxl)
                .presentationBackground(Color.neonBg)
        } else {
            content
                .neonLanguage()
                .presentationDetents(detents)
                .presentationDragIndicator(.visible)
        }
    }
}
