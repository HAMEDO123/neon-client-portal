import SwiftUI
import WidgetKit

// NEON's widgets, for the Mac's desktop and Notification Centre and the
// iPhone's Home Screen alike. Each reads the same phone API the app does, with
// the token the app keeps in the shared Keychain group (TokenStore.swift), and
// knows from WidgetShare.swift which side is signed in and in which language.
//
// The manager's: where the team is, today's tasks, what is waiting on them.
// The team's: their own tasks, and what is waiting on them.
//
// A widget only ever shows what the server said. Signed out, the wrong side or
// no connection each say so in words — never an empty card that reads as
// "nothing to do".

@main
struct NeonWidgetsBundle: WidgetBundle {
    var body: some Widget {
        TeamMapWidget()
        StudioTodayWidget()
        WaitingWidget()
        MyTasksWidget()
    }
}

// MARK: - Language and look

struct Words {
    let ar: Bool
    init(_ context: WidgetContext?) { ar = (context?.language ?? Locale.preferredLanguages.first?.prefix(2).description) == "ar" }
    func t(_ en: String, _ arabic: String) -> String { ar ? arabic : en }
    var direction: LayoutDirection { ar ? .rightToLeft : .leftToRight }
}

// Liquid Glass: glass tiles over a deep colour field, white type. In the
// system's own clear and tinted looks (iOS 26 / macOS 26) the colour field
// steps aside and the system's glass shows through instead.
enum Palette {
    static let purple = Color(red: 0.78, green: 0.72, blue: 1.0)
    static let ink = Color.white
    static let muted = Color.white.opacity(0.72)
    static let green = Color(red: 0.45, green: 0.93, blue: 0.6)
    static let amber = Color(red: 0.99, green: 0.79, blue: 0.33)
    static let red = Color(red: 1.0, green: 0.52, blue: 0.52)
    static let blue = Color(red: 0.5, green: 0.78, blue: 1.0)
    static let grey = Color.white.opacity(0.45)
}

/// The colour the glass sits on: NEON's purple running into a deep blue, with
/// two soft lights so the glass has something to bend.
private struct WidgetSurface: View {
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        if mode == .fullColor {
            ZStack {
                LinearGradient(
                    colors: [Color(red: 0.29, green: 0.16, blue: 0.62), Color(red: 0.13, green: 0.18, blue: 0.5), Color(red: 0.06, green: 0.31, blue: 0.47)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
                Circle()
                    .fill(Color(red: 0.93, green: 0.36, blue: 0.75).opacity(0.55))
                    .frame(width: 180, height: 180)
                    .blur(radius: 60)
                    .offset(x: 90, y: -70)
                Circle()
                    .fill(Color(red: 0.3, green: 0.85, blue: 0.95).opacity(0.4))
                    .frame(width: 160, height: 160)
                    .blur(radius: 60)
                    .offset(x: -90, y: 80)
            }
        } else {
            Color.clear
        }
    }
}

/// A pane of glass: a frosted face, a bright edge that catches the light at
/// the top and fades down, and a soft shadow under it.
private struct GlassPane: ViewModifier {
    var radius: CGFloat
    @Environment(\.widgetRenderingMode) private var mode

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background {
                if mode == .fullColor {
                    shape
                        .fill(LinearGradient(colors: [Color.white.opacity(0.26), Color.white.opacity(0.09)], startPoint: .top, endPoint: .bottom))
                        .overlay(
                            shape.strokeBorder(
                                LinearGradient(colors: [Color.white.opacity(0.75), Color.white.opacity(0.12), Color.white.opacity(0.3)], startPoint: .topLeading, endPoint: .bottomTrailing),
                                lineWidth: 1
                            )
                        )
                        .shadow(color: Color.black.opacity(0.18), radius: 8, x: 0, y: 4)
                } else {
                    shape.fill(Color.white.opacity(0.1))
                }
            }
    }
}

extension View {
    func glassPane(radius: CGFloat = 14, padding: CGFloat = 8) -> some View {
        self.padding(padding).modifier(GlassPane(radius: radius))
    }

