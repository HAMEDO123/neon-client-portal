import SwiftUI
import WebKit

// Same idea as the Electron desktop shell: a thin native window around the
// already-deployed, already-secured admin site. No credentials of any kind
// ship inside the app — auth is the normal cookie session, same as Safari.
private let adminURL = URL(string: "https://neon-client-portal.onrender.com/admin/login")!
private let adminHost = adminURL.host!

struct WebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView
        webView.load(URLRequest(url: adminURL))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        weak var webView: WKWebView?
        private var retryTimer: Timer?

        // Keep the app scoped to the admin site. A link to another origin
        // (or a target=_blank tap) opens in Safari instead of navigating the
        // app itself away from the admin panel.
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }
            if navigationAction.targetFrame == nil || url.host != adminHost {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        // Free-tier deploys spin down after 15 minutes idle and take up to
        // ~a minute to wake back up — retry instead of leaving a dead page.
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            scheduleRetry()
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            scheduleRetry()
        }

        private func scheduleRetry() {
            retryTimer?.invalidate()
            retryTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in
                self?.webView?.load(URLRequest(url: adminURL))
            }
        }
    }
}
