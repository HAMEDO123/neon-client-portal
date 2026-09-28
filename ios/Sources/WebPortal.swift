import SwiftUI
import WebKit

/// A page of the studio's own website, opened inside the app and already
/// signed in — for what the phone API cannot do yet: calls, the task board,
/// reviewing proof, answering a meeting.
///
/// It is not a copy of anything. The token the app holds is the very value the
/// website keeps in its session cookie (both come from `createSessionToken` /
/// `createEmployeeSessionToken` in src/lib/auth.ts), so handing it to the page
/// as that cookie is the same person, signed in the same way. The page runs on
/// the website's own origin, so the website's own checks apply unchanged.
///
/// The cookie lives in a non-persistent store: it is gone when the page
/// closes, and signing out of the app leaves nothing behind in a browser.
struct WebPortalLink: Identifiable {
    let id = UUID()
    let path: String
    let title: String
    /// One line above the page, saying what to do there.
    var hint: String?
}

extension Identity {
    /// Where this side's pages live on the website.
    var webRoot: String { side == .admin ? "/admin" : "/employee" }

    func webChatPath(_ slug: String, query: String? = nil) -> String {
        "\(webRoot)/chat/\(slug)" + (query.map { "?\($0)" } ?? "")
    }
}

struct WebPortalSheet: View {
    let link: WebPortalLink

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var loading = true

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let hint = link.hint {
                    HStack(spacing: 8) {
                        Image(systemName: "info.circle")
                        Text(hint)
                    }
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.neonCyanStrong)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.neonCyan.opacity(0.1))
                }
                ZStack {
                    if let token = api.token, let identity = api.identity {
                        WebPortalView(path: link.path, token: token, side: identity.side, loading: $loading)
                    }
                    if loading {
                        ProgressView().controlSize(.large)
                    }
                }
            }
            .navigationTitle(link.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Close")) { dismiss() }
                }
            }
        }
    }
}

struct WebPortalView: UIViewRepresentable {
    let path: String
    let token: String
    let side: Side
    @Binding var loading: Bool

    func makeCoordinator() -> Coordinator { Coordinator(loading: $loading) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        // Calls: sound and pictures play in the page, and nothing waits for a tap.
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true

        let url = URL(string: path, relativeTo: portalOrigin)!.absoluteURL
        if let cookie = sessionCookie() {
            webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) {
                webView.load(URLRequest(url: url))
            }
        } else {
            webView.load(URLRequest(url: url))
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    /// The website's own session cookie, with the token as its value — the
    /// same name and attributes `auth-actions.ts` sets on a browser.
    private func sessionCookie() -> HTTPCookie? {
        HTTPCookie(properties: [
            .domain: portalOrigin.host ?? "clients.neonjo.com",
            .path: "/",
            .name: side == .admin ? "admin_session" : "employee_session",
            .value: token,
            .secure: "TRUE",
            .sameSitePolicy: HTTPCookieStringPolicy.sameSiteLax,
            HTTPCookiePropertyKey("HttpOnly"): "TRUE",
        ])
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        @Binding var loading: Bool

        init(loading: Binding<Bool>) {
            _loading = loading
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            loading = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            loading = false
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            loading = false
        }

        /// The studio's pages stay in here; anything else — a WhatsApp link, a
        /// file on storage — goes to the phone's own apps.
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
            if url.host == portalOrigin.host || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" {
                return decisionHandler(.allow)
            }
            if navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil {
                UIApplication.shared.open(url)
                return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }

        /// A link meant for a new window opens in this one.
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = navigationAction.request.url {
                if url.host == portalOrigin.host {
                    webView.load(navigationAction.request)
                } else {
                    UIApplication.shared.open(url)
                }
            }
            return nil
        }

        /// The microphone and camera for a call, for the studio's own pages
        /// only. iOS still asks the person the first time.
        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            decisionHandler(origin.host == portalOrigin.host ? .grant : .deny)
        }

        // Alerts and confirmations the page raises ("Delete this?") need a
        // native dialog, or WebKit answers them silently.
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            present(on: webView, message: message, confirm: false) { _ in completionHandler() }
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            present(on: webView, message: message, confirm: true, completion: completionHandler)
        }

        private func present(on webView: WKWebView, message: String, confirm: Bool, completion: @escaping (Bool) -> Void) {
            guard let host = webView.window?.rootViewController?.topmost else { return completion(!confirm) }
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            if confirm {
                alert.addAction(UIAlertAction(title: L("Cancel"), style: .cancel) { _ in completion(false) })
            }
            alert.addAction(UIAlertAction(title: L("OK"), style: .default) { _ in completion(true) })
            host.present(alert, animated: true)
        }
    }
}

private extension UIViewController {
    var topmost: UIViewController {
        presentedViewController?.topmost ?? self
    }
}
