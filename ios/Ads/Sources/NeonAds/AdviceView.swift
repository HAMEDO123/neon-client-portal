#if targetEnvironment(macCatalyst)
import SwiftUI

/// The advisor's live recommendation for one campaign + what-if table + one-tap actions.
struct AdviceCard: View {
    @ObservedObject var store = Store.shared
    var campaign: WidgetCampaign
    var advice: Advice

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: advice.icon).font(.system(size: 30)).foregroundStyle(advice.color)
                VStack(alignment: .leading, spacing: 2) {
                    Text("نصيحة الآن · \(campaign.name)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Text(advice.title).font(.system(size: 22, weight: .bold))
                }
                Spacer()
                Text("بتتحدّث كل 5 دقايق · \(advice.updated ?? "")").font(.caption2).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 5) {
                ForEach(advice.reasons, id: \.self) { r in
                    HStack(alignment: .top, spacing: 6) {
                        Text("•").foregroundStyle(advice.color).bold()
                        Text(r).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            if !advice.scenarios.isEmpty {
                Text("لو عملت كل خيار — لحد آخر الحملة (باقي \(String(format: "%.1f", advice.days_left ?? 0)) يوم)")
                    .font(.headline).padding(.top, 4)
                HStack(spacing: 10) {
                    ForEach(advice.scenarios) { s in ScenarioTile(s: s, recommended: s.key == recommendedKey) }
                }
                HStack(spacing: 10) {
                    ForEach(advice.scenarios) { s in
                        Button {
                            store.pending = PendingAction(campaign: campaign, action: s.key)
                        } label: { Text(s.label).frame(maxWidth: .infinity) }
                        .glassButton(prominent: s.key == recommendedKey)
                        .controlSize(.large)
                    }
                }
            }
        }
        .padding(18)
        .glassCard(20)
    }

    var recommendedKey: String {
        switch advice.action { case "raise": return "raise"; case "pause": return "pause"; case "lower": return "lower"; default: return "hold" }
    }
}

struct ScenarioTile: View {
    var s: Scenario
    var recommended: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(s.label).font(.callout.bold())
                if recommended { Spacer(); Text("نصيحتي").font(.caption2.bold()).padding(.horizontal, 6).padding(.vertical, 2).glassPill(Brand.ok) }
            }
            Text("\(s.conv) محادثة").font(.system(size: 22, weight: .bold, design: .rounded))
            Text(s.delta == 0 ? "نفس الوضع" : (s.delta > 0 ? "+\(s.delta) محادثة" : "\(s.delta) محادثة"))
                .font(.caption.bold()).foregroundStyle(s.delta > 0 ? Brand.ok : s.delta < 0 ? Brand.bad : .secondary)
            Text(s.extra_spend == 0 ? "بدون تغيير بالصرف" : s.extra_spend > 0 ? "بتصرف \(usd(s.extra_spend)) زيادة" : "بتوفّر \(usd(-s.extra_spend))")
                .font(.caption).foregroundStyle(.secondary)
            Text(s.daily > 0 ? "\(usd(s.daily)) / يوم" : "صفر").font(.caption2).foregroundStyle(.secondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(recommended ? Brand.ok.opacity(0.14) : Color.primary.opacity(0.05)))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(recommended ? Brand.ok.opacity(0.7) : .clear, lineWidth: 1.5))
    }
}

struct PendingAction: Identifiable, Equatable {
    var campaign: WidgetCampaign
    var action: String
    var id: String { campaign.id + action }
    static func == (a: PendingAction, b: PendingAction) -> Bool { a.id == b.id }
}

/// Confirmation before touching money — opened from the app or a widget button.
struct ActionConfirmView: View {
    @ObservedObject var store = Store.shared
    @Environment(\.dismiss) private var dismiss
    var p: PendingAction
    @State private var working = false

    var scenario: Scenario? { p.campaign.advice?.scenarios.first { $0.key == p.action } }
    var verb: String {
        switch p.action {
        case "raise": return "ارفع الميزانية"
        case "lower": return "نزّل الميزانية"
        case "pause": return "وقّف الحملة"
        case "resume": return "شغّل الحملة"
        default: return "خليها زي ما هي"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(verb).font(.system(size: 24, weight: .bold))
            Text(p.campaign.name).foregroundStyle(.secondary)
            if let a = p.campaign.advice {
                HStack(spacing: 8) {
                    Image(systemName: a.icon).foregroundStyle(a.color)
                    Text("نصيحتي الحالية: ").bold() + Text(a.title)
                }
            }
            if let s = scenario {
                VStack(alignment: .leading, spacing: 6) {
                    row("الميزانية اليومية", "\(usd(p.campaign.advice?.budget)) ← \(s.daily > 0 ? usd(s.daily) : "موقفة")")
                    row("المحادثات المتوقعة لآخر الحملة", "\(s.conv) (\(s.delta >= 0 ? "+" : "")\(s.delta))")
                    row("الصرف", s.extra_spend == 0 ? "بدون تغيير" : s.extra_spend > 0 ? "+\(usd(s.extra_spend))" : "توفير \(usd(-s.extra_spend))")
                    Text(s.note).font(.callout).foregroundStyle(.secondary)
                }
                .padding(14).glassCard(14)
            }
            if p.action == "raise" || p.action == "lower", p.campaign.advice?.learning == true {
                Label("الحملة لسا بمرحلة التعلّم — التعديل هلأ بيرجّعها للصفر. نصيحتي تستنى.", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(Brand.warn)
            }
            HStack {
                Button("إلغاء") { dismiss() }.keyboardShortcut(.cancelAction).glassButton()
                Spacer()
                if p.action == "hold" {
                    Button("تمام") { dismiss() }.glassButton(prominent: true)
                } else {
                    Button {
                        working = true
                        Task { await store.perform(p); working = false; dismiss() }
                    } label: {
                        if working { ProgressView().controlSize(.small) } else { Text("نفّذ على ميتا") }
                    }
                    .keyboardShortcut(.defaultAction).glassButton(prominent: true).disabled(working)
                }
            }
        }
        .padding(24)
        .frame(width: 520)
        .environment(\.layoutDirection, .rightToLeft)
    }

    func row(_ k: String, _ v: String) -> some View {
        HStack { Text(k).foregroundStyle(.secondary); Spacer(); Text(v).bold().monospacedDigit() }
    }
}

#endif
