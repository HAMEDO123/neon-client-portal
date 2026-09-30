import SwiftUI

/// The fingerprint machine's own screen: is it there, is its clock right, who
/// is enrolled, what a manager can do to it from their desk, and a month at a
/// time of what it has recorded. Mirrors admin/(dashboard)/attendance — read
/// on render, degrading rather than failing when the device is unplugged.
///
/// Pushed from More, so no `NavigationStack` of its own.
struct AttendanceRootView: View {
    @EnvironmentObject var api: APIClient

    @State private var overview: AttendanceOverview?
    @State private var overviewError: String?
    @State private var overviewCachedAt: Date?

    @State private var month: AttendanceMonth?
    @State private var monthError: String?
    @State private var monthCachedAt: Date?
    @State private var monthKey: String?

    var body: some View {
        ScrollViewReader { proxy in
            NeonScroll {
                // The month is what the owner opens this page for, and it is
                // already loaded — so it leads, ahead of the device read,
                // which is slow and times out when the reader is unplugged.
                SectionHeader(L("Recorded")) { monthControl }
                    .id("month")
                Text(L("A person with no days here had nothing recorded — not that they were absent."))
                    .font(.neonFootnote)
                    .foregroundStyle(Color.neonTextTertiary)

                LoadStateView(value: month, error: monthError, cachedAt: monthCachedAt, retry: loadMonth) { month in
                    if month.rows.allSatisfy({ $0.daysRecorded == 0 }) {
                        EmptyState(symbol: "calendar.badge.clock", title: L("Nothing recorded this month"), hue: .grey, card: true)
                    } else {
                        CardList(month.rows.sorted { $0.hoursLate > $1.hoursLate || ($0.hoursLate == $1.hoursLate && $0.name < $1.name) }) { row in
                            NavigationLink(value: AttendancePersonRoute(row: row, monthKey: month.monthKey)) {
                                ListRow(
                                    row.name,
                                    subtitle: row.daysRecorded == 0 ? L("Nothing recorded") : daysRecordedLabel(row.daysRecorded),
                                    leading: .avatar(url: nil, name: row.name),
                                    value: row.hoursLate > 0 ? L("Late %@", describeMinutes(row.hoursLate * 60)) : nil,
                                    badge: row.active ? nil : L("Left the team"),
                                    badgeTone: .neutral,
                                    chevron: true
                                )
                            }
                            .buttonStyle(.pressableCard)
                        }
                    }
                }

                // The device below the month: a slow or unplugged reader now
                // costs one skeleton card here, never the top of the page.
                LoadStateView(
                    value: overview, error: overviewError, cachedAt: overviewCachedAt, retry: loadOverview,
                    placeholder: {
                        SkeletonCard(lines: 2)
                        MetaLabel(L("Asking the device…"), symbol: "touchid")
                    }
                ) { overview in
                    DeviceStatusCard(overview: overview)
                        .neonAppear()
                    AttendanceConsoleCard()
                        .neonAppear(delay: 0.03)
                    NavigationLink(value: AttendanceDeviceRoute()) {
                        ListRow(
                            L("The device"),
                            subtitle: overview.device.map { "\($0.ip):\($0.port) · \(L("%d enrolled", overview.users.count))" }
                                ?? L("No device configured"),
                            leading: .icon("externaldrive.badge.person.crop", tint: .neonIndigoStrong),
                            chevron: true
                        )
                    }
                    .buttonStyle(.pressableCard)
                    .neonSurface(.solid, radius: NeonRadius.md)
                    .neonAppear(delay: 0.06)
                }
            }
            .debugScroll(proxy)
        }
        .refreshable { await loadAll() }
        .navigationTitle(L("Attendance"))
        .navigationDestination(for: AttendancePersonRoute.self) { route in
            AttendancePersonDetail(
                row: route.row,
                days: month?.days ?? [],
                monthKey: route.monthKey,
                recordIds: month?.recordIds ?? [:],
                onChanged: { await loadMonth() }
            )
        }
        .navigationDestination(for: AttendanceDeviceRoute.self) { _ in
            if let overview {
                AttendanceDeviceDetail(overview: overview, onChanged: { await loadOverview() })
            }
        }
        .neonAmbientBackground()
        .task { await loadAll() }
    }

