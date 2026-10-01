import SwiftUI
import WebKit

// The office's shared shop cart: the supermarket's own website (Yaser Mall),
// in a web view, signed in to ONE office account on every phone. Everybody
// adds to the same cart — the cart lives at the shop, on that account — and
// only the manager orders.
//
// The shop signs in with a phone number and an SMS code, and keeps the result
// as a token in local storage ("wk_token") — there is no password to share.
// So the manager signs in once, on their own phone where the SMS arrives, and
// presses "Share with the office": the shop's cookies and local-storage
// entries go to the server (`me/shopping/share`, sealed there). Every team
// member's phone puts them back before it opens the shop (`me/shopping/
// session`, read without ever touching the disk cache) and is already in.
// Everybody on the team holds that sign-in: the studio chose that, knowing
// it, and every fetch is recorded against whoever asked.
//
// Ordering is blocked on a team member's phone three ways, because the shop's
// site is not ours and any one of them can miss: a checkout-looking button is
// not let through, an in-page route to checkout is refused, and a request that
// would place an order is not sent (`OfficeShop.script`). With every phone on
// an account that could order, that block carries the rule.
//
// "Who added what" is read the same best-effort way: a successful write to the
// shop's cart is reported with the name of the product last tapped, and the
// manager is told (`me/shopping/added`).

enum OfficeShop {
    static let home = URL(string: "https://www.yasermallonline.com/")!
    static let name = "Yaser Mall"

    /// Paths and API addresses that place or pay for an order. Tuned against
    /// the real site once it has been tried; kept here so that is one edit.
    static let checkoutPattern = #"(check-?out|payment|pay-?now|(place|confirm|submit|create|add)-?order|order\/(create|place|submit|confirm))"#
    /// Button wording that leads to ordering, English and Arabic.
    static let checkoutTextPattern = #"(checkout|check out|place order|confirm order|proceed to (checkout|payment)|pay now|complete order|إتمام الطلب|اتمام الطلب|تأكيد الطلب|تاكيد الطلب|إتمام الشراء|اتمام الشراء|الدفع|ادفع|اطلب الآن|اطلب الان|تثبيت الطلب|إرسال الطلب|ارسال الطلب)"#
    /// What counts as the cart, in an address or a label.
    static let cartPattern = #"(cart|basket|سلة|السلة)"#

    static func script(isManager: Bool) -> String {
        """
        (function () {
          if (window.__neonShop) return; window.__neonShop = true;
          var isManager = \(isManager ? "true" : "false");
          var post = function (m) { try { window.webkit.messageHandlers.neonShop.postMessage(m); } catch (e) {} };
          var CHECKOUT = new RegExp(\(jsString(checkoutPattern)), "i");
          var CHECKOUT_TEXT = new RegExp(\(jsString(checkoutTextPattern)), "i");
          var CART = new RegExp(\(jsString(cartPattern)), "i");
          var lastLabel = null;

          // The product somebody tapped last: the first real line of text in
          // the nearest card around the tap that has a picture.
          function labelNear(el) {
            var node = el;
            for (var i = 0; i < 7 && node; i++, node = node.parentElement) {
              if (node.querySelector && node.querySelector("img")) {
                var lines = (node.innerText || "").split("\\n").map(function (s) { return s.trim(); }).filter(function (s) {
                  return s.length > 2 && !/^[\\d.,\\s+-]+$/.test(s) && !/(JOD|JD|د\\.أ|دينار)/i.test(s) && !CART.test(s);
                });
                if (lines.length) return lines[0];
              }
            }
            return null;
          }

          document.addEventListener("click", function (e) {
            var el = e.target;
            var label = labelNear(el);
            if (label) lastLabel = label;
            if (isManager) return;
            var button = el.closest ? el.closest("button, a, [role=button]") : null;
            var text = ((button || el).innerText || "").slice(0, 60);
            if (CHECKOUT_TEXT.test(text)) {
              e.preventDefault(); e.stopImmediatePropagation();
              post({ type: "blocked" });
            }
          }, true);

          function isCheckoutURL(url) {
            try { var u = new URL(url, location.href); return CHECKOUT.test(u.pathname + u.search + u.hash); } catch (e) { return false; }
          }

          if (!isManager) {
            ["pushState", "replaceState"].forEach(function (name) {
              var original = history[name];
              history[name] = function (state, title, url) {
                if (url && isCheckoutURL(url)) { post({ type: "blocked" }); return; }
                return original.apply(this, arguments);
              };
            });
          }

          function verdict(method, url) {
            if (!/^(POST|PUT|PATCH)$/i.test(method || "GET")) return "ok";
            if (CART.test(url)) return "cart";
            if (!isManager && CHECKOUT.test(url)) return "block";
            return "ok";
          }

          var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.open = function (method, url) {
            this.__neon = verdict(method, String(url));
            return open.apply(this, arguments);
          };
          XMLHttpRequest.prototype.send = function () {
            var xhr = this;
            if (xhr.__neon === "block") { post({ type: "blocked" }); xhr.abort(); return; }
            if (xhr.__neon === "cart") {
              xhr.addEventListener("load", function () {
                if (xhr.status >= 200 && xhr.status < 300) post({ type: "added", label: lastLabel });
              });
            }
            return send.apply(this, arguments);
          };

          if (window.fetch) {
            var originalFetch = window.fetch;
            window.fetch = function (input, init) {
              var url = typeof input === "string" ? input : (input && input.url) || "";
              var method = (init && init.method) || (input && input.method) || "GET";
              var v = verdict(method, url);
              if (v === "block") { post({ type: "blocked" }); return Promise.reject(new Error("Ordering is the manager's.")); }
              var answer = originalFetch.apply(this, arguments);
              if (v === "cart") answer.then(function (r) { if (r.ok) post({ type: "added", label: lastLabel }); }).catch(function () {});
              return answer;
            };
          }
        })();
        """
    }

