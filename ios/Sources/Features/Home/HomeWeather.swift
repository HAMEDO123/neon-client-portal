import SwiftUI

/// The weather in the studio's city for the greeting card, from Open-Meteo
/// (no key, no account). Amman, where the studio is — the same city its
/// timezone (Asia/Amman) names. Anything that goes wrong just means no
/// weather on the card: it is a nicety, never a figure anybody acts on.
struct HomeWeatherReading: Equatable {
    let temperature: Double
    let code: Int
    let isDay: Bool
    let fetchedAt: Date
}

@MainActor
final class HomeWeatherStore: ObservableObject {
    static let shared = HomeWeatherStore()

    @Published private(set) var reading: HomeWeatherReading?

    private var loading = false
    private static let url = URL(string: "https://api.open-meteo.com/v1/forecast?latitude=31.95&longitude=35.93&current=temperature_2m,weather_code,is_day&timezone=Asia%2FAmman")!

    private struct Response: Decodable {
        struct Current: Decodable {
            let temperature_2m: Double
            let weather_code: Int
            let is_day: Int
        }
        let current: Current
    }

    /// Fetches at most every 15 minutes; a failure leaves the last good reading
    /// (or none) in place.
    func refresh() async {
        if let reading, Date().timeIntervalSince(reading.fetchedAt) < 15 * 60 { return }
        guard !loading else { return }
        loading = true
        defer { loading = false }
        var request = URLRequest(url: Self.url)
        request.timeoutInterval = 8
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let decoded = try? JSONDecoder().decode(Response.self, from: data)
        else { return }
        reading = HomeWeatherReading(
            temperature: decoded.current.temperature_2m,
            code: decoded.current.weather_code,
            isDay: decoded.current.is_day == 1,
            fetchedAt: Date()
        )
    }
}

/// "☾ 22°  Amman" at the top trailing corner of the hero, on a frosted tile.
struct HomeWeatherBadge: View {
    @ObservedObject private var store = HomeWeatherStore.shared

    var body: some View {
        // Something always here, even before (or without) a reading: a view
        // with no content never runs its `.task`.
        ZStack(alignment: .topTrailing) {
            Color.clear.frame(width: 0, height: 0)
            if let reading = store.reading {
                VStack(alignment: .trailing, spacing: 2) {
                    HStack(spacing: 6) {
                        Image(systemName: homeWeatherSymbol(reading.code, isDay: reading.isDay))
                            .symbolRenderingMode(.multicolor)
                        Text(verbatim: "\(NeonFormat.integer(Int(reading.temperature.rounded())))°")
                            .monospacedDigit()
                    }
                    .font(.system(.title2, weight: .semibold))
                    Text(L("Amman"))
                        .font(.system(.subheadline, weight: .medium))
                        .opacity(0.92)
                }
                .foregroundStyle(.white)
                .fixedSize()
                // On a frosted tile of its own, so the white figure reads over
                // whatever part of the cover photo is behind it. The dark
                // scheme turns the kit's frosted material smoky rather than
                // milky under white text.
                .padding(.horizontal, NeonSpace.sm + 2)
                .padding(.vertical, NeonSpace.sm - 2)
                .neonSurface(.frosted, radius: NeonRadius.sm)
                .environment(\.colorScheme, .dark)
                .transition(.neonPop)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(L("%@ in Amman, %@", "\(NeonFormat.integer(Int(reading.temperature.rounded())))°", homeWeatherWords(reading.code))))
            }
        }
        .animation(NeonMotion.bouncy, value: store.reading)
        .task { await store.refresh() }
    }
}

/// WMO weather codes (what Open-Meteo answers with) as SF Symbols, by day or night.
func homeWeatherSymbol(_ code: Int, isDay: Bool) -> String {
    switch code {
    case 0: return isDay ? "sun.max.fill" : "moon.stars.fill"
    case 1, 2: return isDay ? "cloud.sun.fill" : "cloud.moon.fill"
    case 3: return "cloud.fill"
    case 45, 48: return "cloud.fog.fill"
    case 51...57: return "cloud.drizzle.fill"
    case 61...67, 80...82: return isDay ? "cloud.sun.rain.fill" : "cloud.moon.rain.fill"
    case 71...77, 85, 86: return "cloud.snow.fill"
    case 95...99: return "cloud.bolt.rain.fill"
    default: return isDay ? "sun.max.fill" : "moon.fill"
    }
}

/// The same codes in words, for VoiceOver.
func homeWeatherWords(_ code: Int) -> String {
    switch code {
    case 0: return L("clear")
    case 1, 2: return L("partly cloudy")
    case 3: return L("cloudy")
    case 45, 48: return L("fog")
    case 51...57: return L("drizzle")
    case 61...67, 80...82: return L("rain")
    case 71...77, 85, 86: return L("snow")
    case 95...99: return L("thunderstorms")
    default: return ""
    }
}
