#if DEBUG
import SwiftUI

/// This area's screens for the debug router (App/DebugScreens.swift):
/// `-neonScreen <id>` opens one straight from launch, for screenshots.
/// Add every screen and sheet of this area here, so each can be checked.
///
/// The `-fixture` ones draw from `OpsFixtures` and read nothing, so they can
/// be checked without a sign-in and look the same on every run.
enum OpsScreens {
    static let ids: [String] = [
        "ops-attendance", "ops-attendance-person", "ops-requests", "ops-sitevisits", "ops-settings",
        "ops-attendance-fixture", "ops-attendance-person-fixture",
        "ops-attendance-edit-fixture", "ops-attendance-edit-today-fixture", "ops-attendance-edit-blank-fixture",
        "ops-workhours-fixture",
    ]

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "ops-attendance": return debugPushed(AttendanceRootView())
        case "ops-attendance-person":
            return debugPushed(DebugAsync(load: { () async throws -> (AttendanceMonth, AttendanceMonth.Row)? in
                let month = try await APIClient.shared.opsAttendanceMonth(month: nil).value
                guard let row = month.rows.first else { return nil }
                return (month, row)
            }) { pair in
                AttendancePersonDetail(row: pair.1, days: pair.0.days, monthKey: pair.0.monthKey, onChanged: {})
            })
        case "ops-requests": return debugPushed(RequestsRootView())
        case "ops-sitevisits": return debugPushed(SiteVisitsRootView())
        case "ops-settings": return debugPushed(SettingsRootView())

        case "ops-attendance-fixture":
            guard let month = OpsFixtures.month else { return nil }
            return debugPushed(AttendanceRootView(preview: month, overview: OpsFixtures.overview))
        case "ops-attendance-person-fixture":
            guard let month = OpsFixtures.month, let row = month.rows.first else { return nil }
            return debugPushed(AttendancePersonDetail(row: row, days: month.days, monthKey: month.monthKey, onChanged: {}))
        case "ops-attendance-edit-fixture":
            // A device day with two times out and a note.
            return editSheet(day: 15)
        case "ops-attendance-edit-today-fixture":
            // Today, still running: the sheet has to say the clock-out will
            // not be recorded once it is saved.
            return editSheet(day: 22)
        case "ops-attendance-edit-blank-fixture":
            // A day with nothing on it: no "Now" line, no Remove.
            return editSheet(day: 12)
        case "ops-workhours-fixture":
            guard let hours = OpsFixtures.workHours else { return nil }
            return debugPushed(SettingsWorkingDayPreview(workHours: hours))
        default: return nil
        }
    }

    @MainActor private static func editSheet(day: Int) -> AnyView? {
        guard let month = OpsFixtures.month, let row = month.rows.first, month.days.indices.contains(day - 1) else { return nil }
        let index = day - 1
        return AnyView(
            AttendanceCorrectionSheet(
                employeeId: row.employeeId,
                employeeName: row.name,
                dayKey: month.days[index].dayKey,
                entry: row.cells[index],
                isToday: month.days[index].isToday,
                onSaved: {}
            )
        )
    }
}

/// Fixed answers in the server's own shapes (src/lib/mobile/ops-attendance.ts,
/// ops-settings.ts), decoded exactly as a live answer is — so a fixture that
/// draws also proves the models still read the server.
///
/// October 2026, "today" the 22nd, a studio that works Sunday to Thursday
/// and Saturday. Wael's month has every kind of day: on time, late, left
/// early, stepped out (once and twice), no clock-out, typed by the manager,
/// and the two ARRIVAL days of 19–20 October (arrival set by hand, leaving
/// from the device).
enum OpsFixtures {
    private static let monthKey = "2026-10"
    private static let today = 22
    /// 1 October 2026 was a Thursday.
    private static let firstWeekday = 4
    private static let workedWeekdays: Set<Int> = [0, 1, 2, 3, 4, 6]

    private struct Day {
        var delay: Double = 0
        var early: Double = 0
        var away: Double = 0
        var breaks: [(String, String)] = []
        var clockedOut = true
        var source = "DEVICE"
        var note: String?
    }

    private static let wael: [Int: Day] = [
        1: Day(),
        3: Day(delay: 1),
        4: Day(),
        5: Day(away: 1, breaks: [("13:10", "13:40")]),
        6: Day(early: 2),
        7: Day(clockedOut: false),
        8: Day(),
        10: Day(source: "MANUAL", note: "زيارة موقع — عبدون"),
        11: Day(),
        13: Day(delay: 2, source: "MANUAL", note: "Car broke down"),
        14: Day(),
        15: Day(away: 2, breaks: [("12:30", "13:15"), ("16:00", "16:20")], note: "Bank, then the supplier"),
        17: Day(early: 1),
        18: Day(),
        19: Day(source: "ARRIVAL", note: "Arrived on time, forgot to clock in · device: left 19:04"),
        20: Day(early: 1, source: "ARRIVAL", note: "Arrived on time, forgot to clock in"),
        21: Day(),
        22: Day(clockedOut: false),
    ]

