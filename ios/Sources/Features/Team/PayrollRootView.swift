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
    @State private var removingAttendance: TeamAttendanceRecord?

    var body: some View {
        ScrollViewReader { proxy in
            NeonScroll {
                LoadStateView(value: response, error: errorMessage, cachedAt: cachedAt, retry: { await load() }) { data in
                    periodSwitch(data).id("totals")
                    totals(data.totals, isThisMonth: data.isThisMonth)
                    paySheet(data).id("paysheet")
                    salaries(data).id("salaries")
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

    // MARK: - Header

    @ViewBuilder
    private func periodSwitch(_ data: TeamPayrollResponse) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(data.periodLabel).font(.neonTitle2).foregroundStyle(Color.neonInk)
                Text(L("Salary ÷ working days ÷ 8 gives the hourly rate, times hours late is the cutoff, plus receipts."))
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextSecondary)
            }
            Spacer(minLength: 0)
        }
        HStack(spacing: 8) {
            Chip(L("Previous month"), symbol: "chevron.backward") { Task { await load(period: data.previousPeriod) } }
            if !data.isThisMonth {
                Chip(L("This month"), symbol: "calendar") { Task { await load(period: data.thisMonth) } }
            }
        }
    }

    @ViewBuilder
    private func totals(_ totals: TeamPayrollTotals, isThisMonth: Bool) -> some View {
        StatGrid(columns: 2) {
            StatTile(L("Team"), value: Double(totals.team), format: .integer, symbol: "person.2")
            StatTile(isThisMonth ? L("Deducted so far") : L("Total deducted"), value: totals.cut, format: .moneyDecimals(2), symbol: "arrow.down.circle", tint: .neonDangerStrong)
            StatTile(L("Receipts owed"), value: totals.receipts, format: .moneyDecimals(2), symbol: "receipt", tint: .neonSuccessStrong)
            StatTile(L("Total payable"), value: totals.final, format: .moneyDecimals(2), symbol: "banknote", tint: .neonPurpleStrong)
        }
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
                    PayrollRow(row: row, isThisMonth: data.isThisMonth)
                }
            }
        }
    }

    // MARK: - Salaries

    @ViewBuilder
    private func salaries(_ data: TeamPayrollResponse) -> some View {
        SectionHeader(L("Salaries"))
        CardList(data.rows.map(\.employee), id: \.id) { employee in
            Button {
                Haptic.tap()
                editingPay = employee
            } label: {
                ListRow(
                    employee.name,
                    subtitle: employee.salaryAmount == nil ? L("Not set") : L("%@ · %@", NeonFormat.money(employee.salaryAmount!, decimals: 2), employee.payBasis == "WEEKLY" ? L("Weekly") : L("Monthly")),
                    leading: .avatar(url: nil, name: employee.name),
                    chevron: true
                )
            }
            .buttonStyle(.pressableCard)
        }
    }

    // MARK: - Attendance

    @ViewBuilder
    private func attendanceSection(_ data: TeamPayrollResponse) -> some View {
        SectionHeader(L("Arrival delays"), actionTitle: L("Record")) {
            showRecordAttendance = true
        }
        Text(L("Recorded per day and per person. The fingerprint device writes these same rows, and never writes over a figure you typed here."))
            .font(.neonCaption)
            .foregroundStyle(Color.neonTextSecondary)

        DeviceIdsCard(employees: data.employees) { await load() }

        if !data.attendance.isEmpty {
            CardList(data.attendance) { record in
                HStack {
                    ListRow(record.employeeName, subtitle: record.note, meta: formattedISODate(record.day), value: L("%.2f h", record.delayHours))
                    Button {
                        Haptic.tap()
                        removingAttendance = record
                    } label: {
                        Image(systemName: "trash").font(.system(size: 13, weight: .semibold)).foregroundStyle(Color.neonTextTertiary)
                    }
                    .padding(.trailing, 14)
                }
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
        SectionHeader(L("Receipts"), subtitle: data.periodLabel, count: data.receipts.count)
        Text(L("Read from the photo automatically. Each receipt counts up to 2 JOD — correct the amount if the reading is wrong."))
            .font(.neonCaption)
            .foregroundStyle(Color.neonTextSecondary)

        if data.receipts.isEmpty {
            EmptyState(symbol: "text.viewfinder", title: L("No receipts this month"))
        } else {
            VStack(spacing: 8) {
                ForEach(data.receipts) { receipt in
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
                                .font(.system(size: 14, weight: .semibold, design: .rounded))
                                .foregroundStyle(Color.neonSuccessStrong)
                        }
                        .padding(10)
                        .neonSurface(.glass, radius: NeonRadius.md)
                    }
                    .buttonStyle(.pressableCard)
                }
            }
        }
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

// MARK: - Pay sheet row

private struct PayrollRow: View {
    let row: TeamPayrollRow
    let isThisMonth: Bool

    var body: some View {
        NeonCard(padding: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    DirText(row.employee.name, font: .neonSubheadline, color: .neonInk)
                    if let role = row.employee.role { DirText(role, font: .neonCaption, color: .neonTextSecondary) }
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(L("Final pay")).font(.neonCaption).foregroundStyle(Color.neonTextTertiary)
                    Text(NeonFormat.money(row.breakdown.finalPay, decimals: 2)).font(.neonTitle3).foregroundStyle(Color.neonInk)
                }
            }

            FlowRow {
                MetaLabel(L("Per hour %@", NeonFormat.number(row.breakdown.hourlyRate, decimals: 3)), symbol: "clock")
                MetaLabel(L("Late %.2f h", row.breakdown.delayHours), symbol: "hourglass")
                MetaLabel(L("Cutoff −%@", NeonFormat.money(row.breakdown.cutoff, decimals: 2)), symbol: "minus.circle")
                if row.breakdown.adjustmentTotal > 0 {
                    MetaLabel(L("Adjustments −%@", NeonFormat.money(row.breakdown.adjustmentTotal, decimals: 2)), symbol: "slider.horizontal.3", tint: .neonDangerStrong)
                }
                MetaLabel(L("Receipts +%@", NeonFormat.money(row.breakdown.receiptTotal, decimals: 2)), symbol: "plus.circle", tint: .neonSuccessStrong)
            }

            if !row.adjustments.isEmpty {
                Text(row.adjustments.map(\.reason).joined(separator: " · "))
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextTertiary)
            }
        }
    }
}

