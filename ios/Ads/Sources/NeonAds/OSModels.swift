#if targetEnvironment(macCatalyst)
import Foundation
import SwiftUI

// MARK: - /api/command, /api/recommendations, /api/approvals, /api/leads (neon.db)

struct PeriodAgg: Codable, Hashable { var spend: Double; var conv: Int; var deep: Int; var cpr: Double?; var ctr: Double? }
struct SeriesRow: Codable, Hashable, Identifiable { var day: String; var spend: Double?; var conv: Int?; var deep: Int?; var id: String { day } }
struct TargetCPA: Codable, Hashable { var value: Double; var basis: String; var n: Int?; var p25: Double?; var p75: Double?; var source: String? }
struct KnowledgeRow: Codable, Hashable, Identifiable { var id: Int; var statement: String; var status: String; var sample_size: Int?; var confidence: Double?; var source: String? }
struct LeadsKPI: Codable, Hashable {
    var by_stage: [String: Int]; var total: Int; var qualified: Int; var won: Int; var won_value: Double; var pipeline_value: Double; var cost_per_lead: Double?
}
struct SyncRun: Codable, Hashable { var finished_at: String?; var rows: Int?; var range_from: String?; var range_to: String? }
struct Health: Codable, Hashable { var name: String; var status: String; var detail: String?; var checked_at: String? }
struct Freshness: Codable, Hashable { var last_ok: SyncRun?; var health: Health? }

struct Expected: Codable, Hashable {
    struct Keep: Codable, Hashable { var conv: Int?; var spend: Double? }
    struct Inc: Codable, Hashable { var conv: [Int]?; var extra_spend: Double? }
    struct Red: Codable, Hashable { var conv: Int?; var saves: Double? }
    var assumptions: String?; var keep: Keep?; var increase_20: Inc?; var reduce_30: Red?; var statistically_validated: Bool?
}
struct Finding: Codable, Hashable { var kind: String; var severity: String?; var title: String; var note: String? }
struct RecEvidence: Codable, Hashable {
    var observations: [String]?; var findings: [Finding]?; var target: TargetCPA?; var budget: Double?; var hours: Double?; var days_left: Double?
}
struct ActionParams: Codable, Hashable { var action: String; var pct: Double? }
struct Recommendation: Codable, Hashable, Identifiable {
    var id: Int; var created_at: String?; var updated_at: String?; var scope: String; var scope_id: String?; var kind: String
    var title: String; var problem: String?; var impact: String?; var action: String?; var risk: String?; var confidence: Double?
    var data_sufficiency: String?; var monitoring: String?; var rollback: String?; var source: String?; var priority: Double?; var status: String?
    var evidence: RecEvidence?; var expected: Expected?; var alternatives: [String]?; var action_params: ActionParams?
}
struct CommandSummary: Codable {
    var days: Int; var current: PeriodAgg; var previous: PeriodAgg; var series: [SeriesRow]
    var recommendations: [Recommendation]; var target: TargetCPA; var approvals_pending: Int
    var knowledge: [KnowledgeRow]; var leads: LeadsKPI; var active_campaigns: Int; var freshness: Freshness
}

struct Approval: Codable, Hashable, Identifiable {
    var id: Int; var created_at: String; var recommendation_id: Int?; var action: String; var target_type: String?; var target_id: String?
    var current_json: String?; var proposed_json: String?; var reason: String?; var expected: String?; var risk: String?
    var status: String; var decided_at: String?; var decision_note: String?; var applied_at: String?; var result_json: String?
}
struct AuditRow: Codable, Hashable, Identifiable { var id: Int; var at: String; var actor: String?; var action: String?; var target_type: String?; var target_id: String?; var ok: Int?; var note: String? }

struct LeadStage: Codable, Hashable, Identifiable { var key: String; var label_ar: String; var label_en: String; var position: Int; var is_won: Int; var is_lost: Int; var id: String { key } }
struct Lead: Codable, Hashable, Identifiable {
    var id: Int; var created_at: String; var updated_at: String?; var name: String?; var phone: String?; var source: String?
    var campaign_id: String?; var campaign_name: String?; var attribution: String?; var service: String?; var area_m2: Double?
    var location: String?; var budget_range: String?; var timeline: String?; var stage: String; var assignee: String?
    var follow_up_on: String?; var first_contact_at: String?; var first_response_at: String?
    var quotation_amount: Double?; var contract_amount: Double?; var cost_amount: Double?; var lost_reason: String?; var notes: String?
    var display: String { (name?.isEmpty == false ? name : nil) ?? phone ?? "بدون اسم" }
}
struct LeadMetrics: Codable, Hashable {
    var leads: Int; var qualified: Int; var quotations: Int; var won: Int; var revenue: Double; var gross_profit: Double?; var pipeline_value: Double
    var ad_spend_since_first_lead: Double; var cost_per_lead: Double?; var cost_per_qualified: Double?; var cost_per_quotation: Double?
    var cost_per_customer: Double?; var lead_to_contract: Double?; var avg_deal: Double?; var roas: Double?; var median_first_response_min: Double?
    var attribution_note: String?
}
struct LeadIssue: Codable, Hashable { var lead: Int; var kind: String; var text: String }
struct LeadsResp: Codable { var stages: [LeadStage]; var leads: [Lead]; var metrics: LeadMetrics; var lost_reasons: [String: Int]; var issues: [LeadIssue] }
struct LeadEvent: Codable, Hashable, Identifiable { var id: Int; var at: String; var kind: String?; var from_stage: String?; var to_stage: String?; var note: String? }
struct LeadDetail: Codable { var lead: Lead?; var events: [LeadEvent] }

enum Provenance {
    static func label(_ s: String?) -> (String, Color) {
        switch s {
        case "meta_api": return ("ميتا", Brand.accent)
        case "crm": return ("CRM", Brand.accent2)
        case "first_party": return ("تاريخك", Brand.ok)
        case "public_competitor": return ("منافسين", Brand.warn)
        case "user": return ("إدخالك", Brand.text2)
        case "ai_estimate": return ("تقدير", Brand.warn)
        case "model": return ("نموذج تاريخي", Brand.accent2)
        default: return (s ?? "—", Brand.text2)
        }
    }
}

struct ProvenanceChip: View {
    var source: String?
    var body: some View {
        let (t, c) = Provenance.label(source)
        Label(t, systemImage: "checkmark.seal").font(.caption2.bold()).foregroundStyle(c).lineLimit(1).fixedSize()
            .padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(c.opacity(0.1)))
            .help("مصدر الرقم: " + (source ?? "—"))
    }
}

struct ConfidenceBar: View {
    var value: Double
    var body: some View {
        HStack(spacing: 6) {
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.primary.opacity(0.08))
                    Capsule().fill(value >= 0.7 ? Brand.ok : value >= 0.5 ? Brand.warn : Brand.bad).frame(width: g.size.width * value)
                }
            }.frame(width: 70, height: 6)
            Text(verbatim: "\(Int(value * 100))%").font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
        }
    }
}

extension Store {
    func osPost(_ path: String, _ body: [String: String] = [:]) async -> [String: Any] {
        do {
            let d = try await API.post(path, json: body)
            return (try? JSONSerialization.jsonObject(with: d) as? [String: Any]) ?? [:]
        } catch { return ["ok": false, "error": error.localizedDescription] }
    }
}

#endif
