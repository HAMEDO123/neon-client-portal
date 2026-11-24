#if targetEnvironment(macCatalyst)
import Foundation

// MARK: - Generic JSON (plans keep fields the UI doesn't know, e.g. targeting_raw)

enum JSONValue: Codable, Hashable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .object(let o): try c.encode(o)
        case .array(let a): try c.encode(a)
        case .null: try c.encodeNil()
        }
    }
    subscript(key: String) -> JSONValue? {
        get { if case .object(let o) = self { return o[key] }; return nil }
        set { if case .object(var o) = self { o[key] = newValue; self = .object(o) } }
    }
    var string: String? { if case .string(let s) = self { return s }; return nil }
    var number: Double? {
        if case .number(let n) = self { return n }
        if case .string(let s) = self { return Double(s) }
        return nil
    }
    var array: [JSONValue] { if case .array(let a) = self { return a }; return [] }
    var bool: Bool? { if case .bool(let b) = self { return b }; return nil }
}

// MARK: - Status

struct MetaCheck: Codable, Hashable { var ok: Bool; var user: String?; var account: String?; var currency: String?; var page: String?; var error: String? }
struct StatusResp: Codable { var check: MetaCheck; var account: String?; var page: String?; var ig: String?; var token: String? }

// MARK: - Campaigns

struct Campaign: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var objective: String?
    var ended: Bool?
    var end: String?
    var status: String?
    var daily_budget: Flex?
    var created: String?
    var spend: Flex?
    var impressions: Flex?
    var reach: Flex?
    var clicks: Flex?
    var messages: Flex?
    var link: String?

    var isLive: Bool { status == "ACTIVE" && !(ended ?? false) }
    var cleanName: String {
        var n = name.replacingOccurrences(of: "\u{200e}", with: "").replacingOccurrences(of: "\u{200f}", with: "")
        n = n.replacingOccurrences(of: "\"", with: "").replacingOccurrences(of: "Post: ", with: "")
        if let r = n.range(of: #"\s*·\s*20\d\d-\d\d-\d\d \d\d:\d\d$"#, options: .regularExpression) { n.removeSubrange(r) }
        return n.trimmingCharacters(in: .whitespaces)
    }
    var stateLabel: String {
        if status == "PAUSED" { return "موقفة" }
        if ended ?? false { return "خلصت" }
        if status == "ACTIVE" { return "شغّالة" }
        return status ?? "—"
    }
    var objectiveLabel: String {
        ["OUTCOME_ENGAGEMENT": "تفاعل", "MESSAGES": "رسائل", "LINK_CLICKS": "زيارات", "OUTCOME_TRAFFIC": "زيارات",
         "OUTCOME_AWARENESS": "وعي", "OUTCOME_LEADS": "عملاء محتملين", "OUTCOME_SALES": "مبيعات"][objective ?? ""] ?? (objective ?? "")
    }
}
struct CampaignsResp: Codable { var ok: Bool; var error: String?; var campaigns: [Campaign]? }

// MARK: - Claude's analysis (data/analyses/<id>.json)

struct Observation: Codable, Hashable { var tone: String; var text: String }
struct Rule: Codable, Hashable { var min: Double?; var max: Double?; var label: String; var action: String
    func applies(_ cp: Double?) -> Bool {
        guard let cp, min != nil || max != nil else { return false }
        return (min == nil || cp >= min!) && (max == nil || cp < max!)
    }
}
struct WrittenOn: Codable, Hashable { var spend: Double?; var conv: Int? }
struct Analysis: Codable, Hashable {
    var written_at: String?
    var written_on: WrittenOn?
    var verdict: String?
    var verdict_label: String?
    var summary: String?
    var why: [String]?
    var observations: [Observation]?
    var rules: [Rule]?
    var review_date: String?
    var review_note: String?
    var projection: String?
    var todo: [String]?
    var next: [String]?
}

// MARK: - Campaign deep dive (/api/campaign/<id>)

struct DCampaign: Codable, Hashable { var id: String; var name: String; var effective_status: String?; var objective: String?; var start_time: String?; var stop_time: String?; var daily_budget: Flex? }
struct Targeting: Codable, Hashable { var age: String?; var places: [String]?; var interests: [String]?; var advantage: Bool?; var platforms: [String]? }
struct Creative: Codable, Hashable { var body: String?; var cta: String?; var type: String?; var thumb: String? }
struct Totals: Codable, Hashable {
    var spend: Flex?; var reach: Flex?; var impressions: Flex?; var frequency: Flex?; var cpm: Flex?; var ctr: Flex?
    var clicks: Flex?; var conv: Flex?; var deep: Flex?; var cpconv: Flex?; var v3: Flex?; var hook: Flex?
    var p25: Flex?; var thruplay: Flex?; var p100: Flex?
}
struct DayRow: Codable, Hashable, Identifiable { var date: String; var spend: Flex?; var conv: Flex?; var reach: Flex?; var id: String { date } }
struct BRow: Codable, Hashable, Identifiable { var label: String; var spend: Flex?; var impressions: Flex?; var clicks: Flex?; var conv: Flex?; var deep: Flex?; var cpconv: Flex?; var id: String { label } }
struct HistRow: Codable, Hashable, Identifiable {
    var at: String; var spend: Flex?; var conv: Flex?; var ad_conv_total: Flex?; var ad_spend_total: Flex?; var cp: Flex?; var advice: String?
    var id: String { at }
}
struct Detail: Codable {
    var history: [HistRow]?
    var ok: Bool
    var error: String?
    var campaign: DCampaign?
    var optimization: String?
    var destination: String?
    var days_total: Int?
    var targeting: Targeting?
    var creative: Creative?
    var totals: Totals?
    var daily: [DayRow]?
    var placement: [BRow]?
    var age: [BRow]?
    var region: [BRow]?
    var analysis: Analysis?
}

// MARK: - Jobs made in the app (data/jobs)

struct JobVideo: Codable, Hashable { var duration: Flex?; var shape: String?; var thumbnail: String?; var frames: [String]? }
struct JobResult: Codable, Hashable { var dry_run: Bool?; var campaign_id: String?; var ad_ids: [String]?; var ads_manager: String?; var note: String? }
struct Job: Codable, Hashable, Identifiable {
    var id: String
    var state: String
    var running: String?
    var created: String?
    var video: JobVideo?
    var plan: JSONValue?
    var dryrun: JobResult?
    var result: JobResult?
    var contact: Bool?
}

#endif