    /// "‹ September 2026 ›" with ≥44pt hit areas either side, in place of
    /// bare 12pt chevrons — and a header title that no longer says "this
    /// month" once you've paged away from it.
    private var monthControl: some View {
        HStack(spacing: 2) {
            IconButton("chevron.backward", label: L("Previous month"), look: .plain, size: 20) { shiftMonth(-1) }
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
            Text(monthLabel(monthKey ?? month?.thisMonth ?? ""))
                .font(.neonCallout)
                .monospacedDigit()
                .frame(minWidth: 84)
            IconButton("chevron.forward", label: L("Next month"), look: .plain, size: 20) { shiftMonth(1) }
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
    }

    private func loadAll() async {
        async let a: () = loadOverview()
        async let b: () = loadMonth()
        _ = await (a, b)
    }

    private func loadOverview() async {
        do {
            let loaded = try await api.opsAttendanceOverview()
            overview = loaded.value
            overviewCachedAt = loaded.cachedAt
            overviewError = nil
        } catch {
            overviewError = error.localizedDescription
        }
    }

    private func loadMonth() async {
        do {
            let loaded = try await api.opsAttendanceMonth(month: monthKey)
            month = loaded.value
            monthCachedAt = loaded.cachedAt
            monthError = nil
        } catch {
            monthError = error.localizedDescription
        }
    }

    private func shiftMonth(_ delta: Int) {
        let base = monthKey ?? month?.thisMonth ?? NeonFormat.dayKey(Date()).prefix(7).description
        let parts = base.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return }
        var year = parts[0]
        var value = parts[1] + delta
        if value < 1 { value = 12; year -= 1 }
        if value > 12 { value = 1; year += 1 }
        monthKey = String(format: "%04d-%02d", year, value)
        Haptic.selection()
        Task { await loadMonth() }
    }
}

struct AttendancePersonRoute: Hashable {
    let row: AttendanceMonth.Row
    let monthKey: String

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.row.employeeId == rhs.row.employeeId && lhs.monthKey == rhs.monthKey }
    func hash(into hasher: inout Hasher) { hasher.combine(row.employeeId); hasher.combine(monthKey) }
}

/// A marker route (there's only ever one device) to the pushed page that
/// holds the enrolled-people, pairing and wipe-the-log cards — the
/// device-admin cards that don't belong in the everyday scroll, one of
/// which (Wipe) is destructive.
struct AttendanceDeviceRoute: Hashable {}

/// The device's own page: who is enrolled on it, how the team is paired to
/// it, and the one place that can wipe its log. Reached from the root by
/// its own `ListCardRow`, so a destructive card is never part of the scroll
/// somebody opens every day just to see who was in on time.
private struct AttendanceDeviceDetail: View {
    let overview: AttendanceOverview
    let onChanged: () async -> Void

    var body: some View {
        NeonScroll {
            DeviceUsersCard(overview: overview, onChanged: onChanged)
                .neonAppear()
            PairingCard(overview: overview, onChanged: onChanged)
                .neonAppear(delay: 0.03)
            WipeLogCard(canReach: overview.canReach)
                .neonAppear(delay: 0.06)
        }
        .navigationTitle(L("The device"))
        .navigationBarTitleDisplayMode(.inline)
        .neonAmbientBackground()
    }
}

// MARK: - Device status

private struct DeviceStatusCard: View {
    let overview: AttendanceOverview

    var body: some View {
        SectionCard(
            L("Attendance device"),
            subtitle: overview.device.map { "\($0.ip):\($0.port)" } ?? L("No device configured"),
            symbol: "touchid",
            hue: overview.canReach ? .green : .grey
        ) {
            if overview.canReach {
                BadgeView(text: L("Reachable"), tone: .success, symbol: "checkmark.circle.fill")
            }

            if let error = overview.reachError {
                StatusNote(symbol: "exclamationmark.triangle.fill", tone: .warning, title: L("The device did not answer"), detail: error)
            }

            if let clock = overview.clock {
                StatGrid(columns: 3) {
                    StatTile(L("Its clock"), text: clock.wallClock, symbol: "clock")
                    StatTile(
                        L("Out by"),
                        text: abs(clock.driftSeconds) < 90 ? "\(clock.driftSeconds)s" : L("%d min", clock.driftSeconds / 60),
                        symbol: "gauge",
                        tint: overview.driftBad ? .neonWarningStrong : .neonPurpleStrong
                    )
                    StatTile(L("Enrolled"), value: Double(overview.users.count), symbol: "person.2")
                }
            }

            if overview.driftBad {
                StatusNote(
                    symbol: "exclamationmark.triangle.fill",
                    tone: .warning,
                    title: L("Nothing will be recorded while it is this far out"),
                    detail: L("Set its clock. If it keeps drifting back, its backup battery needs replacing.")
                )
            }
        }
    }
}

