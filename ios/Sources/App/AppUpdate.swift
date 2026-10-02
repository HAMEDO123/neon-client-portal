import SwiftUI
import UIKit

/// Whether this phone runs the studio's newest build — and, when it doesn't,
/// the screen that sends it to TestFlight.
///
/// Every request says which build this is (`X-Neon-Build`, and where it came
/// from, `X-Neon-Channel`); the server remembers the newest build any phone
/// installed from TestFlight and names it on every answer
/// (`X-Neon-Latest-Build`, src/lib/app-version.ts). An older build covers its
/// screens with `UpdateRequiredView`.
///
/// Only the screens. The app underneath keeps running, so notifications
/// still arrive, a call still rings through CallKit, and the call screen —
/// which sits above everything, this cover included — still answers it.
@MainActor
final class AppUpdate: ObservableObject {
    static let shared = AppUpdate()

    /// The newest build the server has named — kept, so an outdated phone is
    /// covered again at once on its next launch, even offline.
    @Published private(set) var latest: Int?

    private static let latestKey = "app_latest_build"

    /// The TestFlight page of NEON Staff (its App Store Connect id), and the
    /// same page on the web for a phone where the app link does nothing.
    static let testFlightURL = URL(string: "itms-beta://beta.itunes.apple.com/v1/app/6814131820")!
    static let testFlightWebURL = URL(string: "https://beta.itunes.apple.com/v1/app/6814131820")!

    private init() {
        let saved = UserDefaults.standard.integer(forKey: Self.latestKey)
        latest = saved > 0 ? saved : nil
    }

    /// This copy's build: the archive's date stamp (`202610021122`), "1"
    /// from Xcode.
    nonisolated static var build: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
    }

    /// Where this copy came from. A build from Xcode never counts as newer
    /// or older than anybody's, so it is never covered and never raises
    /// the bar for everybody else.
    nonisolated static var channel: String {
        #if DEBUG
        return "dev"
        #else
        return Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt" ? "testflight" : "appstore"
        #endif
    }

    var needsUpdate: Bool {
        guard Self.channel != "dev", let latest, let mine = Int(Self.build) else { return false }
        return latest > mine
    }

    /// What the server said on an answer's `X-Neon-Latest-Build`.
    func note(_ header: String?) {
        guard let header, let value = Int(header.trimmingCharacters(in: .whitespaces)), value > 0, value != latest else { return }
        UserDefaults.standard.set(value, forKey: Self.latestKey)
        withNeonAnimation(.smooth) { latest = value }
    }

    /// TestFlight, on NEON Staff's page, where its Update button is.
    static func openTestFlight() {
        UIApplication.shared.open(testFlightURL) { opened in
            if !opened { UIApplication.shared.open(testFlightWebURL) }
        }
    }

    /// A build's date stamp as a person reads it ("Oct 2, 11:22 AM"), or the
    /// number itself when it is not one.
    static func label(_ build: Int) -> String {
        let stamp = String(build)
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(identifier: "UTC")
        parser.dateFormat = "yyyyMMddHHmm"
        guard stamp.count == 12, let date = parser.date(from: stamp) else { return stamp }
        let shown = DateFormatter()
        shown.locale = AppLanguage.current.locale
        shown.timeZone = TimeZone(identifier: "UTC")
        shown.setLocalizedDateFormatFromTemplate("MMMd jmm")
        return shown.string(from: date)
    }
}

/// Over every screen of an outdated build: what is new, what keeps working,
/// and the one way on — TestFlight.
struct UpdateRequiredView: View {
    let current: Int?
    let latest: Int?

    @State private var appeared = false

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                page
                    .frame(minHeight: proxy.size.height)
            }
        }
        .neonAmbientBackground(animated: true)
        .onAppear {
            withNeonAnimation(NeonMotion.smooth) { appeared = true }
        }
        .accessibilityAddTraits(.isModal)
    }

    private var page: some View {
        VStack(spacing: 0) {
            VStack(spacing: 14) {
                BrandMark(size: 84)
                    .overlay(alignment: .bottomTrailing) {
                        Image(systemName: "arrow.down.circle.fill")
                            .font(.system(size: 30, weight: .semibold))
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.white, Color.neonPurpleStrong)
                            .background(Circle().fill(.white).padding(2))
                            .offset(x: 8, y: 8)
                            .neonFloat()
                    }
                Text(L("A new version of NEON is ready"))
                    .font(.neonTitle2.weight(.bold))
                    .foregroundStyle(Color.neonText)
                    .multilineTextAlignment(.center)
                Text(L("Update it from TestFlight to keep using the app."))
                    .font(.neonBody)
                    .foregroundStyle(Color.neonTextSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 24)
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared ? 0 : 10)

            VStack(spacing: 0) {
                UpdateRequiredRow(symbol: "bell.badge.fill", hue: .orange, title: L("Notifications keep coming"),
                                  detail: L("Everything sent to you still arrives on this phone."))
                NeonDivider().padding(.leading, 52)
                UpdateRequiredRow(symbol: "phone.fill", hue: .green, title: L("Calls still ring"),
                                  detail: L("Answer them as usual, even before you update."))
            }
            .padding(.vertical, 4)
            .padding(.horizontal, NeonSpace.card)
            .neonSurface(.glass, radius: NeonRadius.lg)
            .padding(.top, 28)
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared ? 0 : 16)

            if let current, let latest {
                HStack(spacing: 10) {
                    UpdateRequiredVersion(title: L("On this phone"), value: AppUpdate.label(current), tone: .neonTextSecondary)
                    Image(systemName: "arrow.forward")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Color.neonTextFaint)
                    UpdateRequiredVersion(title: L("Newest"), value: AppUpdate.label(latest), tone: .neonPurpleStrong)
                }
                .padding(.top, 20)
                .opacity(appeared ? 1 : 0)
            }

            NeonButton(L("Update in TestFlight"), symbol: "arrow.down.circle.fill", kind: .brand) {
                Haptic.tap()
                AppUpdate.openTestFlight()
            }
            .padding(.top, 30)

            Text(L("TestFlight opens on NEON Staff. Tap Update, then open NEON again."))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextTertiary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 12)
                .padding(.bottom, 24)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: 460)
        .frame(maxWidth: .infinity)
    }
}

private struct UpdateRequiredRow: View {
    let symbol: String
    let hue: NeonHue
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            IconTile(symbol, hue: hue, size: NeonSize.iconTile, style: .soft)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.neonRowTitle)
                    .foregroundStyle(Color.neonText)
                Text(detail)
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }
}

private struct UpdateRequiredVersion: View {
    let title: String
    let value: String
    let tone: Color

    var body: some View {
        VStack(spacing: 2) {
            Text(title)
                .font(.neonCaption)
                .foregroundStyle(Color.neonTextTertiary)
            Text(value)
                .font(.neonSubheadline.weight(.semibold))
                .foregroundStyle(tone)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .neonSurface(.glass, radius: NeonRadius.sm)
        .accessibilityElement(children: .combine)
    }
}
