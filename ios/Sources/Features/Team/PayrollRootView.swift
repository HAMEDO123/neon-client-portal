import SwiftUI

/// The month's pay sheet — mirrors `src/app/admin/(dashboard)/payroll/page.tsx`:
/// what each person earns, how late they were, what they are owed back, and
/// what that leaves. The arithmetic is the server's (`lib/payroll.ts`); this
/// screen only shows and edits it.
struct PayrollRootView: View {
    @EnvironmentObject var api: APIClient
    @State private var response: TeamPayrollResponse?
    @State private var errorMessage: String?
    @State private var cachedAt: Date?
    @State private var period: String?
    @State private var editingPay: TeamPayrollEmployeeInfo?
    @State private var editingReceipt: TeamReceipt?
    @State private var showRecordAttendance = false
    @State private var showAllAttendance = false
    @State private var removingAttendance: TeamAttendanceRecord?

    var body: some View {
        ScrollViewReader { proxy in
            NeonScroll {
                LoadStateView(value: response, error: errorMessage, cachedAt: cachedAt, retry: { await load() }) { data in
                    periodSwitch(data).id("totals")
                    totals(data)
                    paySheet(data).id("paysheet")
                    attendanceSection(data).id("attendance")
                    receiptsSection(data).id("receipts")
                }
            }
            #if DEBUG
            .debugScroll(proxy)
            #endif
        }
        .refreshable {
            Haptic.tap()
            await load()
        }
        .navigationTitle(L("Payroll"))
        .sheet(item: $editingPay) { info in
            EditPaySheet(employee: info) { await load() }
        }
        .sheet(item: $editingReceipt) { receipt in
            CorrectReceiptSheet(receipt: receipt) { await load() }
        }
        .sheet(isPresented: $showRecordAttendance) {
            if let data = response {
                RecordAttendanceSheet(employees: data.employees) { await load() }
            }
        }
        .sheet(isPresented: $showAllAttendance) {
            if let data = response {
                AttendanceListSheet(records: employeeAttendance(data)) { record in
                    removingAttendance = record
                }
            }
        }
        .confirmDestructive(
            item: $removingAttendance,
            title: { _ in L("Remove this delay record?") },
            actionTitle: L("Remove")
        ) { record in
            Task { await deleteAttendance(record) }
        }
        .task {
            if response == nil { await load() }
        }
    }

    /// `team/payroll`'s own `employees` list already asks the server for
    /// `accessRole: "EMPLOYEE"` only (see `EmployeesRootView`'s note on the
    /// same gap on the Employees list), so filtering attendance to ids it
    /// contains is what keeps the manager's own device-pairing row — Hamed —
    /// out of the team's payroll data, with no server change needed here.
    private func employeeAttendance(_ data: TeamPayrollResponse) -> [TeamAttendanceRecord] {
        let ids = Set(data.employees.map(\.id))
        return data.attendance.filter { ids.contains($0.employeeId) }
    }

    // MARK: - Header

    @ViewBuilder
    private func periodSwitch(_ data: TeamPayrollResponse) -> some View {
        HStack(spacing: 12) {
            IconButton("chevron.backward", label: L("Previous month"), look: .glass, size: NeonSize.circleButton) {
                Task { await load(period: data.previousPeriod) }
            }
            Text(teamMonthYearLabel(data.period))
                .font(.neonTitle2)
                .foregroundStyle(Color.neonInk)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
            if !data.isThisMonth {
                IconButton("chevron.forward", label: L("This month"), look: .glass, size: NeonSize.circleButton) {
                    Task { await load(period: data.thisMonth) }
                }
            } else {
                Color.clear.frame(width: NeonSize.circleButton, height: NeonSize.circleButton)
            }
        }
    }

    @ViewBuilder
    private func totals(_ data: TeamPayrollResponse) -> some View {
        let totals = data.totals
        let weeklyCount = data.rows.filter { $0.employee.payBasis == "WEEKLY" }.count

        // The one figure the owner reads first, full width, green (money),
        // whole dinars in the headline with the exact fils underneath —
        // rather than every tile shrinking its own font to fit, which made
        // whichever number happened to be shortest read as the loudest.
        KPICard(
            L("Total payable"), value: totals.final, format: .money, symbol: "banknote", hue: .green,
            caption: weeklyCount > 0
                ? L("%@ exactly · includes %d weekly", NeonFormat.money(totals.final, decimals: 2), weeklyCount)
                : L("%@ exactly", NeonFormat.money(totals.final, decimals: 2))
        ) { EmptyView() }

        StatGrid(columns: 3) {
            KPICard(L("Team"), value: Double(totals.team), format: .integer, symbol: "person.2.fill", hue: .blue, density: .compact) { EmptyView() }
            KPICard(
                data.isThisMonth ? L("Deducted so far") : L("Total deducted"),
                value: totals.cut, format: .moneyDecimals(2), symbol: "arrow.down.circle", hue: .red, density: .compact
            ) { EmptyView() }
            KPICard(
                L("Receipts owed"), value: totals.receipts, format: .moneyDecimals(2), symbol: "receipt", hue: .cyan,
                trend: totals.receipts == 0 ? .steady() : nil, density: .compact
            ) { EmptyView() }
        }

        Text(L("Salary ÷ working days ÷ 8 gives the hourly rate, times hours late is the cutoff, plus receipts."))
            .font(.neonCaption)
            .foregroundStyle(Color.neonTextSecondary)
    }

