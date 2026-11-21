import SwiftUI
import UniformTypeIdentifiers
import WebKit

// Lead Finder in the app (asked for on 2026-11-21: "ليش الlead finder مش
// موجود بالتطبيق").
//
// Lead Finder is the studio's own client finder — a Python app on the office
// PC — and the platform serves it at /lead-finder behind the signed-in session
// (src/app/lead-finder/[[...path]]/route.ts). It is a whole web app with its
// own screens, so the app shows that page rather than rebuilding it.
//
// The page's scripts ask for "static/app.js" and "api/…" on their own, and a
// web view cannot put an Authorization header on those. So the app's token —
// which *is* the website's session value (lib/session-token.ts) — goes in as
// the matching cookie, in a store that lives only as long as this screen:
// nothing is left behind on the phone, and the route checks it exactly as it
// checks a browser's.
//
// Offered to the manager, and to whoever the manager ticked
// (`canUseLeadFinder`); the route refuses anybody else whatever the app shows.

enum LeadFinder {
    static let site = URL(string: "https://clients.neonjo.com")!
    static let home = URL(string: "https://clients.neonjo.com/lead-finder/")!
    static let base = "/lead-finder"

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

@MainActor
final class LeadFinderModel: ObservableObject {
    @Published var progress: Double = 0
    @Published var canGoBack = false
    @Published var download: URL?
    weak var webView: WKWebView?

    func reload() {
        guard let webView else { return }
        if webView.url == nil { webView.load(URLRequest(url: LeadFinder.home)) } else { webView.reload() }
    }
    func back() { webView?.goBack() }
    func home() { webView?.load(URLRequest(url: LeadFinder.home)) }
}

struct LeadFinderView: View {
    @EnvironmentObject var api: APIClient
    @StateObject private var model = LeadFinderModel()

    var body: some View {
        VStack(spacing: 0) {
            if model.progress > 0 && model.progress < 1 {
                ProgressView(value: model.progress)
                    .progressViewStyle(.linear)
                    .tint(Color.neonPurpleStrong)
            }
            if let token = api.token, let side = api.side {
                LeadFinderWebView(model: model, token: token, side: side)
            } else {
                Spacer()
                Text(L("Sign in again to open Lead Finder."))
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextSecondary)
                Spacer()
            }
        }
        .navigationTitle(L("Lead Finder"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if model.canGoBack {
                    Button { model.back() } label: { Image(systemName: "chevron.backward") }
                        .accessibilityLabel(L("Back"))
                }
                Button { model.home() } label: { Image(systemName: "house") }
                    .accessibilityLabel(L("Lead Finder"))
                Button { model.reload() } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel(L("Reload"))
            }
        }
        .sheet(item: Binding(get: { model.download.map(SharedFile.init) }, set: { if $0 == nil { model.download = nil } })) { file in
            ShareSheet(items: [file.url])
        }
    }
}

private struct SharedFile: Identifiable {
    let url: URL
    var id: String { url.path }
}

private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

private struct LeadFinderWebView: UIViewRepresentable {
    let model: LeadFinderModel
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
        view.allowsBackForwardNavigationGestures = true
        context.coordinator.observe(view)
        model.webView = view

        Task { @MainActor in
            if let cookie = LeadFinder.cookie(token: token, side: side) {
                await config.websiteDataStore.httpCookieStore.setCookie(cookie)
            }
            view.load(URLRequest(url: LeadFinder.home))
        }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        weak var model: LeadFinderModel?
        private var observations: [NSKeyValueObservation] = []
        private var destinations: [ObjectIdentifier: URL] = [:]

        init(model: LeadFinderModel) { self.model = model }

        @MainActor func observe(_ view: WKWebView) {
            observations = [
                view.observe(\.estimatedProgress, options: [.new]) { [weak self] view, _ in
                    Task { @MainActor in self?.model?.progress = view.estimatedProgress }
                },
                view.observe(\.canGoBack, options: [.new]) { [weak self] view, _ in
                    Task { @MainActor in self?.model?.canGoBack = view.canGoBack }
                },
            ]
        }

        /// Lead Finder's own pages stay here; a link anywhere else — a
        /// business's website, its Facebook page, a map — opens outside the
        /// app, where the person is already signed in to those.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.allow) }
            if action.shouldPerformDownload { return decisionHandler(.download) }
            let ours = url.host == LeadFinder.site.host && url.path.hasPrefix(LeadFinder.base)
            if ours || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" || action.targetFrame?.isMainFrame == false {
                return decisionHandler(.allow)
            }
            if ["http", "https", "tel", "mailto", "whatsapp"].contains(url.scheme ?? "") {
                UIApplication.shared.open(url)
                return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }

        /// A spreadsheet or a file the page sends as an attachment is saved
        /// and handed to the share sheet, instead of being drawn as text.
        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
            let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
            if disposition.lowercased().hasPrefix("attachment") || !response.canShowMIMEType {
                return decisionHandler(.download)
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor (URL?) -> Void) {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("lead-finder", isDirectory: true)
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent(suggestedFilename.isEmpty ? "leads" : suggestedFilename)
            try? FileManager.default.removeItem(at: url)
            destinations[ObjectIdentifier(download)] = url
            completionHandler(url)
        }

        func downloadDidFinish(_ download: WKDownload) {
            guard let url = destinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
            Task { @MainActor in self.model?.download = url }
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            destinations.removeValue(forKey: ObjectIdentifier(download))
            Task { @MainActor in Toast.error(L("The file could not be saved.")) }
        }

        /// A link meant for a new tab opens in this one.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if action.targetFrame == nil, let url = action.request.url {
                if url.host == LeadFinder.site.host { webView.load(action.request) } else { UIApplication.shared.open(url) }
            }
            return nil
        }

        // The page's own alert / confirm boxes (deleting a lead asks first).
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
            present(webView, title: message, cancel: nil) { _ in completionHandler() }
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
            present(webView, title: message, cancel: L("Cancel")) { completionHandler($0) }
        }

        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (String?) -> Void) {
            guard let host = webView.window?.rootViewController?.topmost else { return completionHandler(nil) }
            let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            alert.addTextField { $0.text = defaultText }
            alert.addAction(UIAlertAction(title: L("Cancel"), style: .cancel) { _ in completionHandler(nil) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
            host.present(alert, animated: true)
        }

        private func present(_ webView: WKWebView, title: String, cancel: String?, done: @escaping @MainActor (Bool) -> Void) {
            guard let host = webView.window?.rootViewController?.topmost else { return done(false) }
            let alert = UIAlertController(title: nil, message: title, preferredStyle: .alert)
            if let cancel { alert.addAction(UIAlertAction(title: cancel, style: .cancel) { _ in done(false) }) }
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in done(true) })
            host.present(alert, animated: true)
        }
    }
}

private extension UIViewController {
    var topmost: UIViewController { presentedViewController?.topmost ?? self }
}