// MARK: - Device ids (fingerprint pairing)

private struct DeviceIdsCard: View {
    let employees: [TeamPayrollEmployee]
    var onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @State private var drafts: [String: String] = [:]
    @State private var saving: String?

    var body: some View {
        SectionCard(L("Fingerprint pairing"), subtitle: L("Paired by the device's own user number, never by name."), symbol: "touchid", hue: .cyan) {
            ForEach(employees) { employee in
                HStack(spacing: 8) {
                    Text(employee.name).font(.neonSubheadline).foregroundStyle(Color.neonInk).lineLimit(1)
                    Spacer(minLength: 8)
                    TextField(L("device no."), text: Binding(
                        get: { drafts[employee.id] ?? employee.deviceUserId ?? "" },
                        set: { drafts[employee.id] = $0 }
                    ))
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 90)
                    .font(.system(size: 14))
                    .padding(.vertical, 6).padding(.horizontal, 10)
                    .neonSurface(.sunken, radius: 10)

                    NeonButton(L("Pair"), size: .small, fullWidth: false, isLoading: saving == employee.id) {
                        await pair(employee)
                    }
                }
            }
        }
    }

    private func pair(_ employee: TeamPayrollEmployee) async {
        saving = employee.id
        defer { saving = nil }
        do {
            try await api.perform("team/setDeviceUserId", args: [employee.id], form: ["deviceUserId": drafts[employee.id] ?? employee.deviceUserId ?? ""])
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
    @State private var delayHours: Double? = 1
    @State private var note = ""

    var body: some View {
        SheetScaffold(
            L("Record a delay"),
            symbol: "hourglass.badge.plus",
            primaryTitle: L("Record"),
            isPrimaryEnabled: employeeId != nil
        ) {
            await save()
        } content: {
            FormSection {
                MenuField(L("Employee"), selection: $employeeId, options: employees.map(\.id), title: { id in employees.first(where: { $0.id == id })?.name ?? id }, isRequired: true)
                DateField(L("Day"), date: $day, components: [.date])
                NumberField(L("Hours late"), value: $delayHours, decimals: 2)
                NeonTextField(L("Note"), text: $note)
            }
        }
        .neonSheet([.medium])
        .task { if employeeId == nil { employeeId = employees.first?.id } }
    }

    private func save() async {
        guard let employeeId else { return }
        do {
            try await api.perform("team/setAttendance", form: [
                "employeeId": employeeId,
                "day": NeonFormat.dayKey(day),
                "delayHours": String(delayHours ?? 0),
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
        SheetScaffold(L("Fix this receipt"), subtitle: receipt.employeeName, symbol: "receipt", primaryTitle: L("Fix")) {
            await save()
        } content: {
            RemoteImage(url: resolvedMediaURL(receipt.imageUrl), contentMode: .fit)
                .frame(height: 220)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            FormSection {
                NeonTextField(L("Vendor"), text: $vendor)
                MoneyField(L("Paid"), amount: $rawAmount)
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