    // MARK: - Pay sheet

    @ViewBuilder
    private func paySheet(_ data: TeamPayrollResponse) -> some View {
        SectionHeader(L("Pay sheet"), count: data.rows.count)
        if data.rows.isEmpty {
            EmptyState(symbol: "wallet.pass", title: L("No employees yet"))
        } else {
            VStack(spacing: 10) {
                ForEach(data.rows) { row in
                    PayrollRow(row: row) {
                        Haptic.tap()
                        editingPay = row.employee
                    }
                }
            }
        }
    }

    // MARK: - Attendance

    @ViewBuilder
    private func attendanceSection(_ data: TeamPayrollResponse) -> some View {
        let filtered = employeeAttendance(data)
        let latest = Array(filtered.filter { $0.delayHours > 0 }.sorted { $0.day > $1.day }.prefix(5))

        SectionCard(
            L("Arrival delays"), subtitle: L("The fingerprint device writes these too, and never overwrites a figure you typed."),
            symbol: "hourglass", hue: .orange, actionTitle: L("View All")
        ) {
            showAllAttendance = true
        } content: {
            if latest.isEmpty {
                EmptyState(symbol: "hourglass", title: L("No delays recorded"), hue: .orange)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(latest.enumerated()), id: \.element.id) { index, record in
                        if index > 0 { NeonDivider() }
                        attendanceRow(record)
                    }
                }
            }
            NeonButton(L("Record a delay"), symbol: "plus", kind: .secondary, size: .small, fullWidth: false) {
                showRecordAttendance = true
            }
        }

        DeviceIdsCard(employees: data.employees) { await load() }
    }

    private func attendanceRow(_ record: TeamAttendanceRecord) -> some View {
        HStack(spacing: 8) {
            ListRow(record.employeeName, subtitle: record.note, meta: formattedDay(record.day), value: lateHoursText(record.delayHours))
            IconButton("trash", label: L("Remove"), look: .plain, size: NeonSize.touch) {
                Haptic.tap()
                removingAttendance = record
            }
        }
    }

    private func deleteAttendance(_ record: TeamAttendanceRecord) async {
        do {
            try await api.perform("team/deleteAttendance", args: [record.id])
            Haptic.tap()
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    // MARK: - Receipts

    @ViewBuilder
    private func receiptsSection(_ data: TeamPayrollResponse) -> some View {
        SectionCard(L("Receipts"), subtitle: L("Each receipt counts up to 2 JOD."), symbol: "receipt", hue: .cyan) {
            if data.receipts.isEmpty {
                EmptyState(symbol: "text.viewfinder", title: L("No receipts this month"), hue: .cyan)
            } else {
                VStack(spacing: 8) {
                    ForEach(data.receipts) { receipt in
                        receiptRow(receipt)
                    }
                }
            }
            Text(L("Read from the photo automatically — correct the amount if the reading is wrong."))
                .font(.neonCaption)
                .foregroundStyle(Color.neonTextTertiary)
        }
    }

    private func receiptRow(_ receipt: TeamReceipt) -> some View {
        Button {
            Haptic.tap()
            editingReceipt = receipt
        } label: {
            HStack(spacing: 12) {
                RemoteImage(url: resolvedMediaURL(receipt.imageUrl), contentMode: .fill)
                    .frame(width: 46, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    DirText(receipt.employeeName, font: .neonSubheadline, color: .neonInk)
                    DirText(receipt.summary ?? receipt.aiNotes ?? L("No description"), font: .neonCaption, color: .neonTextSecondary, lineLimit: 2)
                }
                Spacer(minLength: 0)
                Text(NeonFormat.money(receipt.countedAmount ?? 0, decimals: 2))
                    .font(.neonNumberSmall)
                    .foregroundStyle(Color.neonSuccessStrong)
            }
            .padding(10)
            .neonSurface(.sunken, radius: NeonRadius.md)
        }
        .buttonStyle(.pressableCard)
    }

    // MARK: - Loading

    private func load(period newPeriod: String? = nil) async {
        if let newPeriod { period = newPeriod }
        do {
            let loaded = try await api.read("team/payroll", ["period": period], as: TeamPayrollResponse.self)
            withNeonAnimation(NeonMotion.gentle) {
                response = loaded.value
                cachedAt = loaded.cachedAt
                errorMessage = nil
            }
        } catch {
            if response == nil { errorMessage = error.localizedDescription }
        }
    }
}

/// Lateness is whole hours, rounded up at the source (`lib/attendance.ts`
/// `Math.ceil`) — so a fractional figure here would only ever come from a
/// manually typed record, and is shown to that same precision rather than
/// always forcing 2 decimals onto a number that is normally a whole one.
private func lateHoursText(_ hours: Double) -> String {
    L("%@ h", NeonFormat.number(hours, decimals: hours.rounded() == hours ? 0 : 2))
}

// MARK: - Pay sheet row

private struct PayrollRow: View {
    let row: TeamPayrollRow
    var onEdit: () -> Void

    private var isWeekly: Bool { row.employee.payBasis == "WEEKLY" }
    private var hasSalary: Bool { row.employee.salaryAmount != nil }

    var body: some View {
        NeonCard(padding: 14) {
            Button(action: onEdit) {
                ListRow(
                    row.employee.name,
                    subtitle: row.employee.role,
                    leading: .avatar(url: nil, name: row.employee.name),
                    value: hasSalary ? NeonFormat.money(row.breakdown.finalPay, decimals: 2) : nil,
                    badge: hasSalary ? (isWeekly ? L("Weekly") : nil) : L("No salary set"),
                    badgeTone: hasSalary ? .info : .warning,
                    chevron: true
                )
            }
            .buttonStyle(.plain)

            if hasSalary {
                FlowRow {
                    MetaLabel(L("%@ · %@", NeonFormat.money(row.breakdown.salary, decimals: 2), isWeekly ? L("Weekly") : L("Monthly")), symbol: "banknote")
                    MetaLabel(L("%@/h", NeonFormat.money(row.breakdown.hourlyRate, decimals: 2)), symbol: "clock")
                    MetaLabel(L("Late %@", lateHoursText(row.breakdown.delayHours)), symbol: "hourglass")
                    MetaLabel(L("Cutoff −%@", NeonFormat.money(row.breakdown.cutoff, decimals: 2)), symbol: "minus.circle")
                    if row.breakdown.receiptTotal > 0 {
                        MetaLabel(L("Receipts +%@", NeonFormat.money(row.breakdown.receiptTotal, decimals: 2)), symbol: "plus.circle", tint: .neonSuccessStrong)
                    }
                }

                if !row.adjustments.isEmpty {
                    VStack(spacing: 6) {
                        ForEach(Array(row.adjustments.enumerated()), id: \.offset) { _, adjustment in
                            AdjustmentRow(adjustment: adjustment)
                        }
                    }
                }
            } else {
                StatusNote(
                    symbol: "banknote", tone: .warning, title: L("No salary set"),
                    detail: row.breakdown.delayHours > 0
                        ? L("%@ late this month can't be charged until there is one.", lateHoursText(row.breakdown.delayHours))
                        : L("Set a salary to start paying %@.", row.employee.name)
                )
                NeonButton(L("Set salary"), kind: .tinted(.neonSuccessStrong), size: .small, fullWidth: false, action: {
                    onEdit()
                })
            }
        }
    }
}

/// The employee's own message to the manager ("you completed 34 of 43
/// tasks…") is written in the second person and mixes the currency's order
/// with the figure above it. Where the sentence carries the studio's
/// "N of M tasks (P%)" shape, this reads it back out and draws it as an
/// ordinary row in the manager's own voice instead of printing the sentence
/// verbatim; a reason of a different shape still shows honestly (never
/// invented), just without a person addressing the manager as "you".
private struct AdjustmentRow: View {
    let adjustment: TeamAdjustment

    var body: some View {
        if let parsed = Self.parse(adjustment.reason) {
            ListRow(
                L("Performance"),
                subtitle: L("%d of %d tasks · %d%% — below 90%%", parsed.done, parsed.total, parsed.percent),
                leading: .icon("slider.horizontal.3", tint: .neonDangerStrong),
                value: NeonFormat.money(adjustment.amount, decimals: 2)
            )
        } else {
            ListRow(
                L("Performance"),
                subtitle: adjustment.reason,
                leading: .icon("slider.horizontal.3", tint: .neonDangerStrong),
                value: NeonFormat.money(adjustment.amount, decimals: 2)
            )
        }
    }

    private static func parse(_ text: String) -> (done: Int, total: Int, percent: Int)? {
        guard let regex = try? NSRegularExpression(pattern: #"(\d+) of (\d+) tasks \((\d+)%\)"#) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, range: range), match.numberOfRanges == 4 else { return nil }
        func int(at index: Int) -> Int? {
            guard let r = Range(match.range(at: index), in: text) else { return nil }
            return Int(text[r])
        }
        guard let done = int(at: 1), let total = int(at: 2), let percent = int(at: 3) else { return nil }
        return (done, total, percent)
    }
}

// MARK: - Attendance, the whole list

/// The month's full attendance behind "View All": every row the compact card
/// leaves out, including the zero-hour reader tests, grouped by day so the
/// same date isn't repeated on every row.
private struct AttendanceListSheet: View {
    let records: [TeamAttendanceRecord]
    var onDelete: (TeamAttendanceRecord) -> Void

    @Environment(\.dismiss) private var dismiss

    private var byDay: [(day: String, records: [TeamAttendanceRecord])] {
        let groups = Dictionary(grouping: records, by: \.day)
        return groups.keys.sorted(by: >).map { (day: $0, records: groups[$0] ?? []) }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(byDay, id: \.day) { group in
                    Section {
                        ForEach(group.records) { record in
                            ListRow(record.employeeName, subtitle: record.note, value: lateHoursText(record.delayHours))
                                .neonSurface(.solid, radius: NeonRadius.md)
                                .neonListRow()
                                .destructiveSwipe(L("Remove"), confirm: L("Remove this delay record?")) {
                                    onDelete(record)
                                }
                        }
                    } header: {
                        SectionLabel(formattedDay(group.day) ?? group.day)
                    }
                }
            }
            .neonListStyle()
            .navigationTitle(L("Arrival delays"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(L("Done")) { dismiss() }
                }
            }
        }
        .neonSheet([.large])
    }
}

