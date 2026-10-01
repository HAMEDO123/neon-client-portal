import SwiftUI
import WebKit

// The office's shared shop cart: the supermarket's own website (Yaser Mall),
// in a web view, signed in to ONE office account on every phone. Everybody
// adds to the same cart — the cart lives at the shop, on that account — and
// only the manager orders.
//
// The office account is set once, centrally — the manager types it on the
// website's Settings ("The office shop account") — and a team member's phone
// signs itself in with it (`me/shopping/account`, read only when the shop's
// sign-in is showing, never written to disk). That means everybody on the
// team can read the password: the studio chose that, knowing it, and every
// fetch is recorded against whoever asked. The manager's own phone signs in
// by hand once (the web view keeps its cookies).
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

    /// Only the shop's own pages are ever typed into — never a payment
    /// provider or anything a redirect lands on.
    static func isShopPage(_ url: URL?) -> Bool {
        guard let host = url?.host?.lowercased(), let shop = home.host?.lowercased() else { return false }
        let bare = shop.hasPrefix("www.") ? String(shop.dropFirst(4)) : shop
        return host == shop || host == bare || host.hasSuffix("." + bare)
    }

    /// Is the shop asking somebody to sign in? A visible password field, or a
    /// visible "sign in" control. Found, never assumed: the shop's own page.
    static let detectScript = """
    (function () {
      var visible = function (el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); };
      var password = Array.prototype.some.call(document.querySelectorAll("input[type=password]"), visible);
      var SIGN_IN = /^(sign ?in|log ?in|login|تسجيل الدخول|تسجيل دخول|دخول)$/i;
      var signIn = Array.prototype.some.call(document.querySelectorAll("a, button, [role=button]"), function (el) {
        return visible(el) && SIGN_IN.test((el.innerText || "").trim());
      });
      return JSON.stringify({ password: password, signIn: signIn });
    })();
    """

    /// Opens the shop's sign-in, by pressing its own "sign in" control.
    static let openSignInScript = """
    (function () {
      var visible = function (el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); };
      var SIGN_IN = /^(sign ?in|log ?in|login|تسجيل الدخول|تسجيل دخول|دخول)$/i;
      var el = Array.prototype.find.call(document.querySelectorAll("a, button, [role=button]"), function (el) {
        return visible(el) && SIGN_IN.test((el.innerText || "").trim());
      });
      if (el) { el.click(); return true; }
      return false;
    })();
    """

    /// Fills the shop's sign-in form and presses its button. Run with
    /// `callAsyncJavaScript`, so the email and password are arguments — never
    /// pasted into the script's text. Typed the way a person types (input and
    /// change events), which is what a framework form listens for.
    static let fillScript = """
    var visible = function (el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); };
    var inputs = Array.prototype.filter.call(document.querySelectorAll("input"), visible);
    var secret = inputs.find(function (i) { return i.type === "password"; });
    if (!secret) return "no-password-field";
    var describes = function (i) { return [i.name, i.id, i.placeholder, i.getAttribute("formcontrolname"), i.getAttribute("aria-label"), i.autocomplete].join(" "); };
    var who = inputs.find(function (i) { return i !== secret && (i.type === "email" || /(mail|user|login|phone|mobile|بريد|هاتف|جوال|موبايل)/i.test(describes(i))); })
      || inputs.filter(function (i) { return i !== secret && ["text", "email", "tel", ""].indexOf(i.type) >= 0; }).pop();
    if (!who) return "no-account-field";
    var type = function (el, value) {
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      el.focus();
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    };
    type(who, email);
    type(secret, password);
    var SUBMIT = /(sign ?in|log ?in|login|تسجيل الدخول|تسجيل دخول|دخول|متابعة|continue)/i;
    var form = secret.form;
    var button = (form && form.querySelector("button[type=submit], input[type=submit]"))
      || Array.prototype.filter.call(document.querySelectorAll("button, [role=button], input[type=submit]"), visible)
        .find(function (b) { return SUBMIT.test(b.innerText || b.value || ""); });
    if (button) { setTimeout(function () { button.click(); }, 250); return "submitted"; }
    if (form && form.requestSubmit) { form.requestSubmit(); return "submitted"; }
    return "filled";
    """

    static func isCheckout(_ url: URL) -> Bool {
        let text = url.path + "?" + (url.query ?? "") + "#" + (url.fragment ?? "")
        return text.range(of: checkoutPattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
}

struct OfficeShopAccount: Decodable, Equatable {
    let email: String
    let password: String
    let site: String?
}

private struct OfficeShopAccountAnswer: Decodable {
    let account: OfficeShopAccount?
    let why: String?
}

@MainActor
final class OfficeShopModel: ObservableObject {
    @Published var progress: Double = 0
    @Published var canGoBack = false
    @Published var canGoForward = false
    /// The server's own sentence when there is no account to sign in with —
    /// shown where the shop would be, with nothing to retry.
    @Published var blocker: String?
    /// The form could not be filled: the account, for signing in by hand.
    @Published var manual: OfficeShopAccount?
    @Published var signingIn = false
    weak var webView: WKWebView?

    /// Held in memory for this run of the app only, and fetched at most once
    /// per run without being asked: every fetch is recorded on the server.
    private static var account: OfficeShopAccount?
    private static var triedThisRun = false

    /// Signs this phone in to the office shop when the shop asks for it.
    /// `force` is the person pressing "Sign in".
    func signIn(force: Bool) async {
        guard let webView, OfficeShop.isShopPage(webView.url), !signingIn else { return }
        if !force && Self.triedThisRun { return }

        let state = await detect(webView)
        if !force && !state.password && !state.signIn { return } // already signed in
        Self.triedThisRun = true
        signingIn = true
        defer { signingIn = false }

        if Self.account == nil {
            do {
                let answer = try await APIClient.shared.readFresh("me/shopping/account", as: OfficeShopAccountAnswer.self)
                guard let account = answer.account else {
                    blocker = answer.why ?? L("The office shop account isn't set up yet. Ask the manager.")
                    return
                }
                Self.account = account
            } catch {
                Toast.error(error)
                return
            }
        }
        guard let account = Self.account else { return }

        if !state.password {
            _ = try? await webView.evaluateJavaScript(OfficeShop.openSignInScript)
            for _ in 0..<16 {
                try? await Task.sleep(nanoseconds: 500_000_000)
                if !OfficeShop.isShopPage(webView.url) { break }
                if await detect(webView).password { break }
            }
        }
        guard OfficeShop.isShopPage(webView.url) else { return }

        let result = try? await webView.callAsyncJavaScript(
            OfficeShop.fillScript,
            arguments: ["email": account.email, "password": account.password],
            contentWorld: .page
        )
        guard (result as? String) == "submitted" || (result as? String) == "filled" else {
            withNeonAnimation(NeonMotion.snappy) { manual = account }
            return
        }
        // Still asking after a few seconds: wrong details, a code by SMS, or a
        // form this could not read. The person finishes it by hand.
        try? await Task.sleep(nanoseconds: 3_500_000_000)
        if OfficeShop.isShopPage(webView.url), await detect(webView).password {
            withNeonAnimation(NeonMotion.snappy) { manual = account }
        }
    }

    private func detect(_ webView: WKWebView) async -> (password: Bool, signIn: Bool) {
        guard let json = try? await webView.evaluateJavaScript(OfficeShop.detectScript) as? String,
              let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Bool] else { return (false, false) }
        return (object["password"] ?? false, object["signIn"] ?? false)
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
            if let manual = model.manual {
                manualCard(manual)
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
                if model.signingIn {
                    Label(L("Signing in to the office shop…"), systemImage: "person.badge.key.fill")
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
                if !isManager {
                    Button { Task { await model.signIn(force: true) } } label: { Image(systemName: "person.badge.key") }
                        .disabled(model.signingIn)
                        .accessibilityLabel(L("Sign in to the office shop"))
                }
            }
        }
    }

    /// The form could not be filled: the office account, to sign in by hand —
    /// the studio chose that the team may see it (every fetch is recorded).
    private func manualCard(_ account: OfficeShopAccount) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(L("Sign in to the office shop by hand"))
                    .font(.neonLabel)
                    .foregroundStyle(Color.neonInk)
                Spacer()
                Button {
                    withNeonAnimation(NeonMotion.snappy) { model.manual = nil }
                } label: {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundStyle(Color.neonTextTertiary)
                        .frame(width: 32, height: 32)
                }
                .accessibilityLabel(L("Dismiss"))
            }
            Text(L("This phone couldn't fill in the shop's sign-in. Use these:"))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextSecondary)
            copyRow(L("Email or phone"), account.email)
            copyRow(L("Password"), account.password)
        }
        .padding(12)
        .background(Color.neonAmber.opacity(0.12))
    }

    private func copyRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.neonFootnote).foregroundStyle(Color.neonTextSecondary)
            Spacer()
            Text(verbatim: value).font(.neonLabel).foregroundStyle(Color.neonInk).environment(\.layoutDirection, .leftToRight)
            Button {
                UIPasteboard.general.string = value
                Haptic.success()
                Toast.success(L("Copied"))
            } label: {
                Image(systemName: "doc.on.doc").frame(width: 36, height: 36)
            }
            .accessibilityLabel(L("Copy"))
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
                     ? L("Set the office %@ account once in Settings on the website — the team's phones sign in with it by themselves. Sign in here by hand once. Everybody adds to this cart; only you place the order.", OfficeShop.name)
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
        view.load(URLRequest(url: OfficeShop.home))
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

        /// A team member's phone signs itself in once a page shows the shop's
        /// sign-in — after the page (and its framework) has drawn.
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard !isManager else { return }
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                await self?.model?.signIn(force: false)
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
