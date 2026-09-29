import Combine
import SwiftUI
import UIKit

// Calls get a window of their own, above the app's and below the kit's
// toasts. Drawn inside the app's own window, a ringing call sat *under*
// whatever sheet was open — the person never saw it ring — and the pre-join
// sheet could not open at all from a screen that was itself in a sheet (a
// sheet cannot present over a presenting one), so the call button did
// nothing. In a window of its own, nothing the app presents can cover it.
//
// The window takes every touch while something full screen is up (ringing,
// pre-join, the call); while only the minimised call or a notice floats, it
// takes the touches on those and lets every other one through to the app, as
// the kit's toast window does. With nothing to show it is hidden.

@MainActor
final class CallWindow {
    static let shared = CallWindow()

    private var window: CallPassthroughWindow?
    private var host: CallHostingController?
    private var observer: AnyCancellable?
    private var hideTask: Task<Void, Never>?
    /// Where the floating pieces are, in window coordinates.
    private var frames: [String: CGRect] = [:]

    private enum Presence { case none, floating, covering }

    func attach() {
        guard observer == nil else { return }
        // objectWillChange fires before the change lands; reading on the next
        // turn of the run loop sees the new state.
        observer = CallCenter.shared.objectWillChange
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.refresh() }
        refresh()
    }

    func detach() {
        observer = nil
        hideTask?.cancel()
        releaseKey()
        window?.isHidden = true
        window = nil
        host = nil
        frames = [:]
    }

    func setFrame(_ id: String, _ frame: CGRect?) {
        frames[id] = frame
    }

    private var presence: Presence {
        let center = CallCenter.shared
        if center.prejoinRequest != nil || center.ringingCall != nil || (center.session != nil && center.viewMode == .full) {
            return .covering
        }
        if center.session != nil || center.notice != nil { return .floating }
        return .none
    }

    private func refresh() {
        let now = presence
        guard now != .none else {
            window?.covering = false
            host?.covering = false
            releaseKey()
            // Hidden only once the closing animation has had its time.
            hideTask?.cancel()
            hideTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 700_000_000)
                guard !Task.isCancelled, let self, self.presence == .none else { return }
                self.window?.isHidden = true
            }
            return
        }
        hideTask?.cancel()
        installIfNeeded()
        guard let window else { return }
        window.covering = now == .covering
        host?.covering = now == .covering
        if window.isHidden { window.isHidden = false }
        if now == .covering {
            if !window.isKeyWindow { window.makeKey() }
        } else {
            releaseKey()
        }
    }

    /// Gives the keyboard and VoiceOver back to the app's own window.
    private func releaseKey() {
        guard let window, window.isKeyWindow else { return }
        window.windowScene?.windows
            .first { $0 !== window && $0.windowLevel == .normal && !$0.isHidden }?
            .makeKey()
    }

    private func installIfNeeded() {
        if let window, window.windowScene != nil { return }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first else { return }
        let window = CallPassthroughWindow(windowScene: scene)
        window.windowLevel = .normal + 1
        window.backgroundColor = .clear
        window.overrideUserInterfaceStyle = .light
        window.floatingFrames = { [weak self] in self.map { Array($0.frames.values) } ?? [] }
        let host = CallHostingController(rootView: CallWindowRoot(center: .shared, onFrame: { [weak self] id, frame in
            self?.setFrame(id, frame)
        }))
        host.view.backgroundColor = .clear
        window.rootViewController = host
        window.isHidden = true
        self.window = window
        self.host = host
    }
}

final class CallPassthroughWindow: UIWindow {
    var covering = false
    var floatingFrames: () -> [CGRect] = { [] }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        if covering || rootViewController?.presentedViewController != nil {
            return super.hitTest(point, with: event)
        }
        guard floatingFrames().contains(where: { $0.insetBy(dx: -6, dy: -6).contains(point) }) else { return nil }
        return super.hitTest(point, with: event)
    }
}

final class CallHostingController: UIHostingController<CallWindowRoot> {
    var covering = false {
        didSet {
            guard covering != oldValue else { return }
            setNeedsStatusBarAppearanceUpdate()
            view.accessibilityViewIsModal = covering
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { covering ? .lightContent : .darkContent }
}

/// Everything calls put on screen, in the order it stacks: the call (full or
/// minimised), the pre-join screen, a ringing call on top of all of it, and
/// a notice when there is no call to carry it.
struct CallWindowRoot: View {
    @ObservedObject var center: CallCenter
    let onFrame: (String, CGRect?) -> Void

    var body: some View {
        ZStack {
            if let session = center.session {
                let call = center.calls.first { $0.id == session.callId }
                if center.viewMode == .full {
                    CallScreenView(center: center, session: session, call: call, me: center.me ?? session.me)
                        .transition(.asymmetric(insertion: .opacity.combined(with: .scale(scale: 1.04)), removal: .opacity))
                        .zIndex(1)
                } else {
                    CallFloatingWindow(center: center, session: session, call: call) { onFrame("mini", $0) }
                        .transition(.opacity)
                        .onDisappear { onFrame("mini", nil) }
                        .zIndex(2)
                }
            }

            if let request = center.prejoinRequest {
                PreJoinView(
                    request: request,
                    onCancel: { center.cancelPreJoin() },
                    onConfirm: { media, mic, camera, muted, problem in
                        await center.confirmPreJoin(media: media, mic: mic, camera: camera, audioMuted: muted, problem: problem)
                    }
                )
                .id(request.id)
                .transition(.move(edge: .bottom))
                .zIndex(3)
            }

            if let ringing = center.ringingCall {
                IncomingCallView(
                    call: ringing, inCall: center.session != nil, answering: center.answering,
                    onAccept: { video in Task { await center.accept(ringing, video: video) } },
                    onDecline: { center.decline(ringing) }
                )
                .id(ringing.id)
                .transition(.opacity)
                .zIndex(4)
            }

            if center.session == nil, center.prejoinRequest == nil, center.ringingCall == nil, let notice = center.notice {
                VStack {
                    Spacer()
                    CallNoticeBanner(
                        text: notice,
                        actionTitle: callNoticeOpensSettings(notice) ? L("Open Settings") : nil,
                        action: callNoticeOpensSettings(notice) ? { openCallSettings() } : nil,
                        onDismiss: { center.dismissNotice() }
                    )
                    .background(
                        GeometryReader { proxy in
                            Color.clear
                                .onAppear { onFrame("notice", proxy.frame(in: .global)) }
                                .onChange(of: proxy.frame(in: .global)) { onFrame("notice", $0) }
                        }
                    )
                    .onDisappear { onFrame("notice", nil) }
                    .padding(.horizontal, NeonSpace.gutter)
                    .padding(.bottom, 96)
                }
                .transition(.neonRise)
                .zIndex(5)
            }
        }
        .animation(NeonMotion.smooth, value: center.session != nil)
        .animation(NeonMotion.smooth, value: center.viewMode)
        .animation(NeonMotion.smooth, value: center.prejoinRequest?.id)
        .animation(NeonMotion.smooth, value: center.ringingCall?.id)
        .animation(NeonMotion.smooth, value: center.notice)
        .neonLanguage()
        .environmentObject(APIClient.shared)
        .tint(.neonPurpleStrong)
    }
}