// MARK: - Device ids (fingerprint pairing)

/// A setting touched once a year, for people who are — in the ordinary case
/// — already paired: collapsed behind "View All" so it isn't the loudest
/// block on the page, each row shows a Paired badge rather than a button
/// that looks identical whether or not there's anything to do, and Save
/// appears only once the typed number actually differs from what's saved.
private struct DeviceIdsCard: View {
    let employees: [TeamPayrollEmployee]
    var onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @State private var drafts: [String: String] = [:]
    @State private var saving: String?
    @State private var expanded = false

    var body: some View {
        SectionCard(
            L("Fingerprint pairing"), subtitle: L("Paired by the device's own user number, never by name."),
            symbol: "touchid", hue: .cyan,
            actionTitle: expanded ? L("Hide") : L("View All"), actionChevron: !expanded
        ) {
            withNeonAnimation(NeonMotion.smooth) { expanded.toggle() }
        } content: {
            if expanded {
                VStack(spacing: 12) {
                    ForEach(employees) { employee in
                        row(for: employee)
                    }
                }
            } else {
                let paired = employees.filter { $0.deviceUserId != nil }.count
                Text(L("%d of %d paired.", paired, employees.count))
                    .font(.neonFootnote)
                    .foregroundStyle(Color.neonTextSecondary)
            }
        }
    }