    private static func jsString(_ value: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [value])
        let array = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(array.dropFirst().dropLast())
    }

    /// Only the shop's own pages are ever written into — never a payment
    /// provider or anything a redirect lands on.
    static func isShopPage(_ url: URL?) -> Bool {
        guard let host = url?.host?.lowercased(), let shop = home.host?.lowercased() else { return false }
        let bare = shop.hasPrefix("www.") ? String(shop.dropFirst(4)) : shop
        return host == shop || host == bare || host.hasSuffix("." + bare)
    }

    static func isShopCookie(_ cookie: HTTPCookie) -> Bool {
        guard let shop = home.host?.lowercased() else { return false }
        let bare = shop.hasPrefix("www.") ? String(shop.dropFirst(4)) : shop
        let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return domain == bare || domain.hasSuffix("." + bare)
    }

    /// Is the shop asking this phone to sign in? Its sign-in is a phone-number
    /// box under "تسجيل دخول أو إنشاء حساب جديد" (or `?showLogin=true`).
    static let signedOutScript = """
    (function () {
      var visible = function (el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); };
      if (/[?&]showLogin=true/.test(location.search)) return true;
      var phone = Array.prototype.some.call(document.querySelectorAll("input"), function (i) {
        return visible(i) && (i.type === "tel" || /(هاتف|phone|mobile|جوال)/i.test(i.placeholder || ""));
      });
      return phone && /(تسجيل دخول|تسجيل الدخول|sign ?in|log ?in)/i.test(document.body ? document.body.innerText : "");
    })();
    """

    /// The shop's local-storage entries, on the manager's phone, to share.
    static let readStorageScript = """
    (function () {
      var items = [];
      for (var i = 0; i < localStorage.length && i < 50; i++) {
        var key = localStorage.key(i);
        items.push({ origin: location.origin, key: key, value: localStorage.getItem(key) });
      }
      return JSON.stringify(items);
    })();
    """

    /// Puts the shared entries back on the page's own origin before its code
    /// runs — every load, so the office stays signed in on this phone even if
    /// somebody presses the shop's own "log out".
    static func restoreStorageScript(_ items: [OfficeShopStorageItem]) -> String {
        let json = (try? JSONEncoder().encode(items)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        return """
        (function () {
          var items = \(json);
          items.forEach(function (item) {
            if (item.origin !== location.origin) return;
            try { if (localStorage.getItem(item.key) !== item.value) localStorage.setItem(item.key, item.value); } catch (e) {}
          });
        })();
        """
    }

    static func isCheckout(_ url: URL) -> Bool {
        let text = url.path + "?" + (url.query ?? "") + "#" + (url.fragment ?? "")
        return text.range(of: checkoutPattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
}

struct OfficeShopStorageItem: Codable, Equatable {
    let origin: String
    let key: String
    let value: String
}

struct OfficeShopCookie: Codable {
    let name: String
    let value: String
    let domain: String
    let path: String
    /// Seconds since the epoch, or nil for a cookie that dies with the session.
    let expires: Double?
    let secure: Bool
    let httpOnly: Bool

    init(_ cookie: HTTPCookie) {
        name = cookie.name
        value = cookie.value
        domain = cookie.domain
        path = cookie.path
        expires = cookie.expiresDate?.timeIntervalSince1970
        secure = cookie.isSecure
        httpOnly = cookie.isHTTPOnly
    }

    var httpCookie: HTTPCookie? {
        var properties: [HTTPCookiePropertyKey: Any] = [.name: name, .value: value, .domain: domain, .path: path.isEmpty ? "/" : path]
        if let expires { properties[.expires] = Date(timeIntervalSince1970: expires) }
        if secure { properties[.secure] = "TRUE" }
        if httpOnly { properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
        return HTTPCookie(properties: properties)
    }

    var asJSON: [String: Any] {
        var object: [String: Any] = ["name": name, "value": value, "domain": domain, "path": path, "secure": secure, "httpOnly": httpOnly]
        object["expires"] = expires ?? NSNull()
        return object
    }
}

private struct OfficeShopSessionAnswer: Decodable {
    struct Session: Decodable {
        let cookies: [OfficeShopCookie]
        let storage: [OfficeShopStorageItem]?
        let site: String?
    }
    let session: Session?
    let why: String?
}

@MainActor
final class OfficeShopModel: ObservableObject {
    @Published var progress: Double = 0
    @Published var canGoBack = false
    @Published var canGoForward = false
    /// The server's own sentence when the office hasn't shared a sign-in —
    /// shown where the shop would be, with nothing to retry.
    @Published var blocker: String?
    /// The shop is asking a team member's phone to sign in: the shared
    /// sign-in has run out, or the office was signed out.
    @Published var signedOut = false
    @Published var sharing = false
    weak var webView: WKWebView?

    /// Fetched at most once per run of the app: every fetch is recorded.
    private static var sessionThisRun: OfficeShopSessionAnswer.Session?

    // MARK: - A team member's phone

    /// Puts the office's shared sign-in into this phone's shop before the
    /// first page loads, then opens the shop.
    func prepareAndLoad(_ webView: WKWebView) async {
        var session = Self.sessionThisRun
        if session == nil {
            do {
                let answer = try await APIClient.shared.readFresh("me/shopping/session", as: OfficeShopSessionAnswer.self)
                guard let shared = answer.session else {
                    blocker = answer.why ?? L("The office isn't signed in to the shop yet. Ask the manager to sign in and share it.")
                    return
                }
                session = shared
                Self.sessionThisRun = shared
            } catch {
                // Offline or refused: whatever this phone kept from last time
                // may still be signed in — open the shop and let it say.
                webView.load(URLRequest(url: OfficeShop.home))
                return
            }
        }
        guard let session else { return }

        let store = webView.configuration.websiteDataStore.httpCookieStore
        for cookie in session.cookies.compactMap(\.httpCookie) {
            await store.setCookie(cookie)
        }
        let storage = session.storage ?? []
        if !storage.isEmpty {
            webView.configuration.userContentController.addUserScript(
                WKUserScript(source: OfficeShop.restoreStorageScript(storage), injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
        }
        let site = session.site.flatMap(URL.init(string:)).flatMap { OfficeShop.isShopPage($0) ? $0 : nil } ?? OfficeShop.home
        webView.load(URLRequest(url: site))
    }

    /// After a page has drawn: is the shop asking this phone to sign in?
    func checkSignedOut() async {
        guard let webView, OfficeShop.isShopPage(webView.url) else { return }
        let asking = (try? await webView.evaluateJavaScript(OfficeShop.signedOutScript) as? Bool) ?? false
        if asking != signedOut { withNeonAnimation(NeonMotion.snappy) { signedOut = asking } }
    }

    // MARK: - The manager's phone

    /// Hands this phone's shop sign-in to the office: the shop's cookies and
    /// its local-storage entries (where the sign-in token lives). Says how
    /// much went, because a share that sent nothing is the failure nobody
    /// would notice until the team could not shop.
    func shareWithOffice() async {
        guard let webView, OfficeShop.isShopPage(webView.url), !sharing else {
            Toast.info(L("Open the shop first"))
            return
        }
        sharing = true
        defer { sharing = false }

        if (try? await webView.evaluateJavaScript(OfficeShop.signedOutScript) as? Bool) == true {
            Toast.info(L("Sign in to the shop first"), detail: L("Use the office phone number and the code the shop sends by SMS, then share."))
            return
        }

        let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
            .filter(OfficeShop.isShopCookie)
            .map(OfficeShopCookie.init)
        var storage: [[String: String]] = []
        if let json = try? await webView.evaluateJavaScript(OfficeShop.readStorageScript) as? String,
           let data = json.data(using: .utf8),
           let items = try? JSONDecoder().decode([OfficeShopStorageItem].self, from: data) {
            storage = items.filter { !$0.key.isEmpty }.map { ["origin": $0.origin, "key": $0.key, "value": $0.value] }
        }
        guard !cookies.isEmpty || !storage.isEmpty else {
            Toast.info(L("Sign in to the shop first"))
            return
        }

        struct Shared: Decodable { let cookies: Int?; let storage: Int? }
        do {
            let outcome = try await APIClient.shared.perform(
                "me/shopping/share",
                args: [cookies.map(\.asJSON), OfficeShop.home.absoluteString, storage]
            )
            let shared = try? outcome.result(Shared.self)
            Haptic.success()
            Toast.success(
                L("Shared with the office"),
                detail: L("%d cookies and %d saved items — every phone opens the shop signed in.", shared?.cookies ?? cookies.count, shared?.storage ?? storage.count)
            )
        } catch {
            Toast.error(error)
        }
    }
}

struct OfficeShoppingView: View {
    @EnvironmentObject var api: APIClient
    @StateObject private var model = OfficeShopModel()
    @AppStorage("office_shop_hint_seen") private var hintSeen = false

    private var isManager: Bool { api.side != .employee }

    var body: some View {
        VStack(spacing: 0) {
            if !hintSeen {
                hint
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
            if model.signedOut && !isManager {
                HStack(spacing: 10) {
                    Image(systemName: "person.crop.circle.badge.exclamationmark")
                        .foregroundStyle(Color.neonWarningStrong)
                    Text(L("The office is signed out of the shop. Ask the manager to sign in and share it again."))
                        .font(.neonFootnote)
                        .foregroundStyle(Color.neonInk)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(12)
                .background(Color.neonAmber.opacity(0.14))
                .transition(.move(edge: .top).combined(with: .opacity))
            }
            ZStack(alignment: .top) {
                OfficeShopWebView(model: model, isManager: isManager, onAdded: reportAdded)
                if model.progress > 0 && model.progress < 1 {
                    ProgressView(value: model.progress)
                        .progressViewStyle(.linear)
                        .tint(.neonPurpleStrong)
                }
                if let blocker = model.blocker {
                    // Where the shop would be: nothing on this phone fixes
                    // it, and the sentence already says who can.
                    VStack(spacing: NeonSpace.md) {
                        IconTile("cart.badge.questionmark", hue: .amber, size: 56, style: .soft)
                        Text(blocker).font(.neonHeadline).multilineTextAlignment(.center)
                    }
                    .padding(NeonSpace.xl)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.neonBg)
                }
                if model.sharing {
                    Label(L("Sharing with the office…"), systemImage: "person.2.fill")
                        .font(.neonLabel)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.top, 12)
                }
            }
        }
        .navigationTitle(L("Office shopping"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                Button { model.webView?.goBack() } label: { Image(systemName: "chevron.backward") }
                    .disabled(!model.canGoBack)
                    .accessibilityLabel(L("Back"))
                Button { model.webView?.load(URLRequest(url: OfficeShop.home)) } label: { Image(systemName: "house") }
                    .accessibilityLabel(L("Shop home"))
                Button { model.webView?.reload() } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel(L("Reload"))
                if isManager {
                    Button { Task { await model.shareWithOffice() } } label: { Image(systemName: "person.2.badge.key") }
                        .disabled(model.sharing)
                        .accessibilityLabel(L("Share with the office"))
                }
            }
        }
    }

    private var hint: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "cart.fill")
                .foregroundStyle(Color.neonSuccessStrong)
                .font(.system(size: 18, weight: .semibold))
            VStack(alignment: .leading, spacing: 3) {
                Text(isManager ? L("One cart for the whole office") : L("Add what the office needs"))
                    .font(.neonLabel)
                    .foregroundStyle(Color.neonInk)
                Text(isManager
                     ? L("Sign in here once with the office phone number and the SMS code, then press Share with the office (the people button above) — every employee's phone opens the shop already signed in. Everybody adds to this cart; only you place the order.")
                     : L("Everybody adds to the same cart. The manager checks it and places the order."))
                    .font(.neonFootnote)
                    .foregroundStyle(Color.neonTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Button {
                withNeonAnimation(NeonMotion.snappy) { hintSeen = true }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color.neonTextTertiary)
                    .frame(width: 32, height: 32)
            }
            .accessibilityLabel(L("Dismiss"))
        }
        .padding(12)
        .background(Color.neonSuccess.opacity(0.10))
    }

    private func reportAdded(_ label: String?) {
        guard !isManager else { return }
        Task { _ = try? await api.perform("me/shopping/added", args: [label ?? ""]) }
    }
}

private struct OfficeShopWebView: UIViewRepresentable {
    let model: OfficeShopModel
    let isManager: Bool
    let onAdded: (String?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(isManager: isManager, model: model, onAdded: onAdded) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // The default store keeps the shop's sign-in on this phone between
        // visits, so the manager signs the office account in once.
        config.websiteDataStore = .default()
        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(source: OfficeShop.script(isManager: isManager), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        controller.add(context.coordinator, name: "neonShop")
        config.userContentController = controller

        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        context.coordinator.observe(view, model: model)
        model.webView = view
        if isManager {
            view.load(URLRequest(url: OfficeShop.home))
        } else {
            // The office's sign-in goes in first, so the very first page the
            // shop draws is already signed in.
            Task { @MainActor in await model.prepareAndLoad(view) }
        }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "neonShop")
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let isManager: Bool
        weak var model: OfficeShopModel?
        let onAdded: (String?) -> Void
        private var observations: [NSKeyValueObservation] = []

        init(isManager: Bool, model: OfficeShopModel, onAdded: @escaping (String?) -> Void) {
            self.isManager = isManager
            self.model = model
            self.onAdded = onAdded
        }

        /// On a team member's phone, once a page has drawn: is the shop
        /// asking it to sign in? Then the shared sign-in has run out.
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard !isManager else { return }
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                await self?.model?.checkSignedOut()
            }
        }

        @MainActor func observe(_ view: WKWebView, model: OfficeShopModel) {
            observations = [
                view.observe(\.estimatedProgress, options: [.new]) { [weak model] view, _ in
                    Task { @MainActor in model?.progress = view.estimatedProgress }
                },
                view.observe(\.canGoBack, options: [.new]) { [weak model] view, _ in
                    Task { @MainActor in model?.canGoBack = view.canGoBack }
                },
            ]
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            Task { @MainActor in
                switch type {
                case "blocked":
                    Haptic.warning()
                    Toast.info(L("Only the manager places the order"), detail: L("Add what you need — the manager will check the cart and order it."))
                case "added":
                    self.onAdded(body["label"] as? String)
                default:
                    break
                }
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            if !isManager, let url = action.request.url, OfficeShop.isCheckout(url) {
                Task { @MainActor in
                    Haptic.warning()
                    Toast.info(L("Only the manager places the order"))
                }
                decisionHandler(.cancel)
                return
            }
            // Links that leave the shop (a phone number, WhatsApp, a map)
            // open where they belong instead of inside the web view.
            if let url = action.request.url, let scheme = url.scheme, !["http", "https", "about", "blob", "data"].contains(scheme) {
                Task { @MainActor in UIApplication.shared.open(url) }
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
