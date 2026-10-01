import SwiftUI
import WebKit

// The office's shared shop cart: the supermarket's own website (Yaser Mall),
// in a web view, signed in to ONE office account on every phone. Everybody
// adds to the same cart — the cart lives at the shop, on that account — and
// only the manager orders.
//
// The manager signs the office account in once on each phone (the web view
// keeps its own cookies), so nobody on the team needs the password. On a
// team member's phone, ordering is blocked here three ways, because the shop's
// site is not ours and any one of them can miss: a checkout-looking button is
// not let through, an in-page route to checkout is refused, and a request that
// would place an order is not sent (`OfficeShop.blockingScript`). That guard
// lives in this app only; the password is what keeps it.
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

    static func isCheckout(_ url: URL) -> Bool {
        let text = url.path + "?" + (url.query ?? "") + "#" + (url.fragment ?? "")
        return text.range(of: checkoutPattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
}

@MainActor
final class OfficeShopModel: ObservableObject {
    @Published var progress: Double = 0
    @Published var canGoBack = false
    @Published var canGoForward = false
    weak var webView: WKWebView?
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
            ZStack(alignment: .top) {
                OfficeShopWebView(model: model, isManager: isManager, onAdded: reportAdded)
                if model.progress > 0 && model.progress < 1 {
                    ProgressView(value: model.progress)
                        .progressViewStyle(.linear)
                        .tint(.neonPurpleStrong)
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
                     ? L("Sign in to the office's %@ account once on each phone — the team never needs the password. Everybody adds to this cart; only you place the order.", OfficeShop.name)
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

    func makeCoordinator() -> Coordinator { Coordinator(isManager: isManager, onAdded: onAdded) }

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
        let onAdded: (String?) -> Void
        private var observations: [NSKeyValueObservation] = []

        init(isManager: Bool, onAdded: @escaping (String?) -> Void) {
            self.isManager = isManager
            self.onAdded = onAdded
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
