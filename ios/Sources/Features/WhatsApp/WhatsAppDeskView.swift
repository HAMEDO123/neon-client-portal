import SwiftUI
import WebKit

// The WhatsApp tab in the app is the studio's reply desk (asked for on
// 2026-11-21: "برنامج الواتس الي هسا عملناه مش مبين عالتلفون").
//
// The website's WhatsApp tab became the desk the same day — its own program in
// the Docker stack on the office PC (whatsapp-desk/), served by the platform at
// /whatsapp-desk behind the session (src/app/whatsapp-desk/[[...path]]/route.ts).
// It is a whole web app (chats, Claude's automatic replies, the brief, the
// appointment book), so the app shows that page, exactly as it shows Lead
// Finder (Features/Leads/LeadFinderView.swift): the app's token — which is the
// website's session value — goes in as the matching cookie, in a store that
// lives only as long as this screen.
//
// `WhatsAppRootView` is what every entry point opens (More, the Mac sidebar,
// Settings, the chat list), so they all show the desk. The old native inbox is
// still here as `WhatsAppInboxView`, for going back.

enum WhatsAppDesk {
    static let site = URL(string: "https://clients.neonjo.com")!
    static let home = URL(string: "https://clients.neonjo.com/whatsapp-desk/")!
    static let base = "/whatsapp-desk"

    /// The cookie the website reads for this side's session.
    static func cookie(token: String, side: Side) -> HTTPCookie? {
        HTTPCookie(properties: [
            .domain: site.host!,
            .path: "/",
            .name: side == .employee ? "employee_session" : "admin_session",
            .value: token,
            .secure: "TRUE",
            .init("HttpOnly"): "TRUE",
        ])
    }
}

struct WhatsAppRootView: View {
    var body: some View { WhatsAppDeskView() }
}

@MainActor
final class WhatsAppDeskModel: ObservableObject {
    @Published var progress: Double = 0
    weak var webView: WKWebView?

    func reload() {
        guard let webView else { return }
        if webView.url == nil { webView.load(URLRequest(url: WhatsAppDesk.home)) } else { webView.reload() }
    }
}

struct WhatsAppDeskView: View {
    @EnvironmentObject var api: APIClient
    @StateObject private var model = WhatsAppDeskModel()

    var body: some View {
        VStack(spacing: 0) {
            if model.progress > 0 && model.progress < 1 {
                ProgressView(value: model.progress)
                    .progressViewStyle(.linear)
                    .tint(Color.neonPurpleStrong)
            }
            if let token = api.token, let side = api.side {
                WhatsAppDeskWebView(model: model, token: token, side: side)
            } else {
                Spacer()
                Text(L("Sign in again to open WhatsApp."))
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextSecondary)
                Spacer()
            }
        }
        .navigationTitle(L("WhatsApp"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { model.reload() } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel(L("Reload"))
            }
        }
    }
}

private struct WhatsAppDeskWebView: UIViewRepresentable {
    let model: WhatsAppDeskModel
    let token: String
    let side: Side

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Gone when the screen closes: the session cookie is not kept anywhere.
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        context.coordinator.observe(view)
        model.webView = view

        Task { @MainActor in
            if let cookie = WhatsAppDesk.cookie(token: token, side: side) {
                await config.websiteDataStore.httpCookieStore.setCookie(cookie)
            }
            view.load(URLRequest(url: WhatsAppDesk.home))
        }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        weak var model: WhatsAppDeskModel?
        private var observations: [NSKeyValueObservation] = []

        init(model: WhatsAppDeskModel) { self.model = model }

        @MainActor func observe(_ view: WKWebView) {
            observations = [
                view.observe(\.estimatedProgress, options: [.new]) { [weak self] view, _ in
                    Task { @MainActor in self?.model?.progress = view.estimatedProgress }
                },
            ]
        }

        /// The desk's own pages stay here; a call button (tel:), the website
        /// link it sends clients, or a map opens outside the app.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.allow) }
            let ours = url.host == WhatsAppDesk.site.host && url.path.hasPrefix(WhatsAppDesk.base)
            if ours || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" || action.targetFrame?.isMainFrame == false {
                return decisionHandler(.allow)
            }
            if ["http", "https", "tel", "mailto", "whatsapp"].contains(url.scheme ?? "") {
                UIApplication.shared.open(url)
                return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }

        /// A link meant for a new tab opens in this one, or outside for other sites.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if action.targetFrame == nil, let url = action.request.url {
                if url.host == WhatsAppDesk.site.host && url.path.hasPrefix(WhatsAppDesk.base) { webView.load(action.request) } else { UIApplication.shared.open(url) }
            }
            return nil
        }

        // The page's own alert / confirm boxes (unlinking, turning automatic replies on, deleting an appointment).
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
            present(webView, title: message, cancel: nil) { _ in completionHandler() }
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
            present(webView, title: message, cancel: L("Cancel")) { completionHandler($0) }
        }

        private func present(_ webView: WKWebView, title: String, cancel: String?, done: @escaping @MainActor (Bool) -> Void) {
            guard let host = webView.window?.rootViewController?.deskTopmost else { return done(false) }
            let alert = UIAlertController(title: nil, message: title, preferredStyle: .alert)
            if let cancel { alert.addAction(UIAlertAction(title: cancel, style: .cancel) { _ in done(false) }) }
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in done(true) })
            host.present(alert, animated: true)
        }
    }
}

private extension UIViewController {
    var deskTopmost: UIViewController { presentedViewController?.deskTopmost ?? self }
}
