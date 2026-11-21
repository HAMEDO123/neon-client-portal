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

enum Palette {
    static let purple = Color(red: 0.36, green: 0.25, blue: 0.86)
    static let ink = Color(red: 0.11, green: 0.10, blue: 0.16)
    static let muted = Color(red: 0.42, green: 0.41, blue: 0.48)
    static let green = Color(red: 0.09, green: 0.64, blue: 0.29)
    static let amber = Color(red: 0.85, green: 0.47, blue: 0.02)
    static let red = Color(red: 0.86, green: 0.15, blue: 0.15)
    static let blue = Color(red: 0.15, green: 0.39, blue: 0.92)
    static let grey = Color(red: 0.58, green: 0.6, blue: 0.65)
}

private struct WidgetSurface: View {
    var body: some View {
        LinearGradient(
            colors: [Color(red: 0.98, green: 0.97, blue: 1.0), Color(red: 0.93, green: 0.91, blue: 0.99)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
    }
}

extension View {
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
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(tint)
                .minimumScaleFactor(0.6)
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Palette.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