// MARK: - Console: sync, set clock

private struct AttendanceConsoleCard: View {
    @EnvironmentObject var api: APIClient
    @State private var syncReport: SyncReport?
    @State private var clockResult: ClockResult?

    var body: some View {
        SectionCard(L("Sync with the device"), symbol: "arrow.triangle.2.circlepath", hue: .blue) {
            HStack(spacing: 10) {
                NeonButton(L("Sync today"), symbol: "arrow.triangle.2.circlepath", kind: .primary, size: .medium) {
                    let report = try? await api.opsSyncAttendanceNow()
                    syncReport = report
                }
                NeonButton(L("Set its clock"), symbol: "clock.badge", kind: .secondary, size: .medium) {
                    let result = try? await api.opsSetDeviceClockNow()
                    clockResult = result
                }
            }

            if let clockResult {
                if clockResult.ok {
                    let far = (clockResult.driftSeconds ?? 0).magnitude > 60
                    StatusNote(
                        symbol: "checkmark.circle.fill",
                        tone: .success,
                        title: L("Clock set"),
                        detail: far
                            ? L("The device now reads %@ — still %ds out, which usually means its backup battery is dead.", clockResult.wallClock ?? "", clockResult.driftSeconds ?? 0)
                            : L("The device now reads %@.", clockResult.wallClock ?? "")
                    )
                } else {
                    StatusNote(symbol: "exclamationmark.triangle.fill", tone: .warning, title: L("Could not set the clock"), detail: clockResult.error ?? clockResult.reason)
                }
            }

            if let syncReport {
                SyncReportNote(report: syncReport)
            }
        }
    }
}

private struct SyncReportNote: View {
    let report: SyncReport

    var body: some View {
        if !report.ran {
            StatusNote(symbol: "exclamationmark.triangle.fill", tone: .warning, title: reasonTitle, detail: reasonDetail)
        } else {
            StatusNote(symbol: "checkmark.circle.fill", tone: .success, title: L("Synced"), detail: summary)
        }
    }

    private var reasonTitle: String {
        switch report.reason {
        case "no-device-configured": return L("No device is configured")
        case "unreachable": return L("The device did not answer")
        default: return L("Nothing written")
        }
    }

    private var reasonDetail: String? {
        switch report.reason {
        case "unreachable": return report.error
        case "clock-wrong": return L("The device reads %@, which is %d minutes out. Set its clock first.", report.deviceTime ?? "", (report.driftSeconds ?? 0) / 60)
        default: return nil
        }
    }