    private static let sally: [Int: Day] = [
        1: Day(), 3: Day(), 4: Day(delay: 1), 5: Day(), 6: Day(), 8: Day(),
        10: Day(away: 1, breaks: [("15:00", "15:30")]), 11: Day(), 13: Day(), 14: Day(clockedOut: false),
        19: Day(source: "ARRIVAL"), 20: Day(), 21: Day(), 22: Day(),
    ]

    static let month: AttendanceMonth? = {
        let days = (1...31).map { day -> String in
            let weekday = (firstWeekday + day - 1) % 7
            return """
            {"dayKey":"\(key(day))","dayOfMonth":\(day),"weekday":\(weekday),"worked":\(workedWeekdays.contains(weekday)),"isToday":\(day == today),"isFuture":\(day > today)}
            """
        }
        let rows = [
            row(id: "fx-wael", name: "Wael", days: wael),
            row(id: "fx-sally", name: "Sally", days: sally),
            row(id: "fx-salem", name: "سالم", days: [:]),
        ]
        let json = """
        {"monthKey":"\(monthKey)","thisMonth":"\(monthKey)","days":[\(days.joined(separator: ","))],
         "rows":[\(rows.joined(separator: ","))],"recordIds":{},"photos":{}}
        """
        do {
            return try JSONDecoder().decode(AttendanceMonth.self, from: Data(json.utf8))
        } catch {
            print("OpsFixtures.month did not decode: \(error)")
            return nil
        }
    }()

    static let overview: AttendanceOverview? = {
        let json = """
        {"device":{"ip":"192.168.100.188","port":4370},"reachError":null,
         "clock":{"wallClock":"2026-10-22 14:32:10","driftSeconds":2},"driftBad":false,
         "users":[{"uid":1,"deviceUserId":"1","name":"Wael","isAdmin":false},{"uid":2,"deviceUserId":"2","name":"Sally","isAdmin":false}],
         "canReach":true,
         "employees":[{"id":"fx-wael","name":"Wael","role":"Designer","deviceUserId":"1"},{"id":"fx-sally","name":"Sally","role":"Designer","deviceUserId":"2"}],
         "paired":[{"deviceUserId":"1","name":"Wael","active":true},{"deviceUserId":"2","name":"Sally","active":true}]}
        """
        return try? JSONDecoder().decode(AttendanceOverview.self, from: Data(json.utf8))
    }()

    /// Saturday ends at six, the usual end seven — the studio's own.
    static let workHours: OpsWorkHours? = {
        let json = """
        {"days":[0,1,2,3,4,6],"start":"11:00","end":"19:00","lunchMinutes":30,"lunchAt":"14:00",
         "bufferMinutes":30,"graceMinutes":5,"endByDay":{"6":"18:00"}}
        """
        return try? JSONDecoder().decode(OpsWorkHours.self, from: Data(json.utf8))
    }()

    private static func key(_ day: Int) -> String {
        String(format: "%@-%02d", monthKey, day)
    }

    private static func row(id: String, name: String, days: [Int: Day]) -> String {
        let cells = (1...31).map { day -> String in
            guard let entry = days[day] else { return "null" }
            let breaks = entry.breaks.map { "{\"out\":\"\($0.0)\",\"back\":\"\($0.1)\"}" }.joined(separator: ",")
            let note = entry.note.map { "\"\($0)\"" } ?? "null"
            return """
            {"employeeId":"\(id)","dayKey":"\(key(day))","delayHours":\(entry.delay),"earlyHours":\(entry.early),"awayHours":\(entry.away),
             "breaks":[\(breaks)],"clockedOut":\(entry.clockedOut),"source":"\(entry.source)","note":\(note)}
            """
        }
        let recorded = days.values
        let late = recorded.reduce(0) { $0 + $1.delay }
        let early = recorded.reduce(0) { $0 + $1.early }
        let away = recorded.reduce(0) { $0 + $1.away }
        let noClockOut = recorded.filter { !$0.clockedOut }.count
        return """
        {"employeeId":"\(id)","name":"\(name)","active":true,"cells":[\(cells.joined(separator: ","))],
         "daysRecorded":\(recorded.count),"hoursLate":\(late),"hoursEarly":\(early),"hoursAway":\(away),"daysWithoutClockOut":\(noClockOut)}
        """
    }
}
#endif
