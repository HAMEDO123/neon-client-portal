#if targetEnvironment(macCatalyst)
import WidgetKit
import SwiftUI

struct Entry: TimelineEntry {
    let date: Date
    let data: WidgetData
    let offline: Bool
}

struct WidgetView: View {
    @Environment(\.widgetFamily) var envFamily
    let entry: Entry
    var forced: WidgetFamily? = nil
    var family: WidgetFamily { forced ?? envFamily }

    var camps: [WidgetCampaign] { entry.data.campaigns ?? [] }

    var body: some View {
        Group {
            if !entry.data.ok {
                VStack(alignment: .leading, spacing: 6) {
                    header
                    Spacer()
                    Image(systemName: entry.offline ? "bolt.slash" : "exclamationmark.triangle").foregroundStyle(Brand.warn)
                    Text(entry.data.error ?? "").font(.caption).foregroundStyle(.secondary)
                }
            } else {
                switch family {
                case .systemSmall: small
                case .systemLarge: large
                default: medium
                }
            }
        }
        .environment(\.layoutDirection, .rightToLeft)
    }

    var header: some View {
        HStack(spacing: 5) {
            HStack(spacing: 4) {
                Text(verbatim: "NEON").font(.system(size: 12, weight: .heavy)).kerning(1.5)
                Text(verbatim: "ADS").font(.system(size: 12, weight: .semibold)).foregroundStyle(Brand.accent).kerning(1.5)
            }.environment(\.layoutDirection, .leftToRight)
            Spacer()
            Text(entry.data.updated ?? "").font(.system(size: 10)).foregroundStyle(.secondary)
        }
    }

    /// numbers for the main running ad (same post across all its campaigns); falls back to account totals
    var mainToday: Int { camps.first?.ad_conv_today ?? entry.data.today?.conv ?? 0 }
    var mainTotal: Int? { camps.first?.ad_conv_total }
    var mainCP: Double? { camps.first?.ad_cpconv }
    var mainSpendTotal: Double? { camps.first?.ad_spend_total }