    private var summary: String {
        var parts: [String] = []
        let punches = report.punches ?? 0
        parts.append(punches == 1 ? L("Read 1 punch") : L("Read %d punches", punches))
        if let outcome = report.outcome {
            parts.append(outcome.created == 1 ? L("recorded 1 new day") : L("recorded %d new days", outcome.created))
            if outcome.updated > 0 { parts.append(L("corrected %d", outcome.updated)) }
            if outcome.keptManual > 0 { parts.append(L("%d left exactly as set by hand", outcome.keptManual)) }
            if outcome.skippedInactive > 0 { parts.append(L("%d skipped — no longer on the team", outcome.skippedInactive)) }
            if !outcome.unmapped.isEmpty { parts.append(L("nobody is paired with %@", outcome.unmapped.joined(separator: ", "))) }
        }
        if punches > 0 && (report.days ?? 0) == 0 { parts.append(L("nothing from today")) }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Enrolled users

private struct DeviceUsersCard: View {
    let overview: AttendanceOverview
    let onChanged: () async -> Void

    @EnvironmentObject var api: APIClient
    @State private var showAdd = false
    @State private var removing: AttendanceOverview.DeviceUser?
    @State private var result: DeviceWrite?

    var body: some View {
        SectionCard(
            L("Enrolled on the device"),
            subtitle: L("%d people", overview.users.count),
            symbol: "person.crop.circle.badge.checkmark",
            hue: .purple
        ) {
            if overview.users.isEmpty {
                EmptyState(
                    symbol: "person.crop.circle.badge.questionmark",
                    title: overview.canReach ? L("Nobody is enrolled yet") : L("Cannot read the device just now"),
                    hue: .grey
                )
            } else {
                ForEach(overview.users) { user in
                    let person = overview.pairedByDeviceUserId[user.deviceUserId]
                    ListRow(
                        user.name.isEmpty ? L("Number %@", user.deviceUserId) : user.name,
                        subtitle: person != nil
                            ? (person!.active ? person!.name : L("%@ · no longer on the team", person!.name))
                            : L("Not paired — nothing is recorded for this number"),
                        meta: L("Number %@", user.deviceUserId),
                        leading: .icon(user.isAdmin ? "person.badge.key.fill" : "person.fill"),
                        chevron: false
                    )
                    .neonSurface(.sunken, radius: NeonRadius.md)
                    .contextMenu {
                        Button(role: .destructive) { removing = user } label: { Label(L("Remove"), systemImage: "trash") }
                    }
                }
            }

            if let result {
                StatusNote(
                    symbol: result.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill",
                    tone: result.ok ? .success : .warning,
                    title: result.ok ? (result.message ?? L("Done")) : L("Could not remove them"),
                    detail: result.ok ? nil : result.error
                )
            }
        } trailing: {
            IconButton("plus", label: L("Add")) { showAdd = true }
        }
        .sheet(isPresented: $showAdd) {
            AddDeviceUserSheet(nextNumber: nextSuggestedNumber) { await onChanged() }
        }
        .confirmDestructive(
            item: $removing,
            title: { L("Remove %@ from the device?", $0.name.isEmpty ? L("this person") : $0.name) },
            message: { _ in L("Their past punches stay in its log; the person is removed.") },
            actionTitle: L("Remove")
        ) { user in
            Task {
                let write = try? await api.opsDeleteDeviceUser(uid: user.uid, deviceUserId: user.deviceUserId)
                result = write
                await onChanged()
            }
        }
    }

    private var nextSuggestedNumber: String {
        String((overview.users.compactMap { Int($0.deviceUserId) }.max() ?? 0) + 1)
    }
}

private struct AddDeviceUserSheet: View {
    let onAdded: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var number: String
    @State private var name = ""
    @State private var error: String?

    init(nextNumber: String, onAdded: @escaping () async -> Void) {
        self.onAdded = onAdded
        _number = State(initialValue: nextNumber)
    }

    var body: some View {
        SheetScaffold(
            L("Add to device"),
            subtitle: L("This creates the record, not the fingerprint — the person still has to put their finger on the reader at the machine."),
            symbol: "person.badge.plus",
            primaryTitle: L("Add to device"),
            isPrimaryEnabled: !number.trimmingCharacters(in: .whitespaces).isEmpty && !name.trimmingCharacters(in: .whitespaces).isEmpty
        ) {
            let write = try? await api.opsAddDeviceUser(deviceUserId: number, name: name)
            if write?.ok == true {
                Toast.success(write?.message ?? L("Added"))
                dismiss()
                await onAdded()
            } else {
                error = write?.error ?? L("That did not save.")
            }
        } content: {
            FormSection {
                NeonTextField(L("Number"), text: $number, symbol: "number", isRequired: true, keyboard: .numberPad)
                NeonTextField(L("Name on the device"), text: $name, symbol: "textformat", isRequired: true)
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.medium])
    }
}

// MARK: - Pairing

private struct PairingCard: View {
    let overview: AttendanceOverview
    let onChanged: () async -> Void

    @State private var editing: AttendanceOverview.Employee?

    var body: some View {
        SectionCard(L("Pair people"), subtitle: L("By the device's number, never by name."), symbol: "person.2.badge.gearshape", hue: .indigo) {
            ForEach(overview.employees) { employee in
                Button { editing = employee } label: {
                    ListRow(
                        employee.name,
                        subtitle: employee.role,
                        leading: .icon("person.fill", tint: NeonPalette.color(for: employee.name)),
                        value: employee.deviceUserId ?? L("Not paired"),
                        chevron: true
                    )
                }
                .buttonStyle(.pressableCard)
            }
        }
        .sheet(item: $editing) { employee in
            PairEmployeeSheet(employee: employee) { await onChanged() }
        }
    }
}

private struct PairEmployeeSheet: View {
    let employee: AttendanceOverview.Employee
    let onPaired: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var number: String
    @State private var error: String?

    init(employee: AttendanceOverview.Employee, onPaired: @escaping () async -> Void) {
        self.employee = employee
        self.onPaired = onPaired
        _number = State(initialValue: employee.deviceUserId ?? "")
    }

    var body: some View {
        SheetScaffold(employee.name, subtitle: L("Device number"), symbol: "number", primaryTitle: L("Save")) {
            do {
                try await api.opsSetDeviceUserId(employeeId: employee.id, deviceUserId: number)
                Toast.success(L("Paired"))
                dismiss()
                await onPaired()
            } catch {
                self.error = error.localizedDescription
            }
        } content: {
            FormSection {
                NeonTextField(L("Number"), text: $number, prompt: L("empty to clear"), symbol: "number", keyboard: .numberPad)
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.medium])
    }
}

// MARK: - Wipe the log

private struct WipeLogCard: View {
    let canReach: Bool

    @EnvironmentObject var api: APIClient
    @State private var confirmText = ""
    @State private var showSheet = false
    @State private var result: DeviceWrite?

    var body: some View {
        NeonCard(.tinted(.neonDangerStrong)) {
            HStack(spacing: 10) {
                IconTile("trash", hue: .red, size: NeonSize.iconTile)
                SectionLabel(L("Wipe the device's log"))
            }
            Text(L("This cannot be undone, and it destroys arrivals that exist nowhere else — a sync only records days from its cutoff onward."))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextSecondary)
            NeonButton(L("Wipe the log…"), symbol: "trash", kind: .destructive, size: .medium) {
                showSheet = true
            }
            .disabled(!canReach)

            if let result {
                StatusNote(
                    symbol: result.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill",
                    tone: result.ok ? .success : .warning,
                    title: result.ok ? (result.message ?? L("Done")) : L("Nothing was cleared"),
                    detail: result.ok ? nil : result.error
                )
            }
        }
        .sheet(isPresented: $showSheet) {
            SheetScaffold(
                L("Wipe the device's log"),
                subtitle: L("Type WIPE to confirm."),
                symbol: "trash",
                primaryTitle: L("Clear the log"),
                primaryKind: .destructive,
                isPrimaryEnabled: confirmText.uppercased() == "WIPE"
            ) {
                let write = try? await api.opsClearDeviceAttendanceLog()
                result = write
                showSheet = false
            } content: {
                FormSection {
                    NeonTextField(L("Type WIPE"), text: $confirmText, capitalization: .characters, autocorrect: false)
                }
            }
            .neonSheet([.medium])
        }
    }
}

// MARK: - Month navigation and drill-down

/// "September 2026" from a "YYYY-MM" key — `monthLabel` in attendance-month.ts.
private func monthLabel(_ monthKey: String) -> String {
    let parts = monthKey.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2, let date = parseISODate(String(format: "%04d-%02d-01T00:00:00.000Z", parts[0], parts[1])) else {
        return monthKey
    }
    var style = Date.FormatStyle.dateTime.month(.wide).year().locale(AppLanguage.current.locale)
    style.timeZone = TimeZone(identifier: "UTC")!
    return date.formatted(style)
}

private struct RecordedDay: Identifiable {
    let day: AttendanceMonth.Day
    let entry: AttendanceMonth.Entry
    var id: String { day.dayKey }
}

/// One person's month, day by day — the drill-down from the summary list.
/// Tapping a recorded day, or "Correct a day" for one with nothing on it,
/// opens `AttendanceCorrectionSheet` — the payroll screen's own
/// `setAttendance`/`deleteAttendance`, carried over unchanged.
struct AttendancePersonDetail: View {
    let row: AttendanceMonth.Row
    let days: [AttendanceMonth.Day]
    let monthKey: String
    let recordIds: [String: String]
    let onChanged: () async -> Void