    @ViewBuilder func neonWidgetBackground() -> some View {
        if #available(iOS 17.0, *) {
            containerBackground(for: .widget) { WidgetSurface() }
        } else {
            padding().background(WidgetSurface())
        }
    }

    func neonWidget(_ words: Words) -> some View {
        environment(\.layoutDirection, words.direction)
            .foregroundStyle(Palette.ink)
            .neonWidgetBackground()
    }
}

/// The widget's own title row: the mark and what it is.
struct WidgetTitle: View {
    let title: String
    let symbol: String
    var tint: Color = Palette.purple

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(tint)
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
            Spacer(minLength: 0)
            Text("NEON")
                .font(.system(size: 9, weight: .heavy))
                .tracking(1.2)
                .foregroundStyle(Palette.muted.opacity(0.7))
        }
    }
}

/// What a widget says when it has nothing from the server to show.
struct WidgetMessage: View {
    let title: String
    let symbol: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            WidgetTitle(title: title, symbol: symbol)
            Spacer(minLength: 0)
            Text(message)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// A big number with its word under it.
struct Figure: View {
    let value: Int
    let label: String
    var tint: Color = Palette.ink

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("\(value)")
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(tint)
                .minimumScaleFactor(0.6)
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Palette.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .widgetAccentable()
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassPane(radius: 12, padding: 7)
    }
}

func neonLink(_ path: String) -> URL {
    var parts = URLComponents()
    parts.scheme = "neon"
    parts.host = "open"
    parts.queryItems = [URLQueryItem(name: "path", value: path)]
    return parts.url ?? URL(string: "neon://open")!
}

// MARK: - Reading the server

enum WidgetAPI {
    static let base = URL(string: "https://clients.neonjo.com/api/mobile")!

    enum Failure: Error { case signedOut, offline }

    static func fetch<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        guard let token = TokenStore.read(), !token.isEmpty else { throw Failure.signedOut }
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 20
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw Failure.signedOut }
        guard (200..<300).contains(status) else { throw Failure.offline }
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// `get/<area>/<name>`, as the app's `read`.
    static func read<T: Decodable>(_ name: String, as type: T.Type = T.self) async throws -> T {
        try await fetch("get/\(name)", as: type)
    }
}

/// What every widget's entry carries: the figures, or why there are none.
enum Loaded<Value> {
    case ready(Value)
    case signedOut
    case otherSide
    case offline
}

func load<Value>(side wanted: String?, _ read: () async throws -> Value) async -> (Loaded<Value>, WidgetContext?) {
    let context = WidgetShare.read()
    guard let context else { return (.signedOut, nil) }
    if let wanted, context.side != wanted { return (.otherSide, context) }
    do {
        return (.ready(try await read()), context)
    } catch WidgetAPI.Failure.signedOut {
        return (.signedOut, context)
    } catch {
        return (.offline, context)
    }
}

struct NeonEntry<Value>: TimelineEntry {
    let date: Date
    let loaded: Loaded<Value>
    let context: WidgetContext?
    var words: Words { Words(context) }
}

/// Refreshed every fifteen minutes, and whenever the app comes to the front.
func timeline<Value>(_ entry: NeonEntry<Value>) -> Timeline<NeonEntry<Value>> {
    Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(15 * 60)))
}

/// The sentence for an entry with nothing to draw.
func explain<Value>(_ loaded: Loaded<Value>, _ words: Words, otherSide: String) -> String? {
    switch loaded {
    case .ready: return nil
    case .signedOut: return words.t("Open NEON and sign in to see this here.", "افتح NEON وسجّل دخول عشان يطلع هون.")
    case .otherSide: return otherSide
    case .offline: return words.t("Couldn't reach NEON. It will try again shortly.", "ما قدر يوصل لـ NEON. رح يجرب كمان شوي.")
    }
}

// MARK: - Dates

enum WidgetDates {
    static let studio = TimeZone(identifier: "Asia/Amman") ?? .current

    static func parse(_ text: String?) -> Date? {
        guard let text else { return nil }
        let precise = ISO8601DateFormatter()
        precise.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = precise.date(from: text) { return date }
        return ISO8601DateFormatter().date(from: text)
    }

    static func time(_ date: Date, _ words: Words) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: words.ar ? "ar" : "en_US")
        formatter.timeZone = studio
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }
}
