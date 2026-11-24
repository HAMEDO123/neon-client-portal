#if targetEnvironment(macCatalyst)
import SwiftUI
import WidgetKit

/// Dev aid: `NeonAdmin -neonAdsSnapshot <dir>` renders the marketing pages to PNG (no Screen Recording
/// permission needed, nothing shown on screen) and quits. Debug builds only (NeonAdminApp).
enum Snapshot {
    static var dir: String? {
        let a = CommandLine.arguments
        guard let i = a.firstIndex(of: "-neonAdsSnapshot"), i + 1 < a.count else { return nil }
        return a[i + 1]
    }

    @MainActor
    static func run(_ store: Store, dir: String) async {
        var detail: Detail?
        if let id = store.campaigns.first(where: { store.analyses[$0.id] != nil && !$0.isLive })?.id
            ?? store.campaigns.first(where: { store.analyses[$0.id] != nil })?.id {
            detail = try? await store.detail(id)
        }
        try? await Task.sleep(nanoseconds: 500_000_000)
        func render<V: View>(_ v: V, _ name: String, width: CGFloat = 1000) {
            let r = ImageRenderer(content: v
                .environmentObject(store)
                .environment(\.layoutDirection, .rightToLeft)
                .frame(width: width)
                .background(Brand.bg))
            r.scale = 1
            if let png = r.uiImage?.pngData() {
                try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent(name + ".png"))
            }
        }
        let cs: CommandSummary? = try? await API.get("/api/command?days=30")
        render(CommandCenterView(go: { _ in }, openCampaign: { _ in }, preload: cs), "command", width: 1300)
        let wb: WBResp? = try? await API.get("/api/workbench")
        render(WorkbenchView(open: { _ in }, preload: wb), "workbench", width: 1400)
        render(WorkbenchView(open: { _ in }, preload: wb), "workbench_narrow", width: 900)
        render(CommandCenterView(go: { _ in }, openCampaign: { _ in }, preload: cs), "command_narrow", width: 900)
        let ls: LeadsResp? = try? await API.get("/api/leads")
        render(LeadsView(preload: ls), "leads", width: 1300)
        render(LeadsView(preload: ls), "leads_narrow", width: 900)
        render(ApprovalsView(openCampaign: { _ in }), "approvals", width: 1100)
        let lq: LQResp? = try? await API.get("/api/lead-quality?days=60")
        render(LeadQualityView(preload: lq), "quality", width: 1300)
        render(LeadQualityView(preload: lq), "quality_narrow", width: 900)
        let mg = ManagerStore(); await mg.load()
        render(ZStack { AuroraBackground(); ManagerPage(m: mg, go: { _ in }, openCampaign: { _ in }) }, "desk", width: 1100)
        if let b = mg.data?.briefs.first { render(ZStack { AuroraBackground(); BriefContent(b: b).padding(20) }, "brief", width: 860) }
        render(OpinionPage(open: { _ in }), "opinion")
        render(CampaignsPage(open: { _ in }), "campaigns")
        render(NewAdPage(), "newad")
        let ms = MarketStore(); await ms.load()
        render(ZStack { AuroraBackground(); MarketPage(m: ms) }, "market", width: 1100)
        if let detail { render(CampaignDetailView.Page(d: detail), "detail") }
        if let wc = store.widget?.campaigns?.first {
            render(ActionConfirmView(p: PendingAction(campaign: wc, action: "raise")), "confirm", width: 520)
        }
        render(ZStack { AuroraBackground(); OpinionPage(open: { _ in }) }, "opinion_glass")
        if let w = store.widget {
            let e = Entry(date: .now, data: w, offline: false)
            for (f, size, name) in [(WidgetFamily.systemSmall, CGSize(width: 170, height: 170), "w_small"),
                                    (.systemMedium, CGSize(width: 364, height: 170), "w_medium"),
                                    (.systemLarge, CGSize(width: 364, height: 382), "w_large")] {
                let r = ImageRenderer(content: WidgetView(entry: e, forced: f).padding(16)
                    .frame(width: size.width, height: size.height)
                    .background(RoundedRectangle(cornerRadius: 22).fill(Color.white)))
                r.scale = 2
                if let png = r.uiImage?.pngData() {
                    try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent(name + ".png"))
                }
            }
        }
        exit(0)
    }
}

#endif