    @State private var correcting: RecordedDay?
    @State private var addingDayKey: String?

    /// Manual entries at zero delay are a stand-in the manager typed, not a
    /// measured day — "Days recorded" shouldn't read as though the device
    /// vouched for all of them without saying so.
    private var handSetCount: Int {
        row.cells.compactMap { $0 }.filter { $0.source == "MANUAL" && $0.delayHours == 0 && ($0.earlyHours ?? 0) == 0 }.count
    }

    var body: some View {
        NeonScroll {
            StatGrid {
                StatTile(
                    L("Days recorded"), value: Double(row.daysRecorded), symbol: "calendar",
                    caption: handSetCount > 0 ? L("%d set by hand", handSetCount) : nil
                )
                // Same format the month list uses (`describeMinutes`), not a
                // decimal — one number format for the same figure everywhere.
                StatTile(
                    L("Late"), text: row.hoursLate > 0 ? describeMinutes(row.hoursLate * 60) : L("On time"),
                    symbol: "hourglass", tint: row.hoursLate > 0 ? .neonWarningStrong : .neonSuccessStrong
                )
            }

            let recorded = zip(days, row.cells).compactMap { day, entry in entry.map { RecordedDay(day: day, entry: $0) } }
            if recorded.isEmpty {
                EmptyState(
                    symbol: "calendar.badge.clock",
                    title: L("Nothing recorded this month"),
                    detail: L("An empty day means nothing was recorded — not that they were absent."),
                    actionTitle: L("Correct a day"),
                    action: { beginCorrection() }
                )
            } else {
                CardList(recorded) { entry in
                    let badge = attendanceBadge(entry.entry)
                    Button {
                        Haptic.selection()
                        correcting = entry
                    } label: {
                        ListRow(
                            // The weekday and day only: the page is already
                            // scoped to one month, so the year just crowded
                            // out the date and wrapped it to two lines.
                            formattedWeekdayDay(entry.day.dayKey),
                            subtitle: entry.entry.note,
                            meta: entry.entry.clockedOut == false ? L("no clock-out") : nil,
                            leading: .icon(
                                entry.day.worked ? "calendar" : "calendar.badge.exclamationmark",
                                tint: leadingTint(for: badge.tone, worked: entry.day.worked)
                            ),
                            badge: badge.text,
                            badgeTone: badge.tone,
                            chevron: true
                        )
                    }
                    .buttonStyle(.pressableCard)
                }

                // Discoverable next to the list, not only as a lone glyph in
                // the nav bar.
                Button { beginCorrection() } label: {
                    Label(L("Correct a day"), systemImage: "square.and.pencil")
                }
                .buttonStyle(.neon(.secondary, size: .medium))
            }
        }
        .navigationTitle(row.name)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { beginCorrection() } label: {
                    Label(L("Correct a day"), systemImage: "square.and.pencil")
                }
            }
        }
        .sheet(item: $correcting) { entry in
            AttendanceCorrectionSheet(
                employeeId: row.employeeId,
                employeeName: row.name,
                dayKey: entry.day.dayKey,
                recordId: recordIds["\(row.employeeId)|\(entry.day.dayKey)"],
                entry: entry.entry,
                onSaved: onChanged
            )
        }
        .sheet(item: Binding(get: { addingDayKey.map { IdentifiedDayKey($0) } }, set: { addingDayKey = $0?.value })) { boxed in
            AttendanceCorrectionSheet(
                employeeId: row.employeeId,
                employeeName: row.name,
                dayKey: boxed.value,
                onSaved: onChanged
            )
        }
        .neonAmbientBackground()
    }

    private func beginCorrection() {
        addingDayKey = days.first(where: { $0.isToday })?.dayKey ?? days.last?.dayKey ?? monthKey
    }
}

private struct IdentifiedDayKey: Identifiable {
    let value: String
    var id: String { value }
    init(_ value: String) { self.value = value }
}

/// The leading tile's tint, matched to the same status the trailing badge
/// gives, so the column scans without reading every badge.
private func leadingTint(for tone: BadgeTone, worked: Bool) -> Color {
    guard worked else { return .neonTextFaint }
    switch tone {
    case .warning: return .neonWarningStrong
    case .neutral: return .neonTextFaint
    default: return .neonSuccessStrong
    }
}
