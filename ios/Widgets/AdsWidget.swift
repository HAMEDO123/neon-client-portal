#if targetEnvironment(macCatalyst)
import SwiftUI
import WidgetKit

// The NEON Ads widget, on the Mac only: today's WhatsApp conversations from the ads,
// the spend, and Claude's call on each running campaign. It reads the NEON Ads engine
// on this Mac (127.0.0.1:8793) — not the studio's server — so it needs no sign-in, and
// says so in words when the engine is off. Its views and models are the marketing
// module's own (Ads/Shared/), compiled into this extension too.
//
// Its buttons open neon://ads?c=<campaign>&a=<action>: the app shows the confirmation
// sheet, and nothing changes on Meta until Hamed confirms there.

struct AdsProvider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: .now, data: .placeholder, offline: false) }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        fetch { completion($0) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        fetch { e in
            completion(Timeline(entries: [e], policy: .after(Date().addingTimeInterval(5 * 60))))
        }
    }

    private func fetch(_ done: @escaping (Entry) -> Void) {
        var req = URLRequest(url: Backend.base.appendingPathComponent("api/widget"))
        req.timeoutInterval = 25
        URLSession.shared.dataTask(with: req) { d, _, _ in
            if let d, let w = try? JSONDecoder().decode(WidgetData.self, from: d) {
                done(Entry(date: .now, data: w, offline: false))
            } else {
                done(Entry(date: .now, data: WidgetData(ok: false, error: "المحرّك مطفي — افتح NEON ▸ التسويق"), offline: true))
            }
        }.resume()
    }
}

struct AdsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NEONAdsWidget", provider: AdsProvider()) { entry in
            WidgetView(entry: entry)
                .containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("NEON Ads")
        .description("محادثات اليوم ومجموع المحادثات على الإعلان لهاللحظة، ورأي Claude")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
#endif
