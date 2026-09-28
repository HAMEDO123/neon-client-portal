import Foundation

// What the ops actions answer, and the calls that reach them. Contract:
// ios/ARCHITECTURE.md §2 — "Put these calls in an extension APIClient in
// your own folder."

// MARK: - Attendance action results

/// `SyncReport` in src/lib/attendance-sync.ts.
struct SyncReport: Decodable {
    let ran: Bool
    let reason: String?
    let error: String?
    let driftSeconds: Int?
    let deviceTime: String?
    let punches: Int?
    let days: Int?
    let outcome: SyncOutcome?
}

struct SyncOutcome: Decodable {
    let created: Int
    let updated: Int
    let keptManual: Int
    let skippedInactive: Int
    let unmapped: [String]
}

/// `ClockResult` in src/lib/actions/operations-actions.ts.
struct ClockResult: Decodable {
    let ok: Bool
    let reason: String?
    let error: String?
    let wallClock: String?
    let driftSeconds: Int?
}

/// `DeviceWrite` in src/lib/actions/operations-actions.ts.
struct DeviceWrite: Decodable {
    let ok: Bool
    let message: String?
    let error: String?
}

extension APIClient {
    // MARK: Attendance

    func opsAttendanceOverview() async throws -> Loaded<AttendanceOverview> {
        try await read("ops/attendanceOverview", as: AttendanceOverview.self)
    }

    func opsAttendanceMonth(month: String?) async throws -> Loaded<AttendanceMonth> {
        try await read("ops/attendanceMonth", ["month": month], as: AttendanceMonth.self)
    }

    func opsSetDeviceUserId(employeeId: String, deviceUserId: String) async throws {
        try await perform("ops/setDeviceUserId", args: [employeeId], form: ["deviceUserId": deviceUserId])
    }

    func opsSyncAttendanceNow() async throws -> SyncReport {
        let outcome = try await perform("ops/syncAttendanceNow")
        return try outcome.result(SyncReport.self) ?? SyncReport(ran: false, reason: nil, error: nil, driftSeconds: nil, deviceTime: nil, punches: nil, days: nil, outcome: nil)
    }

    func opsSetDeviceClockNow() async throws -> ClockResult {
        let outcome = try await perform("ops/setDeviceClockNow")
        guard let result = try outcome.result(ClockResult.self) else { throw APIError.decoding }
        return result
    }

    func opsAddDeviceUser(deviceUserId: String, name: String) async throws -> DeviceWrite {
        let outcome = try await perform("ops/addDeviceUser", form: ["deviceUserId": deviceUserId, "name": name])
        guard let result = try outcome.result(DeviceWrite.self) else { throw APIError.decoding }
        return result
    }

    func opsDeleteDeviceUser(uid: Int, deviceUserId: String) async throws -> DeviceWrite {
        let outcome = try await perform("ops/deleteDeviceUser", form: ["uid": uid, "deviceUserId": deviceUserId])
        guard let result = try outcome.result(DeviceWrite.self) else { throw APIError.decoding }
        return result
    }

    func opsClearDeviceAttendanceLog() async throws -> DeviceWrite {
        let outcome = try await perform("ops/clearDeviceAttendanceLog", form: ["confirm": "WIPE"])
        guard let result = try outcome.result(DeviceWrite.self) else { throw APIError.decoding }
        return result
    }

    // MARK: Requests

    func opsRequests() async throws -> Loaded<OpsRequests> {
        try await read("ops/requests", as: OpsRequests.self)
    }

    func opsDecideSupplyRequest(id: String, status: String, decisionNote: String) async throws {
        try await perform("ops/decideSupplyRequest", args: [id, status], form: decisionNote.isEmpty ? [:] : ["decisionNote": decisionNote])
    }

    // MARK: Site visits

    func opsSiteVisits() async throws -> Loaded<[SiteVisit]> {
        try await read("ops/siteVisits", as: [SiteVisit].self)
    }

    func opsMySiteVisits() async throws -> Loaded<MySiteVisits> {
        try await read("ops/mySiteVisits", as: MySiteVisits.self)
    }

    func opsScheduleSiteVisit(form: [String: Any]) async throws {
        try await perform("ops/scheduleSiteVisit", form: form)
    }

    func opsUpdateSiteVisit(id: String, form: [String: Any]) async throws {
        try await perform("ops/updateSiteVisit", args: [id], form: form)
    }

    func opsReportSiteVisit(id: String, state: String, report: String) async throws {
        try await perform("ops/reportSiteVisit", args: [id, state], form: report.isEmpty ? [:] : ["report": report])
    }

    func opsDeleteSiteVisit(id: String) async throws {
        try await perform("ops/deleteSiteVisit", args: [id])
    }

    // MARK: Settings

    func opsSettings() async throws -> Loaded<OpsSettings> {
        try await read("ops/settings", as: OpsSettings.self)
    }

    func opsAutomationPreview() async throws -> AutomationPreview {
        let loaded = try await read("ops/automationPreview", as: AutomationPreview.self)
        return loaded.value
    }

    func opsSaveWorkHours(form: [String: Any]) async throws {
        try await perform("ops/saveWorkHours", form: form)
    }

    func opsSavePlanningNotes(_ notes: String) async throws {
        try await perform("ops/savePlanningNotes", form: ["planningNotes": notes])
    }

    func opsSaveTimezone(_ timezone: String) async throws {
        try await perform("ops/saveTimezone", form: ["timezone": timezone])
    }

    func opsCreateAutomationRule(form: [String: Any]) async throws {
        try await perform("ops/createAutomationRule", form: form)
    }

    func opsUpdateAutomationRule(id: String, form: [String: Any]) async throws {
        try await perform("ops/updateAutomationRule", args: [id], form: form)
    }

    func opsDeleteAutomationRule(id: String) async throws {
        try await perform("ops/deleteAutomationRule", args: [id])
    }

    func opsSetAutomationSwitch(_ on: Bool) async throws {
        try await perform("ops/setAutomationSwitch", args: [on])
    }
}