    // small: today + total for the ad
    var small: some View {
        VStack(alignment: .leading, spacing: 3) {
            header
            Spacer(minLength: 0)
            HStack(alignment: .bottom, spacing: 10) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("اليوم").font(.system(size: 10)).foregroundStyle(.secondary)
                    Text(verbatim: "\(mainToday)").font(.system(size: 34, weight: .bold, design: .rounded)).foregroundStyle(Brand.ok)
                }
                VStack(alignment: .leading, spacing: 0) {
                    Text("المجموع").font(.system(size: 10)).foregroundStyle(.secondary)
                    Text(verbatim: mainTotal.map(String.init) ?? "—").font(.system(size: 34, weight: .bold, design: .rounded))
                }
            }
            HStack(spacing: 3) {
                Text("محادثة ·")
                Text(verbatim: usd(mainCP)).environment(\.layoutDirection, .leftToRight)
                Text("للمحادثة")
            }.font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            if let a = camps.first?.advice {
                Link(destination: actionURL(camps.first!.id, a.action == "raise" ? "raise" : a.action == "pause" ? "pause" : a.action == "lower" ? "lower" : "hold")) {
                    HStack(spacing: 4) {
                        Image(systemName: a.icon)
                        Text(a.title).lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .font(.system(size: 11, weight: .bold)).foregroundStyle(a.color)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .frame(maxWidth: .infinity)
                    .background(Capsule().fill(a.color.opacity(0.15)))
                }
            }
        }
    }

    // medium: today, total, cost + the running campaign with my verdict
    var medium: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            HStack(spacing: 8) {
                tile("محادثات اليوم", "\(mainToday)", Brand.ok)
                tile("مجموع المحادثات", mainTotal.map(String.init) ?? "—", .primary)
                tile("للمحادثة", usd(mainCP), Brand.cpColor(mainCP))
            }
            if let c = camps.first, let a = c.advice {
                HStack(spacing: 6) {
                    Image(systemName: a.icon).foregroundStyle(a.color)
                    Text(a.title).font(.caption.bold()).lineLimit(1)
                    Spacer(minLength: 4)
                    quick(c, a, compact: true)
                }
            } else if let c = camps.first { campaignLine(c) } else { Text("ما في حملات شغّالة").font(.caption).foregroundStyle(.secondary) }
        }
    }

    /// one-tap actions → open the app on a confirmation sheet (money changes always confirmed)
    func quick(_ c: WidgetCampaign, _ a: Advice, compact: Bool) -> some View {
        let keys = compact ? ["raise", "hold", "pause"] : ["raise", "hold", "lower", "pause"]
        let names = ["raise": "ارفع", "hold": "خليها", "lower": "نزّل", "pause": "وقّف"]
        let rec = a.action == "raise" ? "raise" : a.action == "pause" ? "pause" : a.action == "lower" ? "lower" : "hold"
        return HStack(spacing: 5) {
            ForEach(keys, id: \.self) { k in
                Link(destination: actionURL(c.id, k)) {
                    Text(names[k]!).font(.system(size: compact ? 10 : 11, weight: .bold))
                        .padding(.horizontal, compact ? 7 : 0).padding(.vertical, 4)
                        .frame(maxWidth: compact ? nil : .infinity)
                        .foregroundStyle(k == rec ? .white : .primary)
                        .background(Capsule().fill(k == rec ? a.color : Color.primary.opacity(0.08)))
                }
            }
        }
    }

    // large: totals + every running campaign
    var large: some View {
        let t = entry.data.today ?? WidgetToday(spend: 0, conv: 0)
        return VStack(alignment: .leading, spacing: 10) {
            header
            HStack(spacing: 8) {
                tile("محادثات اليوم", "\(mainToday)", Brand.ok)
                tile("مجموع المحادثات", mainTotal.map(String.init) ?? "—", .primary)
            }
            HStack(spacing: 8) {
                tile("صرف اليوم", usd(t.spend), .primary)
                tile("الصرف الكلي", usd(mainSpendTotal), .primary)
                tile("للمحادثة", usd(mainCP), Brand.cpColor(mainCP))
            }
            if let c = camps.first, let a = c.advice {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Image(systemName: a.icon).foregroundStyle(a.color)
                        Text(a.title).font(.subheadline.bold())
                    }
                    if let r = a.reasons.first { Text(r).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(2) }
                    HStack(spacing: 5) {
                        ForEach(a.scenarios) { sc in
                            VStack(spacing: 1) {
                                Text(sc.label).font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1)
                                Text(verbatim: "\(sc.conv)").font(.system(size: 14, weight: .bold, design: .rounded))
                                Text(verbatim: sc.delta == 0 ? "—" : (sc.delta > 0 ? "+\(sc.delta)" : "\(sc.delta)"))
                                    .font(.system(size: 9, weight: .bold)).foregroundStyle(sc.delta > 0 ? Brand.ok : sc.delta < 0 ? Brand.bad : .secondary)
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 4)
                            .background(RoundedRectangle(cornerRadius: 7).fill(Color.primary.opacity(0.06)))
                        }
                    }
                    quick(c, a, compact: false)
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 10).fill(a.color.opacity(0.08)))
            } else {
                ForEach(camps.prefix(3)) { c in campaignLine(c) }
            }
            if camps.isEmpty { Text("ما في حملات شغّالة").font(.caption).foregroundStyle(.secondary) }
            Spacer(minLength: 0)
        }
    }

    func tile(_ title: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title).font(.system(size: 9)).foregroundStyle(.secondary)
            Text(value).font(.system(size: 17, weight: .bold, design: .rounded)).foregroundStyle(color).minimumScaleFactor(0.7)
        }
        .padding(7).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.06)))
    }

    func campaignLine(_ c: WidgetCampaign) -> some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 2).fill(Brand.verdictColor(c.verdict)).frame(width: 4)
            VStack(alignment: .leading, spacing: 2) {
                Text(c.name).font(.caption.bold()).lineLimit(1)
                Text(c.verdict_label ?? "بدون رأي لسا").font(.system(size: 10)).foregroundStyle(Brand.verdictColor(c.verdict)).lineLimit(1)
                Text(verbatim: "اليوم \(c.ad_conv_today ?? c.conv) · المجموع \(c.ad_conv_total ?? c.conv) محادثة · \(usd(c.ad_cpconv ?? c.cpconv)) للمحادثة").font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}


#endif