    @ViewBuilder
    private func row(for employee: TeamPayrollEmployee) -> some View {
        let saved = employee.deviceUserId
        let draft = drafts[employee.id] ?? saved ?? ""
        let changed = draft != (saved ?? "")

        VStack(alignment: .leading, spacing: 8) {
            ListRow(
                employee.name,
                leading: .avatar(url: nil, name: employee.name),
                value: saved,
                badge: saved != nil ? L("Paired") : nil,
                badgeTone: .success
            )
            HStack(spacing: 8) {
                NumberField(
                    L("Device no."),
                    value: Binding<Double?>(
                        get: { Double(drafts[employee.id] ?? saved ?? "") },
                        set: { drafts[employee.id] = $0.map { String(Int($0)) } ?? "" }
                    ),
                    decimals: 0
                )
                if changed {
                    NeonButton(L("Save"), kind: .tinted(.neonCyanStrong), size: .small, fullWidth: false, isLoading: saving == employee.id) {
                        await pair(employee, value: draft)
                    }
                }
            }
        }
    }

    private func pair(_ employee: TeamPayrollEmployee, value: String) async {
        saving = employee.id
        defer { saving = nil }
        do {
            try await api.perform("team/setDeviceUserId", args: [employee.id], form: ["deviceUserId": value])
            Haptic.success()
            Toast.success(L("Paired"))
            await onSaved()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

// MARK: - Sheets

// Not `private`: TeamScreens.swift opens it directly for screenshots.
struct EditPaySheet: View {
    let employee: TeamPayrollEmployeeInfo
    var onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var salaryAmount: Double?
    @State private var payBasis: String

    init(employee: TeamPayrollEmployeeInfo, onSaved: @escaping () async -> Void) {
        self.employee = employee
        self.onSaved = onSaved
        _salaryAmount = State(initialValue: employee.salaryAmount)
        _payBasis = State(initialValue: employee.payBasis)
    }

    var body: some View {
        SheetScaffold(L("Salary"), subtitle: employee.name, symbol: "banknote", primaryTitle: L("Save")) {
            await save()
        } content: {
            FormSection {
                MoneyField(L("Salary"), amount: $salaryAmount)
                MenuField(L("Paid"), selection: $payBasis, options: ["MONTHLY", "WEEKLY"], title: { $0 == "WEEKLY" ? L("Weekly (÷6÷8)") : L("Monthly (÷26÷8)") })
            }
        }
        .neonSheet([.medium])
    }

    private func save() async {
        do {
            try await api.perform("team/setEmployeePay", args: [employee.id], form: [
                "salaryAmount": salaryAmount.map { String($0) } ?? "",
                "payBasis": payBasis,
            ])
            Haptic.success()
            Toast.success(L("Saved"))
            dismiss()
            await onSaved()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

// Not `private`: TeamScreens.swift opens it directly for screenshots.
struct RecordAttendanceSheet: View {
    let employees: [TeamPayrollEmployee]
    var onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var employeeId: String?
    @State private var day = Date()
    @State private var delayHours: Double?
    @State private var note = ""

    var body: some View {
        SheetScaffold(
            L("Record a delay"),
            subtitle: L("Typed figures are never overwritten by the fingerprint device."),
            symbol: "hourglass.badge.plus",
            primaryTitle: L("Record"),
            isPrimaryEnabled: employeeId != nil && (delayHours ?? 0) > 0
        ) {
            await save()
        } content: {
            FormSection {
                MenuField(L("Employee"), selection: $employeeId, options: employees.map(\.id), title: { id in employees.first(where: { $0.id == id })?.name ?? id }, isRequired: true)
                DateField(L("Day"), date: $day, components: [.date], in: Date.distantPast...Date())
                NumberField(L("Hours late"), value: $delayHours, unit: L("h"), decimals: 0, symbol: "hourglass")
                NeonTextField(L("Note"), text: $note)
            }
        }
        .neonSheet([.medium])
        .task { if employeeId == nil { employeeId = employees.first?.id } }
    }

    private func save() async {
        guard let employeeId, let delayHours, delayHours > 0 else { return }
        do {
            try await api.perform("team/setAttendance", form: [
                "employeeId": employeeId,
                "day": NeonFormat.dayKey(day),
                "delayHours": String(delayHours),
                "note": note,
            ])
            Haptic.success()
            Toast.success(L("Recorded"))
            dismiss()
            await onSaved()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

// Not `private`: TeamScreens.swift opens it directly for screenshots.
struct CorrectReceiptSheet: View {
    let receipt: TeamReceipt
    var onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var vendor: String
    @State private var rawAmount: Double?

    init(receipt: TeamReceipt, onSaved: @escaping () async -> Void) {
        self.receipt = receipt
        self.onSaved = onSaved
        _vendor = State(initialValue: receipt.vendor ?? "")
        _rawAmount = State(initialValue: receipt.rawAmount)
    }

    var body: some View {
        SheetScaffold(L("Fix this receipt"), subtitle: receipt.employeeName, symbol: "receipt", primaryTitle: L("Save amount")) {
            await save()
        } content: {
            RemoteImage(url: resolvedMediaURL(receipt.imageUrl), contentMode: .fit)
                .frame(height: 220)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            FormSection {
                NeonTextField(L("Vendor"), text: $vendor)
                MoneyField(L("Amount on the receipt"), amount: $rawAmount)
                KeyValueRow(L("Counts as"), value: NeonFormat.money(min(rawAmount ?? 0, 2), decimals: 2))
            }
        }
        .neonSheet([.large])
    }

    private func save() async {
        do {
            try await api.perform("team/correctReceipt", args: [receipt.id], form: [
                "vendor": vendor,
                "rawAmount": rawAmount.map { String($0) } ?? "",
            ])
            Haptic.success()
            Toast.success(L("Updated"))
            dismiss()
            await onSaved()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}
